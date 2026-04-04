import type { UTPConnection, UTPSocket } from 'utp-socket'

import type { Socket } from '../../../types/hydrabase'
import type { Identity } from '../../protocol/HIP1_Identity'

import { Trace } from '../../../utils/trace'
import { authenticateServerHTTP } from '../http'

export class UTPClient implements Socket {
  private static readonly CONNECT_TIMEOUT_MS = 8_000
  private static readonly GREETING_TIMEOUT_MS = 10_000
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
    const trace = Trace.start(`[UTP] Authenticating inbound connection from ${conn.remoteAddress}`)
    // Wait for the connecting peer's in-band greeting containing its service hostname.
    // remotePort is the ephemeral source port, not the peer's service port, so we cannot
    // call authenticateServerHTTP against remoteAddress:remotePort.
    const serviceHostname = await UTPClient.readServiceHostnameFromGreeting(conn, trace)
    if (!serviceHostname) {
      trace.fail('[UTP] Rejected inbound connection: missing or invalid greeting')
      conn.destroy()
      return false
    }
    trace.step(`[UTP] Received greeting, authenticating service at ${serviceHostname}`)
    const identity = await authenticateServerHTTP(serviceHostname, trace)
    if (Array.isArray(identity)) {
      trace.fail(`[UTP] Rejected unauthenticated inbound connection from ${serviceHostname}: ${identity[1]}`)
      conn.destroy()
      return false
    }
    trace.step(`[UTP] Authenticated inbound peer ${identity.username} (${identity.address})`)
    trace.success()
    return new UTPClient({ ...identity, hostname: serviceHostname }, conn)
  }
  static readonly connectToAuthenticatedPeer = (identity: Identity, utpSocket: UTPSocket, localHostname: `${string}:${number}`, trace: Trace): Promise<UTPClient> => new Promise<UTPClient>((res, rej) => {
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
      trace.step('[UTP] Connection established, sending greeting')
      conn.write(JSON.stringify({ hello: localHostname }))
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
  private static readonly readServiceHostnameFromGreeting = (
    conn: UTPConnection,
    trace: Trace
  ): Promise<`${string}:${number}` | null> => new Promise(resolve => {
    /* eslint-disable no-use-before-define */
    const MAX_GREETING_BYTES = 4_096
    let settled = false
    let timer: NodeJS.Timeout | null = null
    let buffer = Buffer.alloc(0)
    
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > MAX_GREETING_BYTES) {
        trace.step(`[UTP] Greeting exceeded ${MAX_GREETING_BYTES} bytes, rejecting`)
        finish(null)
        return
      }
      try {
        const parsed: unknown = JSON.parse(buffer.toString())
        if (typeof parsed === 'object' && parsed !== null && 'hello' in parsed) {
          const {hello} = (parsed as Record<string, unknown>)
          if (typeof hello === 'string' && hello.includes(':')) {
            finish(hello as `${string}:${number}`)
          }
        } else {
          // Parsed but did not match expected shape
          trace.step('[UTP] Greeting parsed but missing valid "hello" field')
          finish(null)
        }
      } catch {
        // Not yet a complete JSON object — wait for more data
      }
    }
    
    const finish = (result: `${string}:${number}` | null): void => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      conn.removeListener('data', onData)
      resolve(result)
    }
    
    conn.on('data', onData)
    timer = setTimeout(() => {
      trace.step('[UTP] Greeting timed out waiting for complete JSON')
      finish(null)
    }, UTPClient.GREETING_TIMEOUT_MS)
    /* eslint-enable no-use-before-define */
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