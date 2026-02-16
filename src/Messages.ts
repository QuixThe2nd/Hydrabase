import z from 'zod';
import { SearchResultSchema } from './Metadata';

type Message = { request: z.ZodObject, response: z.ZodArray<z.ZodObject> }

const search = {
  request: z.object({
    type: z.literal('search'),
    trackName: z.string()
  }),
  response: z.array(SearchResultSchema),
} satisfies Message;

const MessageSchemas = { search } as const satisfies Record<string, Message>;
export type Request = z.infer<(typeof MessageSchemas)[keyof typeof MessageSchemas]['request']>;
export type Response = z.infer<(typeof MessageSchemas)[keyof typeof MessageSchemas]['response']>;

type MessageKey = keyof typeof MessageSchemas;
type MatchResult<K extends MessageKey = MessageKey> = z.infer<(typeof MessageSchemas)[K]['request']>;

export function matchRequest(value: unknown): MatchResult | null {
  for (const key of Object.keys(MessageSchemas) as MessageKey[]) {
    const result = MessageSchemas[key].request.safeParse(value);
    if (result.success) return result.data;
  }
  return null;
}

export function matchMessage(value: unknown): 'request' | 'response' | null {
  for (const key of Object.keys(MessageSchemas) as MessageKey[]) {
    if (MessageSchemas[key].request.safeParse(value).success) return 'request';
    if (MessageSchemas[key].response.safeParse(value).success) return 'response';
  }
  return null;
}
