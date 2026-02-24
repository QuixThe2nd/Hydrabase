import z from 'zod'
import { AlbumSearchResultSchema, ArtistSearchResultSchema, TrackSearchResultSchema } from './Metadata';

export const RequestSchema = z.object({
  type: z.union([z.literal('track'), z.literal('artist'), z.literal('album')]),
  query: z.string()
})
export const ResponseSchema = z.union([z.array(TrackSearchResultSchema), z.array(ArtistSearchResultSchema), z.array(AlbumSearchResultSchema)])

export type Track = z.infer<typeof TrackSearchResultSchema>
export type Artist = z.infer<typeof ArtistSearchResultSchema>
export type Album = z.infer<typeof AlbumSearchResultSchema>

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

  constructor(private readonly timeoutMs: number = 15_000) {}

  public register<T extends Request['type']>(): { nonce: number; promise: Promise<Response<T>> } {
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
    for (const [nonce, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(`${reason} (nonce: ${nonce})`))
    }
    this.pending.clear()
  }
}
