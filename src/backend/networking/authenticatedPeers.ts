import type { AuthenticatedPeerRepository } from '../db/repositories/AuthenticatedPeerRepository'
import type { Identity } from '../protocol/HIP1_Identity'

let repo: AuthenticatedPeerRepository | undefined
const cachedAt = new Map<`${string}:${number}`, number>()

interface AuthenticatedPeersStore {
  clear(): void
  delete(hostname: `${string}:${number}`): void
  get(hostname: `${string}:${number}`): Identity | undefined
  getCachedAt(hostname: `${string}:${number}`): number | undefined
  init(nextRepo: AuthenticatedPeerRepository): void
  set(hostname: `${string}:${number}`, identity: Identity): AuthenticatedPeersStore
  values(): Identity[]
}

export const authenticatedPeers: AuthenticatedPeersStore = {
  clear(): void { repo?.clear(); cachedAt.clear() },
  delete(hostname: `${string}:${number}`): void { repo?.delete(hostname); cachedAt.delete(hostname) },
  get(hostname: `${string}:${number}`): Identity | undefined { return repo?.get(hostname) },
  getCachedAt(hostname: `${string}:${number}`): number | undefined { return cachedAt.get(hostname) },
  init(nextRepo: AuthenticatedPeerRepository): void { repo = nextRepo },
  set(hostname: `${string}:${number}`, identity: Identity): AuthenticatedPeersStore {
    repo?.set(hostname, identity)
    cachedAt.set(hostname, Date.now())
    return authenticatedPeers
  },
  values(): Identity[] { return repo?.values() ?? [] },
}