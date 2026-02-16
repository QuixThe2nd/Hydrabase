import { z } from "zod";
import type { MetadataPlugin, SearchResult } from "..";
import env from './.spotify.env' with { type: "text" };

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

export const spotifySearchResponseSchema = z.object({
  tracks: z.object({
    items: z.array(spotifyTrackSchema),
    total: z.number(),
  }),
});

const spotifyTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number(),
});

const ENV: Record<string, string> = Object.fromEntries(env.split('\n').map(line => line.split('=') as [string, string]))

export default class Spotify implements MetadataPlugin {
  public readonly id = "Spotify";
  private baseUrl = "https://api.spotify.com/v1/search";
  private tokenUrl = "https://accounts.spotify.com/api/token";
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(
    private clientId: string | undefined = ENV.CLIENT_ID,
    private clientSecret: string | undefined = ENV.CLIENT_SECRET,
    private market: string = "US",
    private limit: number = 3
  ) {
    if (limit > 50) throw new Error("Maximum limit is 50");
    if (clientId === undefined || clientSecret === undefined) console.error('ERROR:', 'Spotify plugin not setup, create .spotify.env file in plugin dir with CLIENT_ID and CLIENT_SECRET')
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

  async search(term: string): Promise<SearchResult[]> {
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
      id: track.id,
      name: track.name,
      artists: track.artists.map((a) => a.name),
      album: track.album.name,
      duration_ms: track.duration_ms,
      popularity: track.popularity,
      preview_url: track.preview_url ?? "",
      external_urls: [track.external_urls.spotify],
      image_url: track.album.images[0]?.url ?? "",
      plugin_id: this.id,
    }));
  }
}