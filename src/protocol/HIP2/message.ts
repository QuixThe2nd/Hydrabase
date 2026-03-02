import z from 'zod';

import type { Peer } from '../../networking/ws/peer';

import { log, warn } from '../../log';
import { type Request, RequestManager, RequestSchema, type Response, ResponseSchema } from '../../RequestManager';
import { AnnounceSchema } from '../HIP4/announce';

export const PeerStatsRequestSchema = z.object({ address: z.string().regex(/^0x/iu).transform(v => v as `0x${string}`) })

const MessageSchemas = {
  announce: AnnounceSchema,
  peer_stats: PeerStatsRequestSchema,
  request: RequestSchema,
  response: ResponseSchema
}

type Message<T extends keyof typeof MessageSchemas = keyof typeof MessageSchemas> = z.infer<typeof MessageSchemas[T]>
type MessageType = keyof typeof MessageSchemas

export class HIP2_Conn_Message {
  public readonly send = {
    request: async <T extends Request['type']>(request: Request & { type: T }): Promise<Response<T>> => {
      const { nonce, promise } = this.requestManager.register<T>()
      log('LOG:', `[HIP2] Sending request ${nonce} to peer ${this.peer.address}`)
      this.peer.send(JSON.stringify({ nonce, request }))
      const results = await promise
      log('LOG:', `[HIP2] Received ${results.length} results from ${this.peer.address}`)
      return results
    },
    response: (response: Response, nonce: number) => this.peer.send(JSON.stringify({ nonce, response }))
  }

  constructor(private readonly peer: Peer, private readonly requestManager: RequestManager) {}

  static readonly identifyType = (result: Message): MessageType | null => // 'capability' in result ? 'capability' :
    'request' in result ? 'request'
    : 'response' in result ? 'response'
    : 'announce' in result ? 'announce'
    : 'peer_stats' in result ? 'peer_stats'
    : null

  parseMessage = (message: string): false | { data: Message, nonce: number; type: MessageType } => {
    const { nonce, ...result } = JSON.parse(message)

    const type = HIP2_Conn_Message.identifyType(result)
    if (!type) return warn('DEVWARN:', `[HIP2] Unexpected message from ${this.peer.address}`, `- ${message}`)

    const {data,error} = MessageSchemas[type].safeParse(result[type])
    if (!data) return warn('DEVWARN:', `[HIP2] Unexpected ${type} from ${this.peer.address}`, error ? {error:error.issues, message} : {message})
    
    log('LOG:', `[HIP2] Received ${type}${nonce ? ` ${nonce}` : ''} from ${this.peer.address}`)

    return { data, nonce, type }
  }
}
