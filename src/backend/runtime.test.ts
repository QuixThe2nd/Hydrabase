import { describe, expect, it } from 'bun:test'

import { isDirectBunHostRun, isRunningInDockerEnvironment } from './runtime'

describe('isRunningInDockerEnvironment', () => {
  it('detects explicit docker env flag', () => {
    expect(isRunningInDockerEnvironment({ dockerContainer: 'true' })).toBeTrue()
  })

  it('detects container env flag', () => {
    expect(isRunningInDockerEnvironment({ container: 'docker' })).toBeTrue()
  })

  it('returns false for normal host env without docker flags', () => {
    expect(isRunningInDockerEnvironment({ container: 'podman', dockerContainer: 'false' })).toBeFalse()
  })
})

describe('isDirectBunHostRun', () => {
  it('returns false when docker is detected', () => {
    expect(isDirectBunHostRun({ dockerContainer: 'true' })).toBeFalse()
  })
})