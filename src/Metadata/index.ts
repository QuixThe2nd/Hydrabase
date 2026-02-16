import z from 'zod';
import type { Request } from '../Messages'

export const SearchResultSchema = z.object({
  name: z.string(),
  artists: z.array(z.string()),
  album: z.string(),
  duration_ms: z.number(),
  popularity: z.number(),
  preview_url: z.url(),
  external_urls: z.array(z.url()),
  image_url: z.url(),
  plugin_id: z.string()
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export interface MetadataPlugin {
  id: string
  search: (query: string) => Promise<SearchResult[]>
}

export default class MetadataManager {
  constructor(private readonly plugins: MetadataPlugin[]) {}

  async search(query: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    for (const plugin of this.plugins) results.push(...await plugin.search(query))
    return results;
  }

  public async handleRequest(request: Request) {
    if (request.type === 'search') return await this.search(request.trackName);
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
