import type { Config, RuntimeConfigSnapshot, RuntimeConfigUpdate, RuntimeNodeProfileConfig } from '../types/hydrabase'
import type { Repositories } from './db'

import { warn } from '../utils/log'

const KEY_BIO = 'node.bio'
const KEY_CONNECT_MESSAGE = 'node.connectMessage'
const KEY_USERNAME = 'node.username'

const USERNAME_REGEX = /^[a-zA-Z0-9]{3,20}$/u

const toSettingValue = (value: string): string => JSON.stringify(value)

const fromSettingValue = (value: string): null | string => {
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export class RuntimeSettingsManager {
  constructor(
    private readonly nodeConfig: Config['node'],
    private readonly repos: Repositories,
    private readonly apiKeyConfigured: boolean,
  ) {}

  getSnapshot(): RuntimeConfigSnapshot {
    return {
      editable: {
        nodeProfile: {
          bio: this.nodeConfig.bio ?? '',
          connectMessage: this.nodeConfig.connectMessage,
          username: this.nodeConfig.username,
        },
      },
      readonly: {
        apiKeyConfigured: this.apiKeyConfigured,
        node: {
          hostname: this.nodeConfig.hostname,
          ip: this.nodeConfig.ip,
          listenAddress: this.nodeConfig.listenAddress,
          port: this.nodeConfig.port,
        },
      },
    }
  }

  loadFromStorage(): void {
    const stored = this.repos.settings.getByKeys([KEY_USERNAME, KEY_BIO, KEY_CONNECT_MESSAGE])
    const updates: Partial<RuntimeNodeProfileConfig> = {}

    for (const item of stored) {
      const value = fromSettingValue(item.value)
      if (value === null) continue
      if (item.key === KEY_USERNAME) updates.username = value
      if (item.key === KEY_BIO) updates.bio = value
      if (item.key === KEY_CONNECT_MESSAGE) updates.connectMessage = value
    }

    if (Object.keys(updates).length === 0) return

    try {
      this.applyNodeProfileUpdate(updates)
    } catch (err) {
      warn('WARN:', `[SETTINGS] Failed to load runtime settings from storage: ${String(err)}`)
    }
  }

  update(update: RuntimeConfigUpdate, updatedBy: string): RuntimeConfigSnapshot {
    const profileUpdate = update.nodeProfile ?? {}
    this.applyNodeProfileUpdate(profileUpdate)

    const now = Date.now()
    const records: { key: string; updatedAt: number; updatedBy: string; value: string }[] = []
    if (profileUpdate.username !== undefined) {
      records.push({ key: KEY_USERNAME, updatedAt: now, updatedBy, value: toSettingValue(this.nodeConfig.username) })
    }
    if (profileUpdate.bio !== undefined) {
      records.push({ key: KEY_BIO, updatedAt: now, updatedBy, value: toSettingValue(this.nodeConfig.bio ?? '') })
    }
    if (profileUpdate.connectMessage !== undefined) {
      records.push({ key: KEY_CONNECT_MESSAGE, updatedAt: now, updatedBy, value: toSettingValue(this.nodeConfig.connectMessage) })
    }
    if (records.length > 0) this.repos.settings.upsertMany(records)

    return this.getSnapshot()
  }

  private applyNodeProfileUpdate(update: Partial<RuntimeNodeProfileConfig>): void {
    if (update.username !== undefined) {
      const username = update.username.trim()
      if (!USERNAME_REGEX.test(username)) {
        throw new Error('Username must be 3-20 alphanumeric characters with no spaces')
      }
      this.nodeConfig.username = username
    }

    if (update.bio !== undefined) {
      const bio = update.bio.trim()
      if (bio.length > 140) throw new Error('Bio must be 140 characters or less')
      this.nodeConfig.bio = bio
    }

    if (update.connectMessage !== undefined) {
      const connectMessage = update.connectMessage.trim()
      if (connectMessage.length === 0) throw new Error('Connect message cannot be empty')
      if (connectMessage.length > 280) throw new Error('Connect message must be 280 characters or less')
      this.nodeConfig.connectMessage = connectMessage
    }
  }
}
