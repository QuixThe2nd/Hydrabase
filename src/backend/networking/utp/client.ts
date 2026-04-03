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
    // #region agent log
    fetch('http://127.0.0.1:7488/ingest/ae9253ff-0376-45a8-b089-19456fa3761b',{body:JSON.stringify({data:{address:identity.address,host,hostname:identity.hostname,port:Number(portStr)},hypothesisId:'H1',location:'src/backend/networking/utp/client.ts:53',message:'UTP outbound connect start',runId:'pre-fix',sessionId:'58f352',timestamp:Date.now()}),headers:{'Content-Type':'application/json','X-Debug-Session-Id':'58f352'},method:'POST'}).catch(() => undefined)
    // #endregion
    const conn = utpSocket.connect(Number(portStr), host)
    let settled = false
    const connectTimeout = setTimeout(() => {
      if (settled) return
      settled = true
      conn.destroy()
      // #region agent log
      fetch('http://127.0.0.1:7488/ingest/ae9253ff-0376-45a8-b089-19456fa3761b',{body:JSON.stringify({data:{hostname:identity.hostname,timeoutMs:UTPClient.CONNECT_TIMEOUT_MS},hypothesisId:'H1',location:'src/backend/networking/utp/client.ts:61',message:'UTP outbound connect timed out',runId:'post-fix',sessionId:'58f352',timestamp:Date.now()}),headers:{'Content-Type':'application/json','X-Debug-Session-Id':'58f352'},method:'POST'}).catch(() => undefined)
      // #endregion
      trace.step(`[UTP] Connection timed out after ${UTPClient.CONNECT_TIMEOUT_MS}ms`)
      rej(new Error(`UTP connection timeout after ${UTPClient.CONNECT_TIMEOUT_MS}ms`))
    }, UTPClient.CONNECT_TIMEOUT_MS)
    conn.on('connect', () => {
      if (settled) return
      settled = true
      clearTimeout(connectTimeout)
      // #region agent log
      fetch('http://127.0.0.1:7488/ingest/ae9253ff-0376-45a8-b089-19456fa3761b',{body:JSON.stringify({data:{hostname:identity.hostname,remoteAddress:conn.remoteAddress ?? null,remotePort:conn.remotePort ?? null},hypothesisId:'H1',location:'src/backend/networking/utp/client.ts:69',message:'UTP outbound connect established',runId:'post-fix',sessionId:'58f352',timestamp:Date.now()}),headers:{'Content-Type':'application/json','X-Debug-Session-Id':'58f352'},method:'POST'}).catch(() => undefined)
      // #endregion
      trace.step('[UTP] Connection established')
      res(new UTPClient(identity, conn))
    })
    conn.on('error', err => {
      if (settled) return
      settled = true
      clearTimeout(connectTimeout)
      // #region agent log
      fetch('http://127.0.0.1:7488/ingest/ae9253ff-0376-45a8-b089-19456fa3761b',{body:JSON.stringify({data:{error:String(err),hostname:identity.hostname},hypothesisId:'H1',location:'src/backend/networking/utp/client.ts:77',message:'UTP outbound connect error',runId:'post-fix',sessionId:'58f352',timestamp:Date.now()}),headers:{'Content-Type':'application/json','X-Debug-Session-Id':'58f352'},method:'POST'}).catch(() => undefined)
      // #endregion
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