import type { UTPConnection, UTPSocket } from 'utp-socket'

import type { Socket } from '../../../types/hydrabase'
import type { Identity } from '../../protocol/HIP1_Identity'

import { Trace } from '../../../utils/trace'
import { authenticateServerHTTP } from '../http'

export class UTPClient implements Socket {
  private static readonly CONNECT_TIMEOUT_MS = 8_000
  private readonly closeHandlers: (() => void)[] = []
  private readonly messageHandlers: ((message: string) => void)[] = []
  private constructor(public readonly identity: Identity, private readonly conn: UTPConnection) {
    conn.setTimeout(120_000, () => {
      const trace = Trace.start(`[UTP] Connection timed out for ${identity.address}`)
      this.close()
      trace.fail('Closed timed out connection')
    })
    conn.on('close', () => this.closeHandlers.forEach(h => h()))
    conn.on('error', () => {
      const trace = Trace.start(`[UTP] Connection error for ${identity.address}`)
      this.close()
      trace.fail('Closed errored connection')
    })
    conn.on('data', data => {
      const message = data.toString()
      this.messageHandlers.forEach(h => h(message))
    })
  }
  static readonly authenticateConnectedPeer = async (
    conn: UTPConnection
  ): Promise<false | UTPClient> => {
    const remoteHostname = `${conn.remoteAddress}:${conn.remotePort}` as const
    const trace = Trace.start(`[UTP] Authenticating inbound connection from ${remoteHostname}`)
    const identity = await authenticateServerHTTP(remoteHostname, trace)
    if (Array.isArray(identity)) {
      trace.fail(`[UTP] Rejected unauthenticated inbound connection from ${remoteHostname}: ${identity[1]}`)
      conn.destroy()
      return false
    }
    trace.step(`[UTP] Authenticated inbound peer ${identity.username} (${identity.address})`)
    trace.success()
    return new UTPClient({ ...identity, hostname: remoteHostname }, conn)
  }
  static readonly connectToAuthenticatedPeer = (identity: Identity, utpSocket: UTPSocket, trace: Trace): Promise<UTPClient> => new Promise<UTPClient>((res, rej) => {
    trace.step(`[UTP] Establishing outbound connection to ${identity.hostname}`)
    const [host, portStr] = identity.hostname.split(':') as [string, `${number}`]
    const conn = utpSocket.connect(Number(portStr), host)
    let settled = false
    const connectTimeout = setTimeout(() => {
      if (settled) return
      settled = true
      conn.destroy()
      trace.step(`[UTP] Connection timed out after ${UTPClient.CONNECT_TIMEOUT_MS}ms`)
      rej(new Error(`UTP connection timeout after ${UTPClient.CONNECT_TIMEOUT_MS}ms`))
    }, UTPClient.CONNECT_TIMEOUT_MS)
    conn.on('connect', () => {
      if (settled) return
      settled = true
      clearTimeout(connectTimeout)
      trace.step('[UTP] Connection established')
      res(new UTPClient(identity, conn))
    })
    conn.on('error', err => {
      if (settled) return
      settled = true
      clearTimeout(connectTimeout)
      trace.step(`[UTP] Connection error: ${String(err)}`)
      rej(err)
    })
  })
  public readonly close = () => {
    this.conn.destroy()
  }
  public readonly onClose = (handler: () => void) => this.closeHandlers.push(handler)

  public readonly onMessage = (handler: (message: string) => void) => this.messageHandlers.push(handler)
  public readonly send = (message: string) => {
    this.conn.write(message)
  }
}