import { z } from "zod";
import type { MetadataPlugin, SearchResult } from "..";

const iTunesTrackSchema = z.object({
  artistName: z.string(),
  trackName: z.string(),
  artworkUrl100: z.url(),
  primaryGenreName: z.string(),
  wrapperType: z.literal("track"),
  kind: z.enum(["song", "music-video"]),
  artistId: z.number(),
  collectionId: z.number().optional(),
  trackId: z.number(),
  collectionArtistId: z.number().optional(),
  collectionArtistName: z.string().optional(),
  contentAdvisoryRating: z.literal('Clean').optional(),
  collectionName: z.string().optional(),
  collectionCensoredName: z.string().optional(),
  trackCensoredName: z.string(),
  artistViewUrl: z.url().optional(),
  collectionArtistViewUrl: z.url().optional(),
  collectionViewUrl: z.url().optional(),
  trackViewUrl: z.url(),
  previewUrl: z.url().optional(),
  artworkUrl30: z.url(),
  artworkUrl60: z.url(),
  collectionPrice: z.number().optional(),
  trackPrice: z.number().optional(),
  releaseDate: z.string(),
  isStreamable: z.boolean().optional(),
  collectionExplicitness: z.enum(["explicit", "cleaned", "notExplicit"]),
  trackExplicitness: z.enum(["explicit", "cleaned", "notExplicit"]),
  discCount: z.number().optional(),
  discNumber: z.number().optional(),
  trackCount: z.number().optional(),
  trackNumber: z.number().optional(),
  trackTimeMillis: z.number().optional(),
  country: z.string(),
  currency: z.string(),
}).strict();

export const iTunesSearchResponseSchema = z.object({
  resultCount: z.number(),
  results: z.array(iTunesTrackSchema),
});

export default class ITunes implements MetadataPlugin {
  public readonly id = 'iTunes';
  private baseUrl = "https://itunes.apple.com/search";

  constructor(private country: string = "US", private limit: number = 3) {
    if (limit > 200) throw new Error('Maximum limit is 200')
  }

  async search(term: string): Promise<SearchResult[]> {
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
      artistName: result.artistName,
      trackName: result.trackName,
      genre: result.primaryGenreName,
      artworkUrl: result.artworkUrl100,
      pluginId: this.id
    }));
  }
}
