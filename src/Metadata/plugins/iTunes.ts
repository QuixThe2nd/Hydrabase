import { z } from "zod";
import type { MetadataPlugin, SearchResult } from "..";

const iTunesTrackSchema = z.object({
  artistName: z.string(),
  trackName: z.string(),
  artworkUrl100: z.url(),
  trackId: z.number(),
  collectionName: z.string().optional(),
  trackViewUrl: z.url(),
  previewUrl: z.url().optional(),
  trackTimeMillis: z.number().optional()
});

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
      id: String(result.trackId),
      name: result.trackName,
      artists: [result.artistName],
      album: result.collectionName ?? '',
      duration_ms: result.trackTimeMillis ?? 0,
      popularity: 0,
      preview_url: result.previewUrl ?? '',
      external_urls: [result.trackViewUrl],
      image_url: result.artworkUrl100,
      plugin_id: this.id
    }));
  }
}
