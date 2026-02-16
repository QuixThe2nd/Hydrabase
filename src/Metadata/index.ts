import z from 'zod';
import type { Request, Response } from '../Messages'

export const TrackSearchResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  artists: z.array(z.string()),
  album: z.string(),
  duration_ms: z.number(),
  popularity: z.number(),
  preview_url: z.url(),
  external_urls: z.array(z.url()),
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
  external_urls: z.array(z.url()),
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
  external_urls: z.array(z.url()),
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

export default class MetadataManager {
  constructor(private readonly plugins: MetadataPlugin[]) {}

  async searchTrack(query: string): Promise<TrackSearchResult[]> {
    const results: TrackSearchResult[] = [];
    for (const plugin of this.plugins) results.push(...await plugin.searchTrack(query))
    return results;
  }

  async searchArtist(query: string): Promise<ArtistSearchResult[]> {
    const results: ArtistSearchResult[] = [];
    for (const plugin of this.plugins) results.push(...await plugin.searchArtist(query))
    return results;
  }

  async searchAlbum(query: string): Promise<AlbumSearchResult[]> {
    const results: AlbumSearchResult[] = [];
    for (const plugin of this.plugins) results.push(...await plugin.searchAlbum(query))
    return results;
  }

  public async handleRequest<T extends Request['type']>(request: Request & { type: T }): Promise<Response<T>> {
    if (request.type === 'track') return await this.searchTrack(request.query) as Response<T>
    if (request.type === 'artist') return await this.searchArtist(request.query) as Response<T>
    if (request.type === 'album') return await this.searchAlbum(request.query) as Response<T>
    else {
      console.warn('WARN:', 'Invalid request')
      return []
    }
  }
}

/*
TODO: Database
store songs in db, source: itunes/musicbrainz/spotify, song id, song name, etc
create table that matches songs across sources
*/
