import { existsSync } from 'node:fs'

export interface RuntimeEnvironment {
  container?: string
  dockerContainer?: string
}

type RuntimeEnvironmentInput = NodeJS.ProcessEnv | RuntimeEnvironment

export const isRunningInDockerEnvironment = (env: RuntimeEnvironmentInput = process.env): boolean => {
  if (env.dockerContainer === 'true') return true
  if (env.container === 'docker') return true

  return existsSync('/.dockerenv')
}

export const isDirectBunHostRun = (env: RuntimeEnvironmentInput = process.env): boolean => typeof Bun !== 'undefined' && !isRunningInDockerEnvironment(env)