import z from 'zod';
import { AlbumSearchResultSchema, ArtistSearchResultSchema, TrackSearchResultSchema } from '../Metadata';

export const MessageSchemas = {
  request: z.object({
    type: z.union([z.literal('track'), z.literal('artist'), z.literal('album')]),
    query: z.string()
  }),
  response: z.union([z.array(TrackSearchResultSchema), z.array(ArtistSearchResultSchema), z.array(AlbumSearchResultSchema)]),
  announce: z.object({
    address: z.string().startsWith('ws://').transform((val) => val as `ws://${string}`)
  })
};

export type Track = z.infer<typeof TrackSearchResultSchema>
export type Artist = z.infer<typeof ArtistSearchResultSchema>
export type Album = z.infer<typeof AlbumSearchResultSchema>

interface MessageMap {
  track: z.infer<typeof TrackSearchResultSchema>[];
  artist: z.infer<typeof ArtistSearchResultSchema>[];
  album: z.infer<typeof AlbumSearchResultSchema>[];
}

export type Response<T extends keyof MessageMap = keyof MessageMap> = MessageMap[T]
export type Request = z.infer<(typeof MessageSchemas)['request']>
export type Announce = z.infer<(typeof MessageSchemas)['announce']>
