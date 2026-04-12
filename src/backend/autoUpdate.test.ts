import { describe, expect, it } from 'bun:test'

import { classifyGitSyncState, DEFAULT_AUTO_UPDATE_INTERVAL_MS, parseAutoUpdateIntervalMs, resolveAutoUpdateEnabled } from './autoUpdate'

describe('classifyGitSyncState', () => {
  it('classifies matching heads as up to date', () => {
    expect(classifyGitSyncState('abc', 'abc', 'abc')).toBe('up-to-date')
  })

  it('classifies local branch behind upstream', () => {
    expect(classifyGitSyncState('base', 'remote', 'base')).toBe('behind')
  })

  it('classifies local branch ahead of upstream', () => {
    expect(classifyGitSyncState('local', 'base', 'base')).toBe('ahead')
  })

  it('classifies unrelated heads as diverged', () => {
    expect(classifyGitSyncState('local', 'remote', 'base')).toBe('diverged')
  })
})

describe('parseAutoUpdateIntervalMs', () => {
  it('uses the default interval when env is unset', () => {
    expect(parseAutoUpdateIntervalMs(undefined)).toBe(DEFAULT_AUTO_UPDATE_INTERVAL_MS)
  })

  it('accepts zero for startup-only update checks', () => {
    expect(parseAutoUpdateIntervalMs('0')).toBe(0)
  })

  it('falls back to the default interval for invalid values', () => {
    expect(parseAutoUpdateIntervalMs('abc')).toBe(DEFAULT_AUTO_UPDATE_INTERVAL_MS)
  })
})

describe('resolveAutoUpdateEnabled', () => {
  it('defaults to enabled outside Docker', () => {
    expect(resolveAutoUpdateEnabled(undefined, false)).toBeTrue()
  })

  it('defaults to disabled inside Docker', () => {
    expect(resolveAutoUpdateEnabled(undefined, true)).toBeFalse()
  })

  it('allows explicit opt in inside Docker', () => {
    expect(resolveAutoUpdateEnabled('true', true)).toBeTrue()
  })

  it('allows explicit opt out outside Docker', () => {
    expect(resolveAutoUpdateEnabled('false', false)).toBeFalse()
  })
})