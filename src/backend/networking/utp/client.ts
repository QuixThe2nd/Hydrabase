import type { UTPConnection, UTPSocket } from 'utp-native'

import type { Config } from '../../../types/hydrabase'
import type { Socket } from '../../../types/hydrabase'
import type { Account } from '../../crypto/Account'
import type { Identity } from '../../protocol/HIP1_Identity'

import { Trace } from '../../../utils/trace'
import { authenticateServerUDP } from '../../protocol/HIP5_IdentityDiscovery'
import { UDP_Server } from '../udp/server'

export class UTPClient implements Socket {
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
    conn: UTPConnection,
    udpServer: UDP_Server,
    account: Account,
    node: Config['node']
  ): Promise<false | UTPClient> => {
    const remoteHostname = `${conn.remoteAddress}:${conn.remotePort}` as const
    const trace = Trace.start(`[UTP] Authenticating inbound connection from ${remoteHostname}`)
    const identity = await authenticateServerUDP(udpServer, remoteHostname, account, node, trace)
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
    conn.on('connect', () => {
      trace.step('[UTP] Connection established')
      res(new UTPClient(identity, conn))
    })
    conn.on('error', err => {
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