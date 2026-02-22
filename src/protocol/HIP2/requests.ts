import { validateCapability, type Capability } from '../HIP1/capabilities'
import { AlbumSearchResultSchema, ArtistSearchResultSchema, TrackSearchResultSchema } from '../../Metadata';
import z from 'zod'

export const RequestSchema = z.object({
  type: z.union([z.literal('track'), z.literal('artist'), z.literal('album')]),
  query: z.string()
})

export const ResponseSchema = z.union([z.array(TrackSearchResultSchema), z.array(ArtistSearchResultSchema), z.array(AlbumSearchResultSchema)])

interface MessageMap {
  track: z.infer<typeof TrackSearchResultSchema>[];
  artist: z.infer<typeof ArtistSearchResultSchema>[];
  album: z.infer<typeof AlbumSearchResultSchema>[];
}

export type Request = z.infer<typeof RequestSchema>
export type Response<T extends keyof MessageMap = keyof MessageMap> = MessageMap[T]

type PendingRequest<T extends Request['type']> = {
  resolve: (value: Response<T>) => void
  reject: (reason: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export class RequestManager {
  private nonce = -1
  private readonly pending = new Map<number, PendingRequest<Request['type']>>()
  private _peerCapability?: Capability
  private _handshakeComplete = false
  private _handshakeResolve?: () => void
  private _handshakeReject?: (reason: Error) => void
  private readonly _handshakePromise: Promise<void>
  private _handshakeTimeout: ReturnType<typeof setTimeout>

  constructor(private readonly timeoutMs: number = 15_000, handshakeTimeoutMs: number = 10_000) {
    this._handshakePromise = new Promise<void>((resolve, reject) => {
      this._handshakeResolve = resolve
      this._handshakeReject = reject
    })
    this._handshakeTimeout = setTimeout(() => this._handshakeReject?.(new Error('Capability handshake timed out')), handshakeTimeoutMs)
  }

  public receiveCapability(raw: unknown): boolean {
    const result = validateCapability(raw)

    if (!result.ok) {
      clearTimeout(this._handshakeTimeout)
      this._handshakeReject?.(new Error(`Capability rejected: ${result.reason}`))
      return false
    }

    clearTimeout(this._handshakeTimeout)
    this._peerCapability = result.capability
    this._handshakeComplete = true
    this._handshakeResolve?.()
    return true
  }

  public get handshake(): Promise<void> {
    return this._handshakePromise
  }

  public get peerCapability(): Capability {
    if (!this._peerCapability) throw new Error('Capability handshake not yet complete')
    return this._peerCapability
  }

  public get handshakeComplete(): boolean {
    return this._handshakeComplete
  }

  public register<T extends Request['type']>(): { nonce: number; promise: Promise<Response<T>> } {
    if (!this._handshakeComplete) {
      throw new Error('Cannot register request: capability handshake not yet complete')
    }

    const nonce = ++this.nonce

    const promise = new Promise<Response<T>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(nonce)
        reject(new Error(`Request timed out (nonce: ${nonce})`))
      }, this.timeoutMs)

      this.pending.set(nonce, {
        resolve: resolve as PendingRequest<Request['type']>['resolve'],
        reject,
        timeout,
      })
    })

    return { nonce, promise }
  }

  public resolve<T extends Request['type']>(nonce: number, response: Response<T>): boolean {
    const pending = this.pending.get(nonce)
    if (!pending) return false

    clearTimeout(pending.timeout)
    pending.resolve(response as Response<Request['type']>)
    this.pending.delete(nonce)
    return true
  }

  public close(reason: string = 'Connection closed'): void {
    clearTimeout(this._handshakeTimeout)

    if (!this._handshakeComplete) this._handshakeReject?.(new Error(`${reason} before handshake completed`))

    for (const [nonce, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(`${reason} (nonce: ${nonce})`))
    }
    this.pending.clear()
  }
}
