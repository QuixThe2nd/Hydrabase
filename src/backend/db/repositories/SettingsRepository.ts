import { eq } from 'drizzle-orm'

import type { DB } from '..'

import { setting } from '../schema'

interface SettingRecord {
  key: string
  updatedAt: number
  updatedBy: string
  value: string
}

export class SettingsRepository {
  constructor(private readonly db: DB) {}

  getAll(): SettingRecord[] {
    return this.db.select().from(setting).all().map((row) => ({
      key: row.key,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
      value: row.value,
    }))
  }

  getByKeys(keys: string[]): SettingRecord[] {
    return keys
      .map((key) => {
        const row = this.db.select().from(setting).where(eq(setting.key, key)).get()
        if (!row) return null
        return {
          key: row.key,
          updatedAt: row.updated_at,
          updatedBy: row.updated_by,
          value: row.value,
        }
      })
      .filter((row): row is SettingRecord => row !== null)
  }

  upsertMany(records: SettingRecord[]): void {
    for (const record of records) {
      this.db.insert(setting).values({
        key: record.key,
        updated_at: record.updatedAt,
        updated_by: record.updatedBy,
        value: record.value,
      }).onConflictDoUpdate({
        set: {
          updated_at: record.updatedAt,
          updated_by: record.updatedBy,
          value: record.value,
        },
        target: setting.key,
      }).run()
    }
  }
}
