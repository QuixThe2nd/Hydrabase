import { ENV_CONFIG_PATHS } from '../src/backend/config'

const args = new Set(Bun.argv.slice(2))
const envVars = ENV_CONFIG_PATHS.map(({ env }) => env).sort((a, b) => a.localeCompare(b))
const output = args.has('--json') ? JSON.stringify(envVars, null, 2) : envVars.join('\n')

await Bun.write(Bun.stdout, `${output}\n`)
