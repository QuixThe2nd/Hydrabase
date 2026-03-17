import z from 'zod'

export const TrackSearchResultSchema = z.object({
  address: z.string().startsWith('0x').transform(v => v as `0x${string}`),
  album: z.string(),
  artists: z.array(z.string()),
  confidence: z.number().min(-1).max(1),
  duration_ms: z.number(),
  external_urls: z.record(z.string(), z.url()),
  id: z.string(),
  image_url: z.url(),
  name: z.string(),
  plugin_id: z.string(),
  popularity: z.number(),
  preview_url: z.string(),
  soul_id: z.string()
})

export const ArtistSearchResultSchema = z.object({
  address: z.string().startsWith('0x').transform(v => v as `0x${string}`),
  confidence: z.number().min(-1).max(1),
  external_urls: z.object({
    itunes: z.url(),
    spotify: z.url()
  }).partial(),
  followers: z.number(),
  genres: z.array(z.string()),
  id: z.string(),
  image_url: z.string(),
  name: z.string(),
  plugin_id: z.string(),
  popularity: z.number(),
  soul_id: z.string()
})

export const AlbumSearchResultSchema = z.object({
  address: z.string().startsWith('0x').transform(v => v as `0x${string}`),
  album_type: z.string(),
  artists: z.array(z.string()),
  confidence: z.number().min(-1).max(1),
  external_urls: z.object({
    itunes: z.url(),
    spotify: z.url()
  }).partial(),
  id: z.string(),
  image_url: z.url(),
  name: z.string(),
  plugin_id: z.string(),
  release_date: z.string(),
  soul_id: z.string(),
  total_tracks: z.number()
})

export interface MetadataPlugin {
  albumTracks: (id: string) => Promise<Omit<Track, 'address' | 'soul_id'>[]>
  artistAlbums: (id: string) => Promise<Omit<Album, 'address' | 'soul_id'>[]>
  artistTracks: (id: string) => Promise<Omit<Track, 'address' | 'soul_id'>[]>
  id: string
  searchAlbums: (query: string) => Promise<Omit<Album, 'address' | 'soul_id'>[]>
  searchArtists: (query: string) => Promise<Omit<Artist, 'address' | 'soul_id'>[]>
  searchTracks: (query: string) => Promise<Omit<Track, 'address' | 'soul_id'>[]>
}


export const RequestSchema = z.object({
  query: z.string(),
  type: z.union([z.literal('tracks'), z.literal('artists'), z.literal('albums'), z.literal('artist.albums'), z.literal('artist.tracks'), z.literal('album.tracks')])
})
export const ResponseSchema = z.union([z.array(TrackSearchResultSchema), z.array(ArtistSearchResultSchema), z.array(AlbumSearchResultSchema)])

export type Album = z.infer<typeof AlbumSearchResultSchema>
export type Artist = z.infer<typeof ArtistSearchResultSchema>
export interface PendingRequest<T extends Request['type']> {
  resolve: (value: false | Response<T>) => void
  startedAt: number
  timeout: ReturnType<typeof setTimeout>
}
export type Props = SearchResultsProps & {
  onClearHistory: () => void
  onHistorySelect: (entry: SearchHistoryEntry) => void
  onRemoveHistory: (entry: SearchHistoryEntry, e: React.MouseEvent) => void
  onSearch: () => void
  searchError: null | string
  searchHistory: SearchHistoryEntry[]
  searchQuery: string
  setSearchQuery: (q: string) => void
  setSearchResults: (searchResults: null | unknown[]) => void
  setSearchType: (t: Request['type']) => void
  setShowHistory: (show: boolean) => void
  showHistory: boolean
}

export type Request = z.infer<typeof RequestSchema>
export type Response<T extends keyof SearchResult = keyof SearchResult> = SearchResult[T][]
export interface SearchHistoryEntry {
  id: number
  query: string
  resultCount: number
  timestamp: number
  type: Request['type']
}

export interface SearchResult {
  'album.tracks': Track
  albums: Album
  'artist.albums': Album
  'artist.tracks': Track
  artists: Artist
  tracks: Track
}

export interface SearchResultsProps {
  onTogglePlay: (id: string, previewUrl: string) => void
  playingId: null | string
  searchElapsed: null | number
  searchLoading: boolean
  searchResults: null | unknown[]
  searchType: Request['type']
}

export type Track = z.infer<typeof TrackSearchResultSchema>
