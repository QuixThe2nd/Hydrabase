import { z } from "zod";
import type { MetadataPlugin, TrackSearchResult, ArtistSearchResult, AlbumSearchResult } from "..";

const iTunesTrackSchema = z.object({
  artistName: z.string(),
  trackName: z.string(),
  artworkUrl100: z.url(),
  trackId: z.number(),
  collectionName: z.string().optional(),
  trackViewUrl: z.url(),
  previewUrl: z.url().optional(),
  trackTimeMillis: z.number().optional()
})

const iTunesArtistSchema = z.object({
  artistId: z.number(),
  artistName: z.string(),
  primaryGenreName: z.string().optional(),
  artworkUrl100: z.url().optional(),
  artistViewUrl: z.url().optional(),
})

const iTunesAlbumSchema = z.object({
  collectionId: z.number(),
  collectionName: z.string(),
  artistName: z.string(),
  artworkUrl100: z.url().optional(),
  collectionViewUrl: z.url().optional(),
  releaseDate: z.string().optional(),
  trackCount: z.number().optional(),
  collectionType: z.string().optional(),
})

export const iTunesSearchResponseSchema = z.object({
  resultCount: z.number(),
  results: z.array(iTunesTrackSchema),
})

export const iTunesArtistSearchResponseSchema = z.object({
  resultCount: z.number(),
  results: z.array(iTunesArtistSchema),
})

export const iTunesAlbumSearchResponseSchema = z.object({
  resultCount: z.number(),
  results: z.array(iTunesAlbumSchema),
})

export default class ITunes implements MetadataPlugin {
  public readonly id = 'iTunes';
  private baseUrl = "https://itunes.apple.com/search";

  constructor(private country: string = "US", private limit: number = 3) {
    if (limit > 200) throw new Error('Maximum limit is 200')
  }

  async searchTrack(term: string): Promise<TrackSearchResult[]> {
    const params = new URLSearchParams({
      term: term.replace(/\s+/g, "+"),
      country: this.country,
      media: 'music',
      entity: 'musicTrack',
      limit: this.limit.toString(),
    });

    const response = await fetch(`${this.baseUrl}?${params.toString()}`);
    const data = await response.json();
    const parsed = iTunesSearchResponseSchema.safeParse(data);
    if (!parsed.success) throw new Error(`Invalid iTunes API response: ${parsed.error}`);

    return parsed.data.results.map(result => ({
      id: String(result.trackId),
      name: result.trackName,
      artists: [result.artistName],
      album: result.collectionName ?? '',
      duration_ms: result.trackTimeMillis ?? 0,
      popularity: 0,
      preview_url: result.previewUrl ?? '',
      external_urls: [result.trackViewUrl],
      image_url: result.artworkUrl100.replace('100x100', '600x600'),
      plugin_id: this.id
    }));
  }

  async searchArtist(term: string): Promise<ArtistSearchResult[]> {
    const params = new URLSearchParams({
      term: term.replace(/\s+/g, "+"),
      country: this.country,
      media: 'music',
      entity: 'musicArtist',
      limit: this.limit.toString(),
    });

    const response = await fetch(`${this.baseUrl}?${params.toString()}`);
    const data = await response.json();
    const parsed = iTunesArtistSearchResponseSchema.safeParse(data);
    if (!parsed.success) throw new Error(`Invalid iTunes API response: ${parsed.error}`);

    return parsed.data.results.map(result => ({
      id: String(result.artistId),
      name: result.artistName,
      popularity: 0,
      genres: result.primaryGenreName ? [result.primaryGenreName] : [],
      followers: 0,
      image_url: result.artworkUrl100?.replace('100x100', '600x600') ?? '',
      external_urls: result.artistViewUrl ? [result.artistViewUrl] : [],
      plugin_id: this.id
    }));
  }

  async searchAlbum(term: string): Promise<AlbumSearchResult[]> {
    const params = new URLSearchParams({
      term: term.replace(/\s+/g, "+"),
      country: this.country,
      media: 'music',
      entity: 'album',
      limit: this.limit.toString(),
    });

    const response = await fetch(`${this.baseUrl}?${params.toString()}`);
    const data = await response.json();
    const parsed = iTunesAlbumSearchResponseSchema.safeParse(data);
    if (!parsed.success) throw new Error(`Invalid iTunes API response: ${parsed.error}`);

    return parsed.data.results.map(result => {
      const trackCount = result.trackCount ?? 0;
      let albumType: string;
      if (trackCount <= 3) albumType = 'single';
      else if (trackCount <= 6) albumType = 'ep';
      else albumType = 'album';

      return {
        id: String(result.collectionId),
        name: result.collectionName,
        artists: [result.artistName],
        release_date: result.releaseDate ?? '',
        total_tracks: trackCount,
        album_type: albumType,
        image_url: result.artworkUrl100?.replace('100x100', '600x600') ?? '',
        external_urls: result.collectionViewUrl ? [result.collectionViewUrl] : [],
        plugin_id: this.id,
      };
    });
  }
}
