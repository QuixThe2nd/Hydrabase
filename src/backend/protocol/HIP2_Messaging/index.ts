import z from 'zod'

import type { Trace } from '../../../utils/trace'
import type { Peer } from '../../Peer'
import type { RequestManager } from '../../RequestManager'

import { type Request, RequestSchema, type Response, ResponseSchema } from '../../../types/hydrabase-schemas'
import { AnnounceSchema } from '../HIP3_AnnouncePeers'

export const PeerStatsRequestSchema = z.object({ address: z.string().regex(/^0x/iu).transform(v => v as `0x${string}`) })

export const PingSchema = z.object({
  time: z.number()
})
export type Ping = z.infer<typeof PingSchema>

const SearchHistoryDataSchema = z.union([
  z.literal('get'),
  z.literal('clear'),
  z.object({ remove: z.number() })
])

const MessageSchemas = {
  announce: AnnounceSchema,
  ping: PingSchema,
  pong: PingSchema,
  request: RequestSchema,
  response: ResponseSchema,
  search_history: SearchHistoryDataSchema
}

type Message<T extends keyof typeof MessageSchemas = keyof typeof MessageSchemas> = z.infer<typeof MessageSchemas[T]>
type MessageType = keyof typeof MessageSchemas

export class HIP2_Messaging {
  public readonly send = {
    request: async <T extends Request['type']>(request: Request & { type: T }, trace: Trace): Promise<Response<T>> => {
      const { nonce, promise } = this.requestManager.register<T>()
      trace.step(`[HIP2] Sending request ${nonce} to peer ${this.peer.username} ${this.peer.address}`)
      this.peer.send({ nonce, request }, trace)
      const results = await promise
      if (!results) return []
      trace.step(`[HIP2] Received ${results.length} results from ${this.peer.username} ${this.peer.address}`)
      return results
    },
    response: <T extends Request['type']>(response: Response<T>, nonce: number, trace: Trace) => this.peer.send({ nonce, response }, trace)
  }

  constructor(private readonly peer: Peer, private readonly requestManager: RequestManager) {}

  static readonly identifyType = (result: Record<string, unknown>): MessageType | null => 'request' in result ? 'request'
    : 'response' in result ? 'response'
    : 'announce' in result ? 'announce'
    : 'ping' in result ? 'ping'
    : 'pong' in result ? 'pong'
    : 'search_history' in result ? 'search_history'
    : null

  parseMessage = (message: string, trace: Trace): false | { data: Message, nonce: number; type: MessageType } => {
    const { nonce, ...result } = JSON.parse(message)

    const type = HIP2_Messaging.identifyType(result)
    if (!type) return trace.caughtError(`[HIP2] Unexpected message ${Object.keys(result)} from ${this.peer.username} ${this.peer.address} ${this.peer.hostname}`)

    const {data,error} = MessageSchemas[type].safeParse(result[type])
    if (!data) return trace.caughtError(`[HIP2] Unexpected ${type} from ${this.peer.username} ${this.peer.address} ${this.peer.hostname}${error ? `: ${JSON.stringify(error.issues).slice(0, 300)}` : ''}`)
    
    trace.step(`[HIP2] Received ${type}${nonce ? ` ${nonce}` : ''} from ${this.peer.username} ${this.peer.address} ${this.peer.hostname}`)

    return { data, nonce, type }
  }
}
