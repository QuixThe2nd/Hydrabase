import type { MetadataPlugin } from '../../types/hydrabase-schemas'

import { error } from '../../utils/log'

export class SafeMetadataPlugin implements MetadataPlugin {
  get id() {
    return this.plugin.id
  }
  
  constructor(private readonly plugin: MetadataPlugin) {}

  public readonly albumTracks = async (id: string) => {
    try {
      return await this.plugin.albumTracks(id)
    } catch (e) {
      error('ERROR:', `[${this.id}] albumTracks() failed`, {e})
      return []
    }
  }
  public readonly artistAlbums = async (id: string) => {
    try {
      return await this.plugin.artistAlbums(id)
    } catch (e) {
      error('ERROR:', `[${this.id}] artistAlbums() failed`, {e})
      return []
    }
  }
  public readonly artistTracks = async (id: string) => {
    try {
      return await this.plugin.artistTracks(id)
    } catch (e) {
      error('ERROR:', `[${this.id}] artistTracks() failed`, {e})
      return []
    }
  }
  public readonly searchAlbums = async (query: string) => {
    try {
      return await this.plugin.searchAlbums(query)
    } catch (e) {
      error('ERROR:', `[${this.id}] searchAlbums() failed`, {e})
      return []
    }
  }
  public readonly searchArtists = async (query: string) => {
    try {
      return await this.plugin.searchArtists(query)
    } catch (e) {
      error('ERROR:', `[${this.id}] searchArtists() failed`, {e})
      return []
    }
  }
  public readonly searchTracks = async (query: string) => {
    try {
      return await this.plugin.searchTracks(query)
    } catch (e) {
      error('ERROR:', `[${this.id}] searchTracks() failed`, {e})
      return []
    }
  }
}