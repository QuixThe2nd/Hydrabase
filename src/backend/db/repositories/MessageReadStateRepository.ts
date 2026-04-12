import { and, eq } from 'drizzle-orm'

import type { DB } from '..'

import { messageReadState } from '../schema'

export class MessageReadStateRepository {
  constructor(private readonly db: DB) {}

  getByReader(readerAddress: `0x${string}`): Record<string, number> {
    const rows = this.db.select().from(messageReadState)
      .where(eq(messageReadState.reader_address, readerAddress))
      .all()

    return rows.reduce<Record<string, number>>((state, row) => {
      state[row.conversation_address] = row.last_read_timestamp
      return state
    }, {})
  }

  markRead(readerAddress: `0x${string}`, conversationAddress: `0x${string}`, timestamp: number): void {
    const existing = this.db.select().from(messageReadState)
      .where(and(
        eq(messageReadState.reader_address, readerAddress),
        eq(messageReadState.conversation_address, conversationAddress),
      ))
      .get()

    const nextTimestamp = Math.max(timestamp, existing?.last_read_timestamp ?? 0)
    const updatedAt = Date.now()

    if (!existing) {
      this.db.insert(messageReadState).values({
        conversation_address: conversationAddress,
        last_read_timestamp: nextTimestamp,
        reader_address: readerAddress,
        updated_at: updatedAt,
      }).run()
      return
    }

    if (nextTimestamp === existing.last_read_timestamp) return

    this.db.update(messageReadState)
      .set({
        last_read_timestamp: nextTimestamp,
        updated_at: updatedAt,
      })
      .where(and(
        eq(messageReadState.reader_address, readerAddress),
        eq(messageReadState.conversation_address, conversationAddress),
      ))
      .run()
  }
}
