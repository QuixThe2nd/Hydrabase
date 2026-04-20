import type { MessageReadState } from '../types/hydrabase'
import type { Request } from '../types/hydrabase-schemas'

export interface BwPoint {
  dl: number
  t: number
  ul: number
}

export type ConversationReadState = MessageReadState
export type SearchType = Request['type']