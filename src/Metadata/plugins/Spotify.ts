import { z } from "zod"

import type { MetadataPlugin } from ".."
import type { Album, Artist, Track } from "../../RequestManager"

const spotifyTrackSchema = z.object({
  album: z.object({
    images: z.array(z.object({ height: z.number().optional(), url: z.url(), width: z.number().optional() })),
    name: z.string(),
  }),
  artists: z.array(z.object({ name: z.string() })),
  duration_ms: z.number(),
  external_urls: z.object({ spotify: z.url() }),
  id: z.string(),
  name: z.string(),
  popularity: z.number(),
  preview_url: z.url().nullable().optional(),
})

const spotifyArtistSchema = z.object({
  external_urls: z.object({ spotify: z.url() }),
  followers: z.object({ total: z.number() }),
  genres: z.array(z.string()),
  id: z.string(),
  images: z.array(z.object({ height: z.number().optional(), url: z.url(), width: z.number().optional() })),
  name: z.string(),
  popularity: z.number(),
})

const spotifyAlbumSchema = z.object({
  album_type: z.string(),
  artists: z.array(z.object({ name: z.string() })),
  external_urls: z.object({ spotify: z.url() }),
  id: z.string(),
  images: z.array(z.object({ height: z.number().optional(), url: z.url(), width: z.number().optional() })),
  name: z.string(),
  release_date: z.string(),
  release_date_precision: z.enum(['year', 'month', 'day']).optional(),
  total_tracks: z.number(),
})

export const spotifySearchResponseSchema = z.object({
  tracks: z.object({
    items: z.array(spotifyTrackSchema),
    total: z.number(),
  }),
})

export const spotifyArtistSearchResponseSchema = z.object({
  artists: z.object({
    items: z.array(spotifyArtistSchema),
    total: z.number(),
  }),
})

export const spotifyAlbumSearchResponseSchema = z.object({
  albums: z.object({
    items: z.array(spotifyAlbumSchema),
    total: z.number(),
  }),
})

const spotifyTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  token_type: z.literal('Bearer'),
})

export default class Spotify implements MetadataPlugin {
  public readonly id = "Spotify"
  private accessToken: null | string = null
  private baseUrl = "https://api.spotify.com/v1/"
  private tokenExpiry = 0
  private tokenUrl = "https://accounts.spotify.com/api/token"

  constructor(
    private keys: { clientId: string, clientSecret: string },
    private market = "US",
    private limit = 50
  ) {
    if (limit > 50) {throw new Error("Maximum limit is 50")}
  }

  async albumTracks(id: string): Promise<Omit<Track, 'soul_id' | 'address'>[]> {
    const token = await this.authenticate()

    const params = new URLSearchParams({
      limit: this.limit.toString(),
      market: this.market,
    })

    const response = await fetch(`${this.baseUrl}albums/${id}/tracks?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    const data = await response.json()
    const parsed = spotifySearchResponseSchema.safeParse(data)
    if (!parsed.success) {throw new Error(`Invalid Spotify API response: ${parsed.error}`)}

    return parsed.data.tracks.items.map((track) => ({
      album: track.album.name,
      artists: track.artists.map((a) => a.name),
      confidence: 1,
      duration_ms: track.duration_ms,
      external_urls: track.external_urls,
      id: track.id,
      image_url: track.album.images[0]?.url ?? "",
      name: track.name,
      plugin_id: this.id,
      popularity: track.popularity,
      preview_url: track.preview_url ?? "",
    }))
  }

  async artistAlbums(id: string): Promise<Omit<Album, 'soul_id' | 'address'>[]> {
    const token = await this.authenticate()

    const params = new URLSearchParams({
      limit: this.limit.toString(),
      market: this.market,
    })

    const response = await fetch(`${this.baseUrl}artists/${id}/albums?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    const data = await response.json()
    const parsed = spotifyAlbumSearchResponseSchema.safeParse(data)
    if (!parsed.success) {throw new Error(`Invalid Spotify API response: ${parsed.error}`)}

    return parsed.data.albums.items.map((album) => ({
      album_type: album.album_type,
      artists: album.artists.map((a) => a.name),
      confidence: 1,
      external_urls: album.external_urls,
      id: album.id,
      image_url: album.images[0]?.url ?? "",
      name: album.name,
      plugin_id: this.id,
      release_date: album.release_date,
      total_tracks: album.total_tracks,
    }))
  }

  async artistTracks(id: string): Promise<Omit<Track, 'soul_id' | 'address'>[]> {
    const token = await this.authenticate()

    const params = new URLSearchParams({
      limit: this.limit.toString(),
      market: this.market,
    })

    const response = await fetch(`${this.baseUrl}artists/${id}/tracks?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    const data = await response.json()
    const parsed = spotifySearchResponseSchema.safeParse(data)
    if (!parsed.success) {throw new Error(`Invalid Spotify API response: ${parsed.error}`)}

    return parsed.data.tracks.items.map((track) => ({
      album: track.album.name,
      artists: track.artists.map((a) => a.name),
      confidence: 1,
      duration_ms: track.duration_ms,
      external_urls: track.external_urls,
      id: track.id,
      image_url: track.album.images[0]?.url ?? "",
      name: track.name,
      plugin_id: this.id,
      popularity: track.popularity,
      preview_url: track.preview_url ?? "",
    }))
  }

  async searchAlbum(term: string): Promise<Omit<Album, 'soul_id' | 'address'>[]> {
    const token = await this.authenticate()

    const params = new URLSearchParams({
      limit: this.limit.toString(),
      market: this.market,
      q: term,
      type: "album",
    })
    const response = await fetch(`${this.baseUrl}search?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } })
    const data = await response.json()
    const parsed = spotifyAlbumSearchResponseSchema.safeParse(data)
    if (!parsed.success) {throw new Error(`Invalid Spotify API response: ${parsed.error}`)}

    return parsed.data.albums.items.map(album => ({
      album_type: album.album_type,
      artists: album.artists.map(a => a.name),
      confidence: 1,
      external_urls: album.external_urls,
      id: album.id,
      image_url: album.images[0]?.url ?? "",
      name: album.name,
      plugin_id: this.id,
      release_date: album.release_date,
      total_tracks: album.total_tracks,
    }))
  }

  async searchArtist(term: string): Promise<Omit<Artist, 'soul_id' | 'address'>[]> {
    const token = await this.authenticate()

    const params = new URLSearchParams({
      limit: this.limit.toString(),
      market: this.market,
      q: term,
      type: "artist",
    })

    const response = await fetch(`${this.baseUrl}search?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    const data = await response.json()
    const parsed = spotifyArtistSearchResponseSchema.safeParse(data)
    if (!parsed.success) throw new Error(`Invalid Spotify API response: ${parsed.error}`)

    return parsed.data.artists.items.map(artist => ({
      confidence: 1,
      external_urls: artist.external_urls,
      followers: artist.followers.total,
      genres: artist.genres,
      id: artist.id,
      image_url: artist.images[0]?.url ?? '',
      name: artist.name,
      plugin_id: this.id,
      popularity: artist.popularity,
    }))
  }

  async searchTrack(term: string): Promise<Omit<Track, 'soul_id' | 'address'>[]> {
    const token = await this.authenticate()

    const params = new URLSearchParams({
      limit: this.limit.toString(),
      market: this.market,
      q: term,
      type: "track",
    })

    const response = await fetch(`${this.baseUrl}search?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` }, })

    const data = await response.json()
    const parsed = spotifySearchResponseSchema.safeParse(data)
    if (!parsed.success) throw new Error(`Invalid Spotify API response: ${parsed.error}`)

    return parsed.data.tracks.items.map(track => ({
      album: track.album.name,
      artists: track.artists.map(a => a.name),
      confidence: 1,
      duration_ms: track.duration_ms,
      external_urls: track.external_urls,
      id: track.id,
      image_url: track.album.images[0]?.url ?? "",
      name: track.name,
      plugin_id: this.id,
      popularity: track.popularity,
      preview_url: track.preview_url ?? "",
    }))
  }

  private async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) return this.accessToken
    const response = await fetch(this.tokenUrl, {
      body: new URLSearchParams({ grant_type: "client_credentials" }),
      headers: {
        Authorization: `Basic ${btoa(`${this.keys.clientId}:${this.keys.clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    })
    const data = await response.json()
    const parsed = spotifyTokenResponseSchema.safeParse(data)
    if (!parsed.success) {throw new Error(`Invalid Spotify token response: ${parsed.error}`)}
    this.accessToken = parsed.data.access_token
    this.tokenExpiry = Date.now() + parsed.data.expires_in * 1000 - 60_000 // Refresh 1min early
    return this.accessToken
  }
}
