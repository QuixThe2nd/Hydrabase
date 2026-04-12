import z from 'zod'

import type { Config } from '../../../types/hydrabase'
import type { Trace } from '../../../utils/trace'
import type { Account } from '../../crypto/Account'

// @ts-expect-error: This is supported by bun
import VERSION from '../../../../VERSION' with { type: 'text' }
import { BRANCH, GIT_HASH } from '../../branch'
import { Signature } from '../../crypto/Signature'
import { getIp, isPeerLocalHostname } from '../../networking/utils'
import { upgradeHostname } from '../HIP4_HostnameUpgrades'

const VERSION_WITH_HASH = `${VERSION.trim()}+${GIT_HASH}`

export const IdentitySchema = z.object({
  address: z.string().regex(/^0x/iu, { message: 'Address must start with 0x' }).transform(val => val as `0x${string}`),
  bio: z.string().max(140, { message: 'Bio must be 140 characters or less' }).optional(),
  hostname: z.string().includes(':').transform(h => h as `${string}:${number}`),
  plugins: z.array(z.string().min(1).max(64)).max(64).default([]),
  userAgent: z.string(),
  username: z.string().regex(/^[a-zA-Z0-9]{3,20}$/u, { message: 'Username must be 3-20 alphanumeric characters, no spaces' })
}).strict()

export const AuthSchema = IdentitySchema.extend({
  signature: z.string()
}).strict()

export type Auth = z.infer<typeof AuthSchema>
export type Identity = z.infer<typeof IdentitySchema>

export const proveServer = async (account: Account, node: Config['node'], trace: Trace, plugins: string[] = []): Promise<Auth> => {
  trace.step('[HIP1] Proving server')
  let {hostname} = node
  if (node.hostname === node.ip && !isPeerLocalHostname(node.hostname)) {
    trace.step('[HIP1] Resolving external IP for server proof')
    try {
      hostname = await getIp()
      trace.step(`[HIP1] External IP resolved to ${hostname}`)
    } catch (e) {
      trace.step(`[HIP1] External IP lookup failed, using configured hostname ${node.hostname}`)
      trace.step(`[HIP1] External IP lookup error: ${String(e)}`)
    }
  }
  const bio = node.bio?.slice(0, 140)
  return {
    address: account.address,
    ...(bio ? { bio } : {}),
    hostname: `${hostname}:${node.port}`,
    plugins,
    signature: account.sign(`I am ${hostname}:${node.port}`, trace).toString(),
    userAgent: `Hydrabase/${BRANCH}-${VERSION_WITH_HASH}`,
    username: node.username
  }
}

export const verifyServer = (auth: Auth, hostname: string, trace: Trace): [number, string] | true => {
  if (auth.hostname !== hostname) return [500, `Expected ${hostname} but got ${auth.hostname}`]
  if (!Signature.fromString(auth.signature).verify(`I am ${hostname}`, auth.address, trace)) return [500, 'Server provided invalid signature']
  return true
}

export function proveClient(account: Account, node: Config['node'], hostname: `${string}:${number}`, trace: Trace, plugins?: string[], x?: false): Auth
export function proveClient(account: Account, node: Config['node'], hostname: `${string}:${number}`, trace: Trace, plugins: string[] | undefined, x: true): Record<string, string>
export function proveClient(account: Account, node: Config['node'], hostname: `${string}:${number}`, trace: Trace, plugins: string[] = [], x = false): Auth | Record<string, string> {
  trace.step(`[HIP1] Proving client to ${hostname}`)
  const bio = node.bio?.slice(0, 140)
  const result: Auth = {
    address: account.address,
    ...(bio ? { bio } : {}),
    hostname: `${node.hostname}:${node.port}` as `${string}:${number}`,
    plugins,
    signature: account.sign(`I am connecting to ${hostname}`, trace).toString(),
    userAgent: `Hydrabase/${BRANCH}-${VERSION_WITH_HASH}`,
    username: node.username
  }
  if (!x) return result
  return Object.fromEntries(
    Object.entries(result).flatMap(([key, value]) => value === undefined ? [] : [[`x-${key}`, Array.isArray(value) ? value.join(',') : value]])
  ) as Record<string, string>
}

export const verifyClient = async (
  node: Config['node'],
  hostname: string,
  auth: Auth | { apiKey: string },
  apiKey: string | undefined,
  trace: Trace,
  preferTransport: 'TCP' | 'UTP' = node.preferTransport,
  account?: Account,
  identity?: Identity,
  ip?: { address: string },
  requestedHostname?: `${string}:${number}`
): Promise<[number, string] | Identity> => {
  if ('apiKey' in auth) {
    trace.step('[HIP1] Verifying API')
    return auth.apiKey === apiKey
      ? { address: '0x0', ...(node.bio ? { bio: node.bio.slice(0, 140) } : {}), hostname: 'API:0', plugins: [], userAgent: `Hydrabase-API/${VERSION_WITH_HASH}`, username: `${node.username} (API)` }
      : [500, 'Invalid API Key']
  }
  trace.step(`[HIP1] Verifying client ${auth.username} running ${auth.userAgent}`)
  trace.step(`[HIP1] Verifying client address ${auth.address}`)
  const candidates = new Set<`${string}:${number}`>()
  if (requestedHostname) candidates.add(requestedHostname)
  candidates.add(`${node.hostname}:${node.port}`)
  candidates.add(`${node.ip}:${node.port}`)

  let signatureValid = false
  for (const candidate of candidates) {
    const valid = Signature.fromString(auth.signature).verify(`I am connecting to ${candidate}`, auth.address, trace)
    trace.step(`[HIP1] Signature verify for ${auth.address}: message="I am connecting to ${candidate}" result=${valid}`)
    if (!valid) continue
    if (candidate !== `${node.hostname}:${node.port}`) trace.step(`[HIP1] Accepted signature against alternate hostname ${candidate}`)
    signatureValid = true
    break
  }
  if (!signatureValid) return [403, 'Failed to authenticate address']
  if (account && identity && ip) {
    const isHostnameValid = await upgradeHostname(hostname, auth, trace, preferTransport, identity, ip)
    if (Array.isArray(isHostnameValid)) return isHostnameValid
  }
  return auth
}
