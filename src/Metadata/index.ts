import z from 'zod';
import type { Request } from '../Messages'
import { startDatabase } from '../database';
import { tracks, artists, albums } from '../schema';
import { CONFIG } from '../config';

export const TrackSearchResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  artists: z.array(z.string()),
  album: z.string(),
  duration_ms: z.number(),
  popularity: z.number(),
  preview_url: z.url(),
  external_urls: z.record(z.string(), z.url()),
  image_url: z.url(),
  plugin_id: z.string()
})

export type TrackSearchResult = z.infer<typeof TrackSearchResultSchema>

export const ArtistSearchResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  popularity: z.number(),
  genres: z.array(z.string()),
  followers: z.number(),
  external_urls: z.object({
    itunes: z.url(),
    spotify: z.url()
  }).partial(),
  image_url: z.url(),
  plugin_id: z.string()
})
export type ArtistSearchResult = z.infer<typeof ArtistSearchResultSchema>

export const AlbumSearchResultSchema = z.object({
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
  plugin_id: z.string()
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
  private readonly db = startDatabase();
  constructor(private readonly plugins: MetadataPlugin[]) {}

  async searchTrack(query: string): Promise<(TrackSearchResult & { soul_id: `soul_${string}` })[]> { // TODO: Merge duplicate artists from diff plugins
    const results: TrackSearchResult[] = [];
    for (const plugin of this.plugins) results.push(...await plugin.searchTrack(query))
    for (const result of results) this.db.insert(tracks).values({ ...result, artists: result.artists.join(','), external_urls: JSON.stringify(result.external_urls) }).onConflictDoNothing().run()
    return results.map(result => ({ soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, CONFIG.soulIdCutoff))}`, ...result }));
  }

  async searchArtist(query: string): Promise<(ArtistSearchResult & { soul_id: `soul_${string}` })[]> {
    const results: ArtistSearchResult[] = [];
    for (const plugin of this.plugins) results.push(...await plugin.searchArtist(query))
    for (const result of results) this.db.insert(artists).values({ ...result, genres: result.genres.join(','), external_urls: JSON.stringify(result.external_urls) }).onConflictDoNothing().run()
    return results.map(result => ({ soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, CONFIG.soulIdCutoff))}`, ...result }));
  }

  async searchAlbum(query: string): Promise<(AlbumSearchResult & { soul_id: `soul_${string}` })[]> {
    const results: AlbumSearchResult[] = [];
    for (const plugin of this.plugins) results.push(...await plugin.searchAlbum(query))
    for (const result of results) this.db.insert(albums).values({ ...result, artists: result.artists.join(','), external_urls: JSON.stringify(result.external_urls) }).onConflictDoNothing().run()
    return results.map(result => ({ soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, CONFIG.soulIdCutoff))}`, ...result }));
  }

  public async handleRequest<T extends Request['type']>(request: Request & { type: T }) {
    // TODO: search db cache
    if (request.type === 'track') return await this.searchTrack(request.query)
    if (request.type === 'artist') return await this.searchArtist(request.query)
    if (request.type === 'album') return await this.searchAlbum(request.query)
    else {
      console.warn('WARN:', 'Invalid request')
      return []
    }
  }
}

// TODO: Save peer responses to db
