import z from 'zod';

export const SearchResultSchema = z.object({
  artistName: z.string(),
  trackName: z.string(),
  artworkUrl: z.url(),
  genre: z.string()
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export interface MetadataPlugin {
  id: string
  search: (query: string) => Promise<SearchResult[]>
}

export default class MetadataManager {
  constructor(private readonly plugins: MetadataPlugin[]) {}

  async search(query: string): Promise<{ [pluginId: string]: SearchResult[] }> {
    const results: { [pluginId: string]: SearchResult[] } = {};
    for (const plugin of this.plugins) results[plugin.id] = await plugin.search(query);
    return results;
  }
}

/*
TODO: Database
store songs in db, source: itunes/musicbrainz/spotify, song id, song name, etc
create table that matches songs across sources
*/
