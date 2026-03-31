import type { DB } from '..'

import { dhtNode } from '../schema'

export interface DHTNodeEntry {
  host: string
  port: number
}

export class DhtNodeRepository {
  constructor(private readonly db: DB) {}

  getAll(): DHTNodeEntry[] {
    return this.db.select({ host: dhtNode.host, port: dhtNode.port }).from(dhtNode).all()
  }

  replaceAll(nodes: DHTNodeEntry[]): void {
    this.db.transaction(tx => {
      tx.delete(dhtNode).run()
      for (const node of nodes) {
        tx.insert(dhtNode).values({ host: node.host, port: node.port }).onConflictDoNothing().run()
      }
    })
  }
}
