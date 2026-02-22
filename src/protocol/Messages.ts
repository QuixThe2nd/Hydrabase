import z from 'zod';
import { AlbumSearchResultSchema, ArtistSearchResultSchema, TrackSearchResultSchema } from '../Metadata';
import { RequestSchema, ResponseSchema } from './HIP2/requests';

export const MessageSchemas = {
  request: RequestSchema,
  response: ResponseSchema,
  announce: z.object({
    address: z.string().startsWith('ws://').transform((val) => val as `ws://${string}`)
  })
};

export type Track = z.infer<typeof TrackSearchResultSchema>
export type Artist = z.infer<typeof ArtistSearchResultSchema>
export type Album = z.infer<typeof AlbumSearchResultSchema>

export type Announce = z.infer<typeof MessageSchemas['announce']>
