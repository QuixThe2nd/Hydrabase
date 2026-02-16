import z from 'zod';
import { AlbumSearchResultSchema, ArtistSearchResultSchema, TrackSearchResultSchema } from './Metadata';

const message = {
  request: z.object({
    type: z.union([z.literal('track'), z.literal('artist'), z.literal('album')]),
    query: z.string()
  }),
  response: z.union([z.array(TrackSearchResultSchema), z.array(ArtistSearchResultSchema), z.array(AlbumSearchResultSchema)]),
};

const MessageSchemas = { message } as const;
export type Request = z.infer<(typeof MessageSchemas)[keyof typeof MessageSchemas]['request']>;

interface MessageMap {
  track: z.infer<typeof TrackSearchResultSchema>[];
  artist: z.infer<typeof ArtistSearchResultSchema>[];
  album: z.infer<typeof AlbumSearchResultSchema>[];
}

export type Response<T extends keyof MessageMap = keyof MessageMap> = MessageMap[T];

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
