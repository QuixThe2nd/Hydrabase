import z from 'zod'

import type { RuntimeConfigUpdate } from '../../../types/hydrabase'
import type { Trace } from '../../../utils/trace'
import type { Peer } from '../../Peer'
import type { RequestManager } from '../../RequestManager'

import { MessageEnvelopeSchema, type Request, RequestSchema, type Response, ResponseSchema } from '../../../types/hydrabase-schemas'
import { AnnounceSchema } from '../HIP3_AnnouncePeers'

export const PeerStatsRequestSchema = z.object({ address: z.string().regex(/^0x/iu).transform(v => v as `0x${string}`) })


export const PingSchema = z.object({
  peers: z.array(z.string().regex(/^.+:\d+$/u).transform(v => v as `${string}:${number}`)),
  time: z.number()
})
export type Ping = z.infer<typeof PingSchema>

export const PongSchema = z.object({
  peers: z.array(z.string().regex(/^.+:\d+$/u).transform(v => v as `${string}:${number}`)).optional(),
  time: z.number()
})
export type Pong = z.infer<typeof PongSchema>

const SearchHistoryDataSchema = z.union([
  z.literal('get'),
  z.literal('clear'),
  z.object({ remove: z.number() })
])

const MessageHistoryRequestSchema = z.literal('get')
const GetConfigSchema = z.literal(true)
const UpdateConfigSchema = z.object({
  config: z.object({
    apiKey: z.string().optional(),
    bootstrapPeers: z.string().optional(),
    dht: z.object({
      bootstrapNodes: z.string().optional(),
      reannounce: z.number().positive().optional(),
      requireReady: z.boolean().optional(),
      roomSeed: z.string().optional(),
    }).optional(),
    formulas: z.object({
      finalConfidence: z.string().optional(),
      pluginConfidence: z.string().optional(),
    }).optional(),
    node: z.object({
      bio: z.string().max(140).optional(),
      connectMessage: z.string().min(1).max(280).optional(),
      hostname: z.string().optional(),
      ip: z.string().optional(),
      listenAddress: z.string().optional(),
      port: z.number().int().min(1).max(65535).optional(),
      preferTransport: z.union([z.literal('TCP'), z.literal('UTP')]).optional(),
      username: z.string().regex(/^[a-zA-Z0-9]{3,20}$/u).optional(),
    }).optional(),
    rpc: z.object({
      prefix: z.string().optional(),
    }).optional(),
    soulIdCutoff: z.number().int().positive().optional(),
    telemetry: z.object({
      enabled: z.boolean().optional(),
    }).optional(),
    upnp: z.object({
      reannounce: z.number().positive().optional(),
      ttl: z.number().positive().optional(),
    }).optional(),
  }),
})

export const SendMessageSchema = z.object({
  payload: z.string(),
  to: z.string().startsWith('0x').transform(v => v as `0x${string}`)
})
export type SendMessage = z.infer<typeof SendMessageSchema>

export const ConnectPeerSchema = z.object({
  hostname: z.string().regex(/^.+:\d+$/u).transform(v => v as `${string}:${number}`)
})
export type ConnectPeer = z.infer<typeof ConnectPeerSchema>

export const MessagePacketSchema = z.object({
  envelope: MessageEnvelopeSchema,
  hops: z.number().int().min(0).max(5)
})
export type MessagePacket = z.infer<typeof MessagePacketSchema>

const MessageSchemas = {
  announce: AnnounceSchema,
  connect_peer: ConnectPeerSchema,
  get_config: GetConfigSchema,
  message: MessagePacketSchema,
  message_history: MessageHistoryRequestSchema,
  peer_stats: PeerStatsRequestSchema,
  ping: PingSchema,
  pong: PongSchema,
  request: RequestSchema,
  response: ResponseSchema,
  restart: z.literal(true),
  search_history: SearchHistoryDataSchema,
  send_message: SendMessageSchema,
  update_config: UpdateConfigSchema,
}

export type UpdateConfig = RuntimeConfigUpdate
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
    : 'message' in result ? 'message'
    // Backward compatibility with older peers; both old packet forms map to unified message handling.
    : 'store_message' in result ? 'message'
    : 'deliver_message' in result ? 'message'
    : 'peer_stats' in result ? 'peer_stats'
    : 'get_config' in result ? 'get_config'
    : 'announce' in result ? 'announce'
    : 'connect_peer' in result ? 'connect_peer'
    : 'ping' in result ? 'ping'
    : 'pong' in result ? 'pong'
    : 'restart' in result ? 'restart'
    : 'search_history' in result ? 'search_history'
    : 'send_message' in result ? 'send_message'
    : 'update_config' in result ? 'update_config'
    : 'message_history' in result ? 'message_history'
    : null

  parseMessage = (message: string, trace: Trace): false | { data: Message, nonce: number; type: MessageType } => {
    const { nonce, ...result } = JSON.parse(message)

    const type = HIP2_Messaging.identifyType(result)
    if (!type) return trace.caughtError(`[HIP2] Unexpected message ${Object.keys(result)} from ${this.peer.username} ${this.peer.address} ${this.peer.hostname}`)

    const legacyRawValue = result.message ?? result.store_message ?? result.deliver_message
    const parsedValue = type === 'message'
      ? (legacyRawValue && typeof legacyRawValue === 'object' && !Array.isArray(legacyRawValue) && 'envelope' in legacyRawValue
          ? legacyRawValue
          : { envelope: legacyRawValue, hops: 0 })
      : result[type]
    const {data,error} = MessageSchemas[type].safeParse(parsedValue)
    if (!data) return trace.caughtError(`[HIP2] Unexpected ${type} from ${this.peer.username} ${this.peer.address} ${this.peer.hostname}${error ? `: ${JSON.stringify(error.issues).slice(0, 300)}` : ''}`)
    
    trace.step(`[HIP2] Received ${type}${nonce ? ` ${nonce}` : ''} from ${this.peer.username} ${this.peer.address} ${this.peer.hostname}`)

    return { data, nonce, type }
  }
}
