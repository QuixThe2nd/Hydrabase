import type { UTPConnection, UTPSocket } from 'utp-socket'

import type { Identity, Socket } from '../../../types/hydrabase'

import { Trace } from '../../../utils/trace'
import { authenticateServerHTTP } from '../http'

export class UTPClient implements Socket {
  private static readonly CONNECT_TIMEOUT_MS = 8_000
  private static readonly FRAME_DELIMITER = '\n'
  private static readonly GREETING_TIMEOUT_MS = 10_000
  private readonly closeHandlers: (() => void)[] = []
  private readonly messageHandlers: ((message: string) => void)[] = []
  private receiveBuffer = ''

  private constructor(public readonly identity: Identity, private readonly conn: UTPConnection, initialBuffer = '') {
    this.receiveBuffer = initialBuffer
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
    conn.on('data', data => this.handleData(data.toString()))
  }
  static readonly authenticateConnectedPeer = async (
    conn: UTPConnection
  ): Promise<false | UTPClient> => {
    const trace = Trace.start(`[UTP] Authenticating inbound connection from ${conn.remoteAddress}`)
    // Wait for the connecting peer's in-band greeting containing its service hostname.
    // remotePort is the ephemeral source port, not the peer's service port, so we cannot
    // call authenticateServerHTTP against remoteAddress:remotePort.
    const greetingResult = await UTPClient.readServiceHostnameFromGreeting(conn, trace)
    if (!greetingResult) {
      trace.fail('[UTP] Rejected inbound connection: missing or invalid greeting')
      conn.destroy()
      return false
    }
    const { remainingBuffer, serviceHostname } = greetingResult
    trace.step(`[UTP] Received greeting, authenticating service at ${serviceHostname}`)
    const identity = await authenticateServerHTTP(serviceHostname, trace)
    if (Array.isArray(identity)) {
      trace.fail(`[UTP] Rejected unauthenticated inbound connection from ${serviceHostname}: ${identity[1]}`)
      conn.destroy()
      return false
    }
    trace.step(`[UTP] Authenticated inbound peer ${identity.username} (${identity.address})`)
    trace.success()
    return new UTPClient({ ...identity, bio: identity.bio, hostname: serviceHostname }, conn, remainingBuffer)
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
      conn.write(`${JSON.stringify({ hello: localHostname })}${UTPClient.FRAME_DELIMITER}`)
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
  private static readonly extractLegacyJsonFrames = (buffer: string): { frames: string[]; rest: string } => {
    const frames: string[] = []
    let cursor = 0

    while (cursor < buffer.length) {
      while (cursor < buffer.length && /\s/u.test(buffer[cursor] ?? '')) cursor++
      if (cursor >= buffer.length) return { frames, rest: '' }
      if (buffer[cursor] !== '{') break

      const parsed = UTPClient.parseNextLegacyFrame(buffer, cursor)
      if (!parsed.complete) return { frames, rest: buffer.slice(cursor) }
      frames.push(parsed.frame)
      cursor = parsed.nextCursor
    }

    return { frames, rest: buffer.slice(cursor) }
  }
  private static readonly parseNextLegacyFrame = (buffer: string, start: number):
    { complete: false } | { complete: true; frame: string; nextCursor: number } => {
    let cursor = start
    let depth = 0
    let inString = false
    let escaped = false

    for (; cursor < buffer.length; cursor++) {
      const char = buffer[cursor] ?? ''
      if (inString) {
        if (escaped) {
          escaped = false
          continue
        }
        if (char === '\\') {
          escaped = true
          continue
        }
        if (char === '"') inString = false
        continue
      }

      if (char === '"') {
        inString = true
        continue
      }
      if (char === '{') {
        depth++
        continue
      }
      if (char === '}') {
        depth--
        if (depth === 0) return { complete: true, frame: buffer.slice(start, cursor + 1), nextCursor: cursor + 1 }
      }
    }

    return { complete: false }
  }
  // eslint-disable-next-line max-lines-per-function
  private static readonly readServiceHostnameFromGreeting = (
    conn: UTPConnection,
    trace: Trace
  ): Promise<null | { remainingBuffer: string; serviceHostname: `${string}:${number}` }> => new Promise(resolve => {
    const MAX_GREETING_BYTES = 4_096
    let settled = false
    let timer: NodeJS.Timeout | null = null
    let buffer = ''

    let onData: ((chunk: Buffer) => void) | null = null

    const finish = (result: null | { remainingBuffer: string; serviceHostname: `${string}:${number}` }): void => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      if (onData) conn.removeListener('data', onData)
      resolve(result)
    }

    onData = (chunk: Buffer): void => {
      buffer += chunk.toString()
      if (Buffer.byteLength(buffer, 'utf8') > MAX_GREETING_BYTES) {
        trace.step(`[UTP] Greeting exceeded ${MAX_GREETING_BYTES} bytes, rejecting`)
        finish(null)
        return
      }
      const delimiterIndex = buffer.indexOf(UTPClient.FRAME_DELIMITER)
      if (delimiterIndex === -1) return
      const frame = buffer.slice(0, delimiterIndex)
      const remainingBuffer = buffer.slice(delimiterIndex + 1)
      try {
        const parsed: unknown = JSON.parse(frame)
        if (typeof parsed === 'object' && parsed !== null && 'hello' in parsed) {
          const { hello } = parsed as Record<string, unknown>
          if (typeof hello === 'string' && hello.includes(':')) {
            finish({ remainingBuffer, serviceHostname: hello as `${string}:${number}` })
            return
          }
        }
        trace.step('[UTP] Greeting parsed but missing valid "hello" field')
        finish(null)
      } catch {
        trace.step('[UTP] Greeting frame was not valid JSON')
        finish(null)
      }
    }

    conn.on('data', onData)
    timer = setTimeout(() => {
      trace.step('[UTP] Greeting timed out waiting for framed greeting message')
      finish(null)
    }, UTPClient.GREETING_TIMEOUT_MS)
  })

  public readonly close = () => {
    this.conn.destroy()
  }
  public readonly onClose = (handler: () => void) => this.closeHandlers.push(handler)

  public readonly onMessage = (handler: (message: string) => void) => {
    this.messageHandlers.push(handler)
    this.flushFrames()
    this.flushLegacyJsonFrames()
  }

  public readonly send = (message: string) => {
    this.conn.write(`${message}${UTPClient.FRAME_DELIMITER}`)
  }

  private readonly flushFrames = (): void => {
    if (this.messageHandlers.length === 0) return
    for (;;) {
      const delimiterIndex = this.receiveBuffer.indexOf(UTPClient.FRAME_DELIMITER)
      if (delimiterIndex === -1) return
      const frame = this.receiveBuffer.slice(0, delimiterIndex)
      this.receiveBuffer = this.receiveBuffer.slice(delimiterIndex + 1)
      if (frame.length === 0) continue
      this.messageHandlers.forEach(h => h(frame))
    }
  }

  private readonly flushLegacyJsonFrames = (): void => {
    if (this.messageHandlers.length === 0 || this.receiveBuffer.length === 0) return

    const { frames, rest } = UTPClient.extractLegacyJsonFrames(this.receiveBuffer)
    if (frames.length === 0) return

    this.receiveBuffer = rest
    for (const frame of frames) this.messageHandlers.forEach(h => h(frame))
  }

  private readonly handleData = (chunk: string): void => {
    this.receiveBuffer += chunk
    this.flushFrames()
    this.flushLegacyJsonFrames()
  }
}