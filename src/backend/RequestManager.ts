import type { PendingRequest, Request, Response } from '../types/hydrabase-schemas'

import { logEvent } from '../utils/log'

export class RequestManager {
  public get averageLatencyMs(): number {
    return this.resolvedCount === 0 ? 0 : this.totalLatency / this.resolvedCount
  }
  private nonce = -1
  private readonly pending = new Map<number, PendingRequest<Request['type']>>()
  private resolvedCount = 0

  private totalLatency = 0

  constructor(private readonly timeoutMs = 15_000) {}

  public close(reason = 'Connection closed'): void {
    for (const [nonce, pending] of this.pending) {
      clearTimeout(pending.timeout)
      logEvent({
        category: 'trace',
        context: { nonce, reason },
        level: 'warning',
        message: `[REQUEST] Request ${nonce} failed: ${reason}`,
      })
      pending.resolve(false)
    }
    this.pending.clear()
  }

  public register<T extends Request['type']>(): { nonce: number; promise: Promise<false | Response<T>> } {
    const nonce = ++this.nonce

    const promise = new Promise<false | Response<T>>(resolve => {
      const timeout = setTimeout(() => {
        this.pending.delete(nonce)
        logEvent({
          category: 'trace',
          context: { nonce },
          level: 'warning',
          message: `[REQUEST] Request ${nonce} timed out`,
        })
        resolve(false)
      }, this.timeoutMs)

      this.pending.set(nonce, {
        resolve: resolve as PendingRequest<Request['type']>['resolve'],
        startedAt: Date.now(),
        timeout,
      })
    })

    return { nonce, promise }
  }

  public resolve<T extends Request['type']>(nonce: number, response: Response<T>): boolean {
    const pending = this.pending.get(nonce)
    if (!pending) {return false}

    const latency = Date.now() - pending.startedAt
    this.totalLatency += latency
    this.resolvedCount++

    clearTimeout(pending.timeout)
    pending.resolve(response as Response<Request['type']>)
    this.pending.delete(nonce)
    return true
  }
}
