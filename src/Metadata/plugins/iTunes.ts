import { z } from "zod"

import type { MetadataPlugin } from ".."
import type { Album, Artist, Track } from "../../RequestManager"

const iTunesTrackSearchSchema = z.object({
  artistName: z.string(),
  artworkUrl100: z.url(),
  collectionName: z.string().optional(),
  previewUrl: z.url().optional(),
  trackId: z.number(),
  trackName: z.string(),
  trackTimeMillis: z.number().optional(),
  trackViewUrl: z.url()
})

const iTunesArtistSchema = z.object({
  artistId: z.number(),
  artistName: z.string(),
  artistViewUrl: z.url().optional(),
  artworkUrl100: z.url().optional(),
  primaryGenreName: z.string().optional(),
})

const iTunesAlbumSearchSchema = z.object({
  artistName: z.string(),
  artworkUrl100: z.url().optional(),
  collectionId: z.number(),
  collectionName: z.string(),
  collectionType: z.string().optional(),
  collectionViewUrl: z.url().optional(),
  releaseDate: z.string().optional(),
  trackCount: z.number().optional(),
})

const iTunesTrackLookupSchema = z.object({
  artistName: z.string(),
  artworkUrl100: z.url(),
  collectionName: z.string().optional(),
  previewUrl: z.url().optional(),
  trackId: z.number(),
  trackName: z.string(),
  trackTimeMillis: z.number().optional(),
  trackViewUrl: z.url()
})

const iTunesAlbumLookupSchema = z.object({
  artistName: z.string(),
  artworkUrl100: z.url().optional(),
  collectionId: z.number(),
  collectionName: z.string(),
  collectionType: z.string().optional(),
  collectionViewUrl: z.url().optional(),
  releaseDate: z.string().optional(),
  trackCount: z.number().optional(),
})

const iTunesTrackSearchResponseSchema = z.object({
  resultCount: z.number(),
  results: z.array(iTunesTrackSearchSchema),
})

const iTunesArtistSearchResponseSchema = z.object({
  resultCount: z.number(),
  results: z.array(iTunesArtistSchema),
})

const iTunesAlbumSearchResponseSchema = z.object({
  resultCount: z.number(),
  results: z.array(iTunesAlbumSearchSchema),
})

const iTunesTrackLookupResponseSchema = z.object({
  resultCount: z.number(),
  results: z.array(iTunesTrackLookupSchema),
})

const iTunesAlbumLookupResponseSchema = z.object({
  resultCount: z.number(),
  results: z.array(iTunesAlbumLookupSchema),
})

export default class ITunes implements MetadataPlugin {
  public readonly id = 'iTunes';
  private baseUrl = "https://itunes.apple.com/";

  constructor(private country = "US", private limit = 200) {
    if (limit > 200) {throw new Error('Maximum limit is 200')}
  }

  async albumTracks(id: string): Promise<Omit<Track, 'soul_id' | 'address'>[]> {
    const params = new URLSearchParams({
      country: this.country,
      entity: 'song',
      id,
      limit: this.limit.toString(),
      media: 'music',
    });

    const response = await fetch(`${this.baseUrl}lookup?${params.toString()}`);
    const data = await response.json();
    data.results = data.results.filter((result: {wrapperType:string}) => result.wrapperType === 'track')
    const parsed = iTunesTrackLookupResponseSchema.safeParse(data);
    if (!parsed.success) {throw new Error(`Invalid iTunes API response: ${parsed.error}`);}

    return parsed.data.results.map(result => ({
      album: result.collectionName ?? '',
      artists: [result.artistName],
      confidence: 1,
      duration_ms: result.trackTimeMillis ?? 0,
      external_urls: { itunes: result.trackViewUrl },
      id: String(result.trackId),
      image_url: result.artworkUrl100.replace('100x100', '600x600'),
      name: result.trackName,
      plugin_id: this.id,
      popularity: 0,
      preview_url: result.previewUrl ?? '',
    }))
  }

  async artistAlbums(id: string): Promise<Omit<Album, 'soul_id' | 'address'>[]> {
    const params = new URLSearchParams({
      country: this.country,
      entity: 'album',
      id,
      limit: this.limit.toString(),
      media: 'music',
    });

    const response = await fetch(`${this.baseUrl}lookup?${params.toString()}`);
    const data = await response.json();
    data.results = data.results.filter((result: {wrapperType:string}) => result.wrapperType === 'album')
    const parsed = iTunesAlbumLookupResponseSchema.safeParse(data);
    if (!parsed.success) {throw new Error(`Invalid iTunes API response: ${parsed.error}`);}

    return parsed.data.results.map(result => {
      const trackCount = result.trackCount ?? 0
      const albumType = trackCount <= 3 ? 'single' : trackCount <= 6 ? 'ep' : 'album'
      return {
        address: '0x0',
        album_type: albumType,
        artists: [result.artistName],
        confidence: 1,
        external_urls: result.collectionViewUrl ? { itunes: result.collectionViewUrl } : {},
        id: String(result.collectionId),
        image_url: result.artworkUrl100?.replace('100x100', '600x600') ?? '',
        name: result.collectionName,
        plugin_id: this.id,
        release_date: result.releaseDate ?? '',
        total_tracks: trackCount,
      };
    });
  }

  async artistTracks(id: string): Promise<Omit<Track, 'soul_id' | 'address'>[]> {
    const params = new URLSearchParams({
      country: this.country,
      entity: 'song',
      id,
      limit: this.limit.toString(),
      media: 'music',
    });

    const response = await fetch(`${this.baseUrl}lookup?${params.toString()}`);
    const data = await response.json();
    data.results = data.results.filter((result: {wrapperType:string}) => result.wrapperType === 'track')
    const parsed = iTunesTrackLookupResponseSchema.safeParse(data);
    if (!parsed.success) {throw new Error(`Invalid iTunes API response: ${parsed.error}`);}

    return parsed.data.results.map(result => ({
      album: result.collectionName ?? '',
      artists: [result.artistName],
      confidence: 1,
      duration_ms: result.trackTimeMillis ?? 0,
      external_urls: { itunes: result.trackViewUrl },
      id: String(result.trackId),
      image_url: result.artworkUrl100.replace('100x100', '600x600'),
      name: result.trackName,
      plugin_id: this.id,
      popularity: 0,
      preview_url: result.previewUrl ?? '',
    }))
  }

  async searchAlbum(term: string): Promise<Omit<Album, 'soul_id' | 'address'>[]> {
    const params = new URLSearchParams({
      country: this.country,
      entity: 'album',
      limit: this.limit.toString(),
      media: 'music',
      term: term.replace(/\s+/gu, "+"),
    });

    const response = await fetch(`${this.baseUrl}search?${params.toString()}`);
    const data = await response.json();
    const parsed = iTunesAlbumSearchResponseSchema.safeParse(data);
    if (!parsed.success) {throw new Error(`Invalid iTunes API response: ${parsed.error}`);}

    return parsed.data.results.map(result => {
      const trackCount = result.trackCount ?? 0;
      const albumType = trackCount <= 3 ? 'single' : trackCount <= 6 ? 'ep' : 'album'
      return {
        address: '0x0',
        album_type: albumType,
        artists: [result.artistName],
        confidence: 1,
        external_urls: result.collectionViewUrl ? { itunes: result.collectionViewUrl } : {},
        id: String(result.collectionId),
        image_url: result.artworkUrl100?.replace('100x100', '600x600') ?? '',
        name: result.collectionName,
        plugin_id: this.id,
        release_date: result.releaseDate ?? '',
        total_tracks: trackCount,
      };
    });
  }

  async searchArtist(term: string): Promise<Omit<Artist, 'soul_id' | 'address'>[]> {
    const params = new URLSearchParams({
      country: this.country,
      entity: 'musicArtist',
      limit: this.limit.toString(),
      media: 'music',
      term: term.replace(/\s+/gu, "+"),
    });

    const response = await fetch(`${this.baseUrl}search?${params.toString()}`);
    const data = await response.json();
    const parsed = iTunesArtistSearchResponseSchema.safeParse(data);
    if (!parsed.success) {throw new Error(`Invalid iTunes API response: ${parsed.error}`);}

    return parsed.data.results.map(result => ({
      confidence: 1,
      external_urls: result.artistViewUrl ? { itunes: result.artistViewUrl } : {},
      followers: 0,
      genres: result.primaryGenreName ? [result.primaryGenreName] : [],
      id: String(result.artistId),
      image_url: result.artworkUrl100?.replace('100x100', '600x600') ?? '',
      name: result.artistName,
      plugin_id: this.id,
      popularity: 0,
    }));
  }

  async searchTrack(term: string): Promise<Omit<Track, 'soul_id' | 'address'>[]> {
    const params = new URLSearchParams({
      country: this.country,
      entity: 'musicTrack',
      limit: this.limit.toString(),
      media: 'music',
      term: term.replace(/\s+/gu, "+"),
    });

    const response = await fetch(`${this.baseUrl}search?${params.toString()}`);
    const data = await response.json();
    const parsed = iTunesTrackSearchResponseSchema.safeParse(data);
    if (!parsed.success) {throw new Error(`Invalid iTunes API response: ${parsed.error}`);}

    return parsed.data.results.map(result => ({
      album: result.collectionName ?? '',
      artists: [result.artistName],
      confidence: 1,
      duration_ms: result.trackTimeMillis ?? 0,
      external_urls: { itunes: result.trackViewUrl },
      id: String(result.trackId),
      image_url: result.artworkUrl100.replace('100x100', '600x600'),
      name: result.trackName,
      plugin_id: this.id,
      popularity: 0,
      preview_url: result.previewUrl ?? '',
    }));
  }
}
