import { CapabilitySchema } from '../HIP1/capabilities';
import { AnnounceSchema } from '../HIP4/announce';
import { RequestSchema, ResponseSchema } from '../../RequestManager';

export const MessageSchemas = {
  capability: CapabilitySchema,
  request: RequestSchema,
  response: ResponseSchema,
  announce: AnnounceSchema
};

export class HIP2_Conn_Message {
  static identifyType = (result: any): keyof typeof MessageSchemas | null => 'capability' in result ? 'capability'
    : 'request' in result ? 'request'
    : 'response' in result ? 'response'
    : 'announce' in result ? 'announce'
    : null
  static parse = (type: keyof typeof MessageSchemas, result: any) => MessageSchemas[type].safeParse(result[type]).data
}
