import type { AuthenticatedPeerRepository } from '../db/repositories/AuthenticatedPeerRepository'
import type { Identity } from '../protocol/HIP1_Identity'

let repo: AuthenticatedPeerRepository | undefined

interface AuthenticatedPeersStore {
  clear(): void
  delete(hostname: `${string}:${number}`): void
  get(hostname: `${string}:${number}`): Identity | undefined
  init(nextRepo: AuthenticatedPeerRepository): void
  set(hostname: `${string}:${number}`, identity: Identity): AuthenticatedPeersStore
  values(): Identity[]
}

export const authenticatedPeers: AuthenticatedPeersStore = {
  clear(): void { repo?.clear() },
  delete(hostname: `${string}:${number}`): void { repo?.delete(hostname) },
  get(hostname: `${string}:${number}`): Identity | undefined { return repo?.get(hostname) },
  init(nextRepo: AuthenticatedPeerRepository): void { repo = nextRepo },
  set(hostname: `${string}:${number}`, identity: Identity): AuthenticatedPeersStore {
    repo?.set(hostname, identity)
    return authenticatedPeers
  },
  values(): Identity[] { return repo?.values() ?? [] },
}