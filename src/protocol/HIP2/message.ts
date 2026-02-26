import { AnnounceSchema } from '../HIP4/announce';
import { RequestManager, RequestSchema, ResponseSchema, type Request, type Response } from '../../RequestManager';
import type z from 'zod';
import type { Peer } from '../../networking/ws/peer';

const MessageSchemas = {
  request: RequestSchema,
  response: ResponseSchema,
  announce: AnnounceSchema
}

type MessageType = keyof typeof MessageSchemas
type Message<T extends keyof typeof MessageSchemas = keyof typeof MessageSchemas> = z.infer<typeof MessageSchemas[T]>

export class HIP2_Conn_Message {
  constructor(private readonly peer: Peer, private readonly requestManager: RequestManager) {}

  parseMessage = (message: string): { type: MessageType, data: Message, nonce: number } | false => {
    const { nonce, ...result } = JSON.parse(message)

    const type = HIP2_Conn_Message.identifyType(result)
    if (!type) {
      console.warn('WARN:', `[HIP2] Unexpected message from ${this.peer.address}`, `- ${message}`)
      return false
    }

    const data = MessageSchemas[type].safeParse(result[type]).data
    if (!data) {
      console.warn('WARN:', `[HIP2] Unexpected ${type} from ${this.peer.address}`, `- ${message}`)
      return false
    }
    
    console.log('LOG:', `[HIP2] Received ${type}${nonce ? ` ${nonce}` : ''} from ${this.peer.address}`)

    return { type, data, nonce }
  }

  static identifyType = (result: Message): MessageType | null => // 'capability' in result ? 'capability' :
    'request' in result ? 'request'
    : 'response' in result ? 'response'
    : 'announce' in result ? 'announce'
    : null

  public readonly send = {
    request: async <T extends Request['type']>(request: Request & { type: T }): Promise<Response<T>> => {
      const { nonce, promise } = this.requestManager.register<T>()
      console.log('LOG:', `[HIP2] Sending request ${nonce} to peer ${this.peer.address}`)
      this.peer.send(JSON.stringify({ nonce, request }))
      const results = await promise
      console.log('LOG:', `[HIP2] Received ${results.length} results from ${this.peer.address}`)
      return results
    },
    response: async (response: Response, nonce: number) => this.peer.send(JSON.stringify({ response, nonce }))
  }
}
