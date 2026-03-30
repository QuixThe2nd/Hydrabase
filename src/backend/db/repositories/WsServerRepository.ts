import type { DB } from '..'

import { wsServer } from '../schema'

export class WsServerRepository {
  constructor(private readonly db: DB) {}

  getAll(): `${string}:${number}`[] {
    return this.db.select({ hostname: wsServer.hostname }).from(wsServer).all().map(r => r.hostname as `${string}:${number}`)
  }

  replaceAll(hostnames: `${string}:${number}`[]): void {
    this.db.transaction(tx => {
      tx.delete(wsServer).run()
      for (const hostname of hostnames) {
        tx.insert(wsServer).values({ hostname }).onConflictDoNothing().run()
      }
    })
  }
}
