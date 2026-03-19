import type { Album, Artist, MetadataPlugin, Request, Response } from '../../types/hydrabase-schemas'
import type { Repositories } from '../db'
import type PeerManager from '../PeerManager'

import { warn } from '../../utils/log'
import { Trace } from '../../utils/trace'
import { SafeMetadataPlugin } from './SafeMetadataPlugin'

const computeConfidence = (artistConfidences: number[], peerConfidences: number[], k = 1.0): null | number => {
  if (peerConfidences.length === 0) return null

  let numerator = 0
  let denominator = k

  for (let i = 0; i < peerConfidences.length; i++) {
    const artistConfidence = artistConfidences[i] ?? 0
    numerator += artistConfidence * ((peerConfidences[i] ?? 0) - 0.5) * 2
    denominator += artistConfidence
  }

  return ((numerator / denominator) / 2) + 0.5
}

const matchId = (items: (Album | Artist)[], peers: PeerManager): undefined | { confidence: number; id: string } => {
  const votes = new Map<string, { itemConfidences: number[]; peerConfidences: number[], }>()
  for (const item of items) {
    const pastVotes = votes.get(item.id) ?? { itemConfidences: [], peerConfidences: [] }
    votes.set(item.id, {
      itemConfidences: [...pastVotes.itemConfidences, item.confidence],
      peerConfidences: [...pastVotes.peerConfidences, peers.getConfidence(item.address)]
    })
  }
// TODO: if over 50 peers, boot the 10% worst performing peers (use a bunch of variables to select; confidence scores, plugin variety, latency, etc)
  const confidences = new Map<string, number>()
  for (const entry of votes) {
    const [artistId, votes] = entry
    const confidence = computeConfidence(votes.itemConfidences, votes.peerConfidences)
    if (confidence !== null) confidences.set(artistId, confidence)
  }

  if (!confidences.size) return undefined
  const id = [...confidences.entries()].reduce((a, b) => !a || b[1] > a[1] ? b : a, [...confidences.entries()][0])
  return id ? { confidence: id[1], id: id[0] } : undefined
}

export default class MetadataManager {
  public readonly id = 'Hydrabase'
  public get installedPlugins(): SafeMetadataPlugin[] { return this.plugins }
  private readonly plugins: SafeMetadataPlugin[]

  constructor(plugins: MetadataPlugin[], private readonly db: Repositories, private readonly soulIdCutoff: number) {
    this.plugins = plugins.map(plugin => new SafeMetadataPlugin(plugin))
  }

  private static merge<T extends { address: `0x${string}`; soul_id: string, }>(primary: T[], secondary: T[]): T[] {
    const seen = new Set(primary.map(r => `${r.soul_id}:${r.address}`))
    return [...primary, ...secondary.filter(r => !seen.has(`${r.soul_id}:${r.address}`))]
  }

  async albumTracks(albumSoulId: string, peers: PeerManager): Promise<Response<'album.tracks'>> {
    const albums = this.db.album.lookupBySoulId(albumSoulId)
    const albumIds = new Map<string, string>()
    const pluginResults = await Promise.all(this.plugins.map(async p => {
      const pluginAlbums = albums.filter(({plugin_id}) => plugin_id === p.id)
      const {id} = pluginAlbums.find(({address}) => address === '0x0') ?? {}
      if (id) {
        albumIds.set(p.id, id)
        return (await p.albumTracks(id)).map(result => ({ ...result, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, this.soulIdCutoff))}` }))
      }

      const bestId = matchId(pluginAlbums, peers)
      if (bestId) {
        albumIds.set(p.id, bestId.id)
        return (await p.albumTracks(bestId.id)).map(result => ({ ...result, confidence: (result.confidence+bestId.confidence)/2, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, this.soulIdCutoff))}` }))
      }
      return []
    }))
    const results = pluginResults.flat().map(result => ({ ...result, address: '0x0' as const }))
    for (const result of results) {this.db.track.upsertFromPlugin(result)}
    const cached = this.db.track.lookupByArtistIds(albumIds)
    return MetadataManager.merge(results, cached)
  }

  async artistAlbums(artistSoulId: string, peers: PeerManager): Promise<Response<'artist.albums'>> {
    const artists = this.db.artist.lookupBySoulId(artistSoulId)
    const artistIds = new Map<string, string>()
    const pluginResults = (await Promise.all(this.plugins.map(async p => {
      const pluginArtists = artists.filter(({plugin_id}) => plugin_id === p.id)
      const { id } = pluginArtists.find(({address}) => address === '0x0') ?? {}
      if (id) {
        artistIds.set(p.id, id)
        return (await p.artistAlbums(id)).map(result => ({ ...result, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, this.soulIdCutoff))}` }))
      }

      const bestId = matchId(pluginArtists, peers)
      if (bestId) {
        artistIds.set(p.id, bestId.id)
        return (await p.artistAlbums(bestId.id)).map(result => ({ ...result, confidence: (result.confidence+bestId.confidence)/2, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, this.soulIdCutoff))}` }))
      }
      return []
    })))
    const results = pluginResults.flat().map(result => ({ ...result, address: '0x0' as const }))
    for (const result of results) {this.db.album.upsertFromPlugin(result)}
    const cached = this.db.album.lookupByArtistIds(artistIds)
    return MetadataManager.merge(results, cached)
  }

  async artistTracks(artistSoulId: string, peers: PeerManager): Promise<Response<'artist.tracks'>> {
    const artists = this.db.artist.lookupBySoulId(artistSoulId)
    const artistIds = new Map<string, string>()
    const pluginResults = (await Promise.all(this.plugins.map(async p => {
      const pluginArtists = artists.filter(({plugin_id}) => plugin_id === p.id)
      const { id } = pluginArtists.find(({address}) => address === '0x0') ?? {}
      if (id) {
        artistIds.set(p.id, id)
        return (await p.artistTracks(id)).map(result => ({ ...result, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, this.soulIdCutoff))}` }))
      }

      const bestId = matchId(pluginArtists, peers)
      if (bestId) {
        artistIds.set(p.id, bestId.id)
        return (await p.artistTracks(bestId.id)).map(result => ({ ...result, confidence: (result.confidence+bestId.confidence)/2, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, this.soulIdCutoff))}` }))
      }
      return []
    })))
    const results = pluginResults.flat().map(result => ({ ...result, address: '0x0' as const }))
    for (const result of results) {this.db.track.upsertFromPlugin(result)}
    const cached = this.db.track.lookupByArtistIds(artistIds)
    return MetadataManager.merge(results, cached)
  }

  public async handleRequest<T extends Request['type']>(request: Request & { type: T }, peers: PeerManager): Promise<Response<T>> {
    const trace = Trace.start(`[META] Searching for ${request.type}: ${request.query}`)
    const results: Response<T> = []
    if (request.type === 'tracks') results.push(...await this.searchTracks(request.query) as Response<T>)
    else if (request.type === 'artists') results.push(...await this.searchArtists(request.query) as Response<T>)
    else if (request.type === 'albums') results.push(...await this.searchAlbums(request.query) as Response<T>)
    else if (request.type === 'artist.albums') results.push(...await this.artistAlbums(request.query, peers) as Response<T>)
    else if (request.type === 'artist.tracks') results.push(...await this.artistTracks(request.query, peers) as Response<T>)
    else if (request.type === 'album.tracks') results.push(...await this.albumTracks(request.query, peers) as Response<T>)
    else warn('DEVWARN:', `[HIP2] Invalid request ${request.type}`)
    trace.step(`[META] Received ${results.length} results`)
    trace.success()
    return results
  }

  async searchAlbums(query: string): Promise<Response<'albums'>> {
    const [cached, ...pluginResults] = await Promise.all([
      this.db.album.searchByName(query),
      ...this.plugins.map(async p => (await p.searchAlbums(query)).map(result => ({ ...result, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, this.soulIdCutoff))}` })))
    ])
    const results = pluginResults.flat().map(result => ({ ...result, address: '0x0' as const }))
    for (const result of results) this.db.album.upsertFromPlugin(result)
    return MetadataManager.merge(results, cached)
  }

  async searchArtists(query: string): Promise<Response<'artists'>> {
    const [cached, ...pluginResults] = await Promise.all([
      this.db.artist.searchByName(query),
      ...this.plugins.map(async p => (await p.searchArtists(query)).map(result => ({ ...result, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, this.soulIdCutoff))}` })))
    ])
    const results = pluginResults.flat().map(result => ({ ...result, address: '0x0' as const }))
    for (const result of results) this.db.artist.upsertFromPlugin(result)
    return MetadataManager.merge(results, cached)
  }

  async searchTracks(query: string): Promise<Response<'tracks'>> {
    const [cached, ...pluginResults] = await Promise.all([
      this.db.track.searchByName(query),
      ...this.plugins.map(async p => (await p.searchTracks(query)).map(result => ({ ...result, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, this.soulIdCutoff))}` })))
    ])
    const results = pluginResults.flat().map(result => ({ ...result, address: '0x0' as const }))
    for (const result of results) this.db.track.upsertFromPlugin(result)
    return MetadataManager.merge(results, cached)
  }
}
