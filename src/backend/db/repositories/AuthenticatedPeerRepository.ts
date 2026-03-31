import { eq } from 'drizzle-orm'

import type { DB } from '..'
import type { Identity } from '../../protocol/HIP1_Identity'

import { authenticatedPeer } from '../schema'

export class AuthenticatedPeerRepository {
  constructor(private readonly db: DB) {}

  clear(): void {
    this.db.delete(authenticatedPeer).run()
  }

  delete(hostname: `${string}:${number}`): boolean {
    const before = this.db.select().from(authenticatedPeer).where(eq(authenticatedPeer.hostname, hostname)).get()
    this.db.delete(authenticatedPeer).where(eq(authenticatedPeer.hostname, hostname)).run()
    return before !== undefined
  }

  get(hostname: `${string}:${number}`): Identity | undefined {
    const row = this.db.select().from(authenticatedPeer).where(eq(authenticatedPeer.hostname, hostname)).get()
    if (!row) return undefined
    return {
      address: row.address as `0x${string}`,
      ...(row.bio ? { bio: row.bio } : {}),
      hostname: row.hostname as `${string}:${number}`,
      userAgent: row.userAgent,
      username: row.username,
    }
  }

  getAll(): Map<`${string}:${number}`, Identity> {
    const rows = this.db.select().from(authenticatedPeer).all()
    const map = new Map<`${string}:${number}`, Identity>()
    for (const row of rows) {
      map.set(row.hostname as `${string}:${number}`, {
        address: row.address as `0x${string}`,
        ...(row.bio ? { bio: row.bio } : {}),
        hostname: row.hostname as `${string}:${number}`,
        userAgent: row.userAgent,
        username: row.username,
      })
    }
    return map
  }

  has(hostname: `${string}:${number}`): boolean {
    return this.db.select().from(authenticatedPeer).where(eq(authenticatedPeer.hostname, hostname)).get() !== undefined
  }

  set(hostname: `${string}:${number}`, identity: Identity): void {
    this.db.insert(authenticatedPeer).values({
      address: identity.address,
      bio: identity.bio ?? null,
      hostname,
      userAgent: identity.userAgent,
      username: identity.username,
    }).onConflictDoUpdate({
      set: {
        address: identity.address,
        bio: identity.bio ?? null,
        userAgent: identity.userAgent,
        username: identity.username,
      },
      target: authenticatedPeer.hostname,
    }).run()
  }

  values(): Identity[] {
    const rows = this.db.select().from(authenticatedPeer).all()
    return rows.map(row => ({
      address: row.address as `0x${string}`,
      ...(row.bio ? { bio: row.bio } : {}),
      hostname: row.hostname as `${string}:${number}`,
      userAgent: row.userAgent,
      username: row.username,
    }))
  }
}
