import { z } from "zod";
import type { AlbumSearchResult, ArtistSearchResult, MetadataPlugin, TrackSearchResult } from "..";

const spotifyTrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  artists: z.array(z.object({ name: z.string() })),
  album: z.object({
    name: z.string(),
    images: z.array(z.object({ url: z.url(), height: z.number().optional(), width: z.number().optional() })),
  }),
  duration_ms: z.number(),
  popularity: z.number(),
  preview_url: z.url().nullable().optional(),
  external_urls: z.object({ spotify: z.url() }),
});

const spotifyArtistSchema = z.object({
  id: z.string(),
  name: z.string(),
  popularity: z.number(),
  genres: z.array(z.string()),
  followers: z.object({ total: z.number() }),
  images: z.array(z.object({ url: z.url(), height: z.number().optional(), width: z.number().optional() })),
  external_urls: z.object({ spotify: z.url() }),
});

const spotifyAlbumSchema = z.object({
  id: z.string(),
  name: z.string(),
  artists: z.array(z.object({ name: z.string() })),
  release_date: z.string(),
  release_date_precision: z.enum(['year', 'month', 'day']).optional(),
  total_tracks: z.number(),
  album_type: z.string(),
  images: z.array(z.object({ url: z.url(), height: z.number().optional(), width: z.number().optional() })),
  external_urls: z.object({ spotify: z.url() }),
});

export const spotifySearchResponseSchema = z.object({
  tracks: z.object({
    items: z.array(spotifyTrackSchema),
    total: z.number(),
  }),
});

export const spotifyArtistSearchResponseSchema = z.object({
  artists: z.object({
    items: z.array(spotifyArtistSchema),
    total: z.number(),
  }),
});

export const spotifyAlbumSearchResponseSchema = z.object({
  albums: z.object({
    items: z.array(spotifyAlbumSchema),
    total: z.number(),
  }),
});

const spotifyTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number(),
});

export default class Spotify implements MetadataPlugin {
  public readonly id = "Spotify";
  private baseUrl = "https://api.spotify.com/v1/search";
  private tokenUrl = "https://accounts.spotify.com/api/token";
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(
    private clientId: string,
    private clientSecret: string,
    private market: string = "US",
    private limit: number = 3
  ) {
    if (limit > 50) throw new Error("Maximum limit is 50");
  }

  private async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const response = await fetch(this.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`,
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    });

    const data = await response.json();
    const parsed = spotifyTokenResponseSchema.safeParse(data);
    if (!parsed.success) throw new Error(`Invalid Spotify token response: ${parsed.error}`);

    this.accessToken = parsed.data.access_token;
    this.tokenExpiry = Date.now() + parsed.data.expires_in * 1000 - 60_000; // refresh 1min early

    return this.accessToken;
  }

  async searchTrack(term: string): Promise<TrackSearchResult[]> {
    const token = await this.authenticate();

    const params = new URLSearchParams({
      q: term,
      type: "track",
      market: this.market,
      limit: this.limit.toString(),
    });

    const response = await fetch(`${this.baseUrl}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await response.json();
    const parsed = spotifySearchResponseSchema.safeParse(data);
    if (!parsed.success) throw new Error(`Invalid Spotify API response: ${parsed.error}`);

    return parsed.data.tracks.items.map((track) => ({
      soul_id: 'soul_', // Ignored
      id: track.id,
      name: track.name,
      artists: track.artists.map((a) => a.name),
      album: track.album.name,
      duration_ms: track.duration_ms,
      popularity: track.popularity,
      preview_url: track.preview_url ?? "",
      external_urls: track.external_urls,
      image_url: track.album.images[0]?.url ?? "",
      plugin_id: this.id,
      confidence: Number.MAX_SAFE_INTEGER,
    }));
  }

  async searchArtist(term: string): Promise<ArtistSearchResult[]> {
    const token = await this.authenticate();

    const params = new URLSearchParams({
      q: term,
      type: "artist",
      market: this.market,
      limit: this.limit.toString(),
    });

    const response = await fetch(`${this.baseUrl}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await response.json();
    const parsed = spotifyArtistSearchResponseSchema.safeParse(data);
    if (!parsed.success) throw new Error(`Invalid Spotify API response: ${parsed.error}`);

    return parsed.data.artists.items.map((artist) => ({
      soul_id: 'soul_', // Ignored
      id: artist.id,
      name: artist.name,
      popularity: artist.popularity,
      genres: artist.genres,
      followers: artist.followers.total,
      image_url: artist.images[0]?.url ?? '',
      external_urls: artist.external_urls,
      plugin_id: this.id,
      confidence: Number.MAX_SAFE_INTEGER,
    }));
  }

  async searchAlbum(term: string): Promise<AlbumSearchResult[]> {
    const token = await this.authenticate();

    const params = new URLSearchParams({
      q: term,
      type: "album",
      market: this.market,
      limit: this.limit.toString(),
    });

    const response = await fetch(`${this.baseUrl}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await response.json();
    const parsed = spotifyAlbumSearchResponseSchema.safeParse(data);
    if (!parsed.success) throw new Error(`Invalid Spotify API response: ${parsed.error}`);

    return parsed.data.albums.items.map((album) => ({
      soul_id: 'soul_', // Ignored
      id: album.id,
      name: album.name,
      artists: album.artists.map((a) => a.name),
      release_date: album.release_date,
      total_tracks: album.total_tracks,
      album_type: album.album_type,
      image_url: album.images[0]?.url ?? "",
      external_urls: album.external_urls,
      plugin_id: this.id,
      confidence: Number.MAX_SAFE_INTEGER,
    }));
  }
}
