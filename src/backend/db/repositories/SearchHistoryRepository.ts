import { and, desc, eq, type InferSelectModel } from 'drizzle-orm'

import type { DB } from '..'
import type { SearchHistoryEntry } from '../../../types/hydrabase-schemas'

import { schema } from '../schema'

type SearchHistoryRow = InferSelectModel<typeof schema.searchHistory>

const map = (row: SearchHistoryRow): SearchHistoryEntry => ({
  id: row.id,
  query: row.query,
  resultCount: row.result_count,
  timestamp: row.timestamp,
  type: row.type as SearchHistoryEntry['type'],
})

export class SearchHistoryRepository {
  constructor(private readonly db: DB) {}

  add(query: string, type: string, resultCount: number): void {
    const timestamp = Date.now()
    
    const existing = this.db.select().from(schema.searchHistory)
      .where(and(eq(schema.searchHistory.query, query), eq(schema.searchHistory.type, type)))
      .get()

    if (existing) {
      this.db.update(schema.searchHistory)
        .set({ result_count: resultCount, timestamp })
        .where(eq(schema.searchHistory.id, existing.id))
        .run()
    } else {
      this.db.insert(schema.searchHistory)
        .values({ query, result_count: resultCount, timestamp, type })
        .run()

      const total = this.db.select().from(schema.searchHistory).all().length
      if (total > 50) {
        const oldest = this.db.select().from(schema.searchHistory)
          .orderBy(schema.searchHistory.timestamp)
          .limit(total - 50)
          .all()
        
        for (const row of oldest) {
          this.db.delete(schema.searchHistory)
            .where(eq(schema.searchHistory.id, row.id))
            .run()
        }
      }
    }
  }

  getAll(): SearchHistoryEntry[] {
    return this.db.select().from(schema.searchHistory)
      .orderBy(desc(schema.searchHistory.timestamp))
      .all()
      .map(map)
  }

  remove(id: number): void {
    this.db.delete(schema.searchHistory)
      .where(eq(schema.searchHistory.id, id))
      .run()
  }

  clear(): void {
    this.db.delete(schema.searchHistory).run()
  }
}
