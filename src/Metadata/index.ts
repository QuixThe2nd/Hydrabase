import z from 'zod';
import type { Request } from '../utils/Messages'
import { startDatabase } from '../utils/database';
import { CONFIG } from '../config';
import { schema } from '../schema';

export const TrackSearchResultSchema = z.object({
  soul_id: z.string(),
  id: z.string(),
  name: z.string(),
  artists: z.array(z.string()),
  album: z.string(),
  duration_ms: z.number(),
  popularity: z.number(),
  preview_url: z.string(),
  external_urls: z.record(z.string(), z.url()),
  image_url: z.url(),
  plugin_id: z.string(),
  confidence: z.number()
})

export type TrackSearchResult = z.infer<typeof TrackSearchResultSchema>

export const ArtistSearchResultSchema = z.object({
  soul_id: z.string(),
  id: z.string(),
  name: z.string(),
  popularity: z.number(),
  genres: z.array(z.string()),
  followers: z.number(),
  external_urls: z.object({
    itunes: z.url(),
    spotify: z.url()
  }).partial(),
  image_url: z.string(),
  plugin_id: z.string(),
  confidence: z.number()
})
export type ArtistSearchResult = z.infer<typeof ArtistSearchResultSchema>

export const AlbumSearchResultSchema = z.object({
  soul_id: z.string(),
  id: z.string(),
  name: z.string(),
  artists: z.array(z.string()),
  release_date: z.string(),
  total_tracks: z.number(),
  album_type: z.string(),
  image_url: z.url(),
  external_urls: z.object({
    itunes: z.url(),
    spotify: z.url()
  }).partial(),
  plugin_id: z.string(),
  confidence: z.number()
})
export type AlbumSearchResult = z.infer<typeof AlbumSearchResultSchema>

export interface SearchResult {
  track: TrackSearchResult
  artist: ArtistSearchResult
  album: AlbumSearchResult
}

export interface MetadataPlugin {
  id: string
  searchTrack: (query: string) => Promise<TrackSearchResult[]>
  searchArtist: (query: string) => Promise<ArtistSearchResult[]>
  searchAlbum: (query: string) => Promise<AlbumSearchResult[]>
}

export default class MetadataManager implements MetadataPlugin {
  public readonly id = 'Hydrabase'
  constructor(private readonly plugins: MetadataPlugin[], private readonly db: ReturnType<typeof startDatabase>) {}

  async searchTrack(query: string): Promise<TrackSearchResult[]> {
    const results: TrackSearchResult[] = [];
    for (const plugin of this.plugins) results.push(...await plugin.searchTrack(query))
    for (const result of results) this.db.insert(schema['track']).values({ ...result, artists: result.artists.join(','), external_urls: JSON.stringify(result.external_urls), address: '0x0', confidence: Number.MAX_SAFE_INTEGER }).onConflictDoNothing().run()
    return results.map(result => ({ ...result, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, CONFIG.soulIdCutoff))}` }));
  }

  async searchArtist(query: string): Promise<ArtistSearchResult[]> {
    const results: ArtistSearchResult[] = [];
    for (const plugin of this.plugins) results.push(...await plugin.searchArtist(query))
    for (const result of results) this.db.insert(schema['artist']).values({ ...result, genres: result.genres.join(','), external_urls: JSON.stringify(result.external_urls), address: '0x0', confidence: Number.MAX_SAFE_INTEGER }).onConflictDoNothing().run()
    return results.map(result => ({ ...result, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, CONFIG.soulIdCutoff))}` }));
  }

  async searchAlbum(query: string): Promise<AlbumSearchResult[]> {
    const results: AlbumSearchResult[] = [];
    for (const plugin of this.plugins) results.push(...await plugin.searchAlbum(query))
    for (const result of results) this.db.insert(schema['album']).values({ ...result, artists: result.artists.join(','), external_urls: JSON.stringify(result.external_urls), address: '0x0', confidence: Number.MAX_SAFE_INTEGER }).onConflictDoNothing().run()
    return results.map(result => ({ ...result, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, CONFIG.soulIdCutoff))}` }));
  }

  public async handleRequest<T extends Request['type']>(request: Request & { type: T }) {
    if (request.type === 'track') return await this.searchTrack(request.query)
    if (request.type === 'artist') return await this.searchArtist(request.query)
    if (request.type === 'album') return await this.searchAlbum(request.query)
    else {
      console.warn('WARN:', 'Invalid request')
      return []
    }
  }
}
