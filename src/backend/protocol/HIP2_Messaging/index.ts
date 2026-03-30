import z from 'zod'

import type { Trace } from '../../../utils/trace'
import type { Peer } from '../../Peer'
import type { RequestManager } from '../../RequestManager'

import { MessageEnvelopeSchema, type Request, RequestSchema, type Response, ResponseSchema } from '../../../types/hydrabase-schemas'
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

const MessageHistoryRequestSchema = z.literal('get')

export const SendMessageSchema = z.object({
  payload: z.string(),
  to: z.string().startsWith('0x').transform(v => v as `0x${string}`)
})
export type SendMessage = z.infer<typeof SendMessageSchema>

export const ConnectPeerSchema = z.object({
  hostname: z.string().regex(/^.+:\d+$/u).transform(v => v as `${string}:${number}`)
})
export type ConnectPeer = z.infer<typeof ConnectPeerSchema>

const MessageSchemas = {
  announce: AnnounceSchema,
  connect_peer: ConnectPeerSchema,
  deliver_message: MessageEnvelopeSchema,
  message_history: MessageHistoryRequestSchema,
  peer_stats: PeerStatsRequestSchema,
  ping: PingSchema,
  pong: PingSchema,
  request: RequestSchema,
  response: ResponseSchema,
  search_history: SearchHistoryDataSchema,
  send_message: SendMessageSchema,
  store_message: MessageEnvelopeSchema
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
    : 'store_message' in result ? 'store_message'
    : 'deliver_message' in result ? 'deliver_message'
    : 'peer_stats' in result ? 'peer_stats'
    : 'announce' in result ? 'announce'
    : 'connect_peer' in result ? 'connect_peer'
    : 'ping' in result ? 'ping'
    : 'pong' in result ? 'pong'
    : 'search_history' in result ? 'search_history'
    : 'send_message' in result ? 'send_message'
    : 'message_history' in result ? 'message_history'
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
