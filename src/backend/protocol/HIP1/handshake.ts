import z from "zod";

import type { Account } from "../../Crypto/Account";

import { debug, warn } from "../../../utils/log";
import { CONFIG } from "../../config";
import { Signature } from "../../Crypto/Signature";
import { VERSION } from "../../networking/ws/server";
import { authenticateServer } from "../../Peers";

export const IdentitySchema = z.object({
  address: z.string().regex(/^0x/iu, { message: "Address must start with 0x" }).transform(val => val as `0x${string}`),
  hostname: z.string().includes(':').transform(h => h as `${string}:${number}`),
  userAgent: z.string(),
  username: z.string()
})

export const AuthSchema = IdentitySchema.extend({
  signature: z.string()
})

export type Auth = z.infer<typeof AuthSchema>
export type Identity = z.infer<typeof IdentitySchema>

export const proveServer = (account: Account, selfHostname: `${string}:${number}`): Auth => {
  debug(`[HIP3] Proving server`)
  return {
    address: account.address,
    hostname: selfHostname,
    signature: account.sign(`I am ${selfHostname}`).toString(),
    userAgent: `Hydrabase/${VERSION}`,
    username: CONFIG.username
  }
}

export const verifyServer = (auth: Auth, hostname: string): [number, string] | true => {
  if (auth.hostname !== hostname) return [500, `Expected ${hostname} but got ${auth.hostname}`]
  if (!Signature.fromString(auth.signature).verify(`I am ${hostname}`, auth.address)) return [500, 'Server provided invalid signature']
  return true
}

export const proveClient = (account: Account, hostname: `${string}:${number}`, selfHostname: `${string}:${number}`, x = false): Auth => {
  debug(`[HIP3] Proving client to ${hostname}`)
  const result = {
    address: account.address,
    hostname: selfHostname,
    signature: account.sign(`I am connecting to ${hostname}`).toString(),
    userAgent: `Hydrabase/${VERSION}`,
    username: CONFIG.username
  } as const
  return x ? Object.fromEntries(Object.entries(result).map(entry => ([`x-${entry[0]}`, entry[1]]))) as Auth : result
}

export const verifyClient = async (auth: Auth | { apiKey: string }, selfHostname: `${string}:${number}`): Promise<[number, string] | Identity> => {
  if ('apiKey' in auth) {
    debug(`[HIP3] Verifying API`)
    if (auth.apiKey !== CONFIG.apiKey) return [500, 'Invalid API Key']
    return { address: '0x0', hostname: 'API:4545', userAgent: `Hydrabase-API/${VERSION}`, username: CONFIG.username }
  }
  debug(`[HIP3] Verifying client ${auth.username} ${auth.address} ${auth.hostname}`)

  debug(`[HIP3] Verifying client address ${auth.address}`)
  if (!Signature.fromString(auth.signature).verify(`I am connecting to ${selfHostname}`, auth.address)) return [403, 'Failed to authenticate address']

  const isHostnameValid = await new Promise<[number, string] | true>(resolve => {
    debug(`[HIP3] Verifying client hostname ${auth.address} ${auth.hostname}`)
    authenticateServer(auth.hostname).then(identity => { // TODO: udp mode
      if (Array.isArray(identity)) return resolve(identity)
      if (identity.address !== auth.address) {
        warn('DEVWARN:', "[HIP3] Invalid Address", {expected:auth.address,got:identity.address})
        return resolve([500, `Invalid address`])
      }
      return resolve(true)
    })
  })
  if (Array.isArray(isHostnameValid)) return isHostnameValid
  return auth
}
