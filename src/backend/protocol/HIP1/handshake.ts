import z from "zod";

import type { Config } from "../../../types/hydrabase";
import type { Trace } from "../../../utils/trace";
import type { Account } from "../../Crypto/Account";

// @ts-expect-error: This is supported by bun
import VERSION from "../../../../VERSION" with { type: "text" };
import { Signature } from "../../Crypto/Signature";
import { upgradeHostname } from "../HIP4/upgrade";

export const IdentitySchema = z.object({
  address: z.string().regex(/^0x/iu, { message: "Address must start with 0x" }).transform(val => val as `0x${string}`),
  hostname: z.string().includes(':').transform(h => h as `${string}:${number}`),
  userAgent: z.string(),
  username: z.string()
}).strict()

export const AuthSchema = IdentitySchema.extend({
  signature: z.string()
}).strict()

export type Auth = z.infer<typeof AuthSchema>
export type Identity = z.infer<typeof IdentitySchema>

export const proveServer = (account: Account, node: Config['node'], trace: Trace): Auth => {
  trace.step(`[HIP1] Proving server`)
  return {
    address: account.address,
    hostname: `${node.hostname}:${node.port}`,
    signature: account.sign(`I am ${node.hostname}:${node.port}`, trace).toString(),
    userAgent: `Hydrabase/${VERSION}`,
    username: node.username
  }
}

export const verifyServer = (auth: Auth, hostname: string, trace: Trace): [number, string] | true => {
  if (auth.hostname !== hostname) return [500, `Expected ${hostname} but got ${auth.hostname}`]
  if (!Signature.fromString(auth.signature).verify(`I am ${hostname}`, auth.address, trace)) return [500, 'Server provided invalid signature']
  return true
}

export const proveClient = (account: Account, node: Config['node'], hostname: `${string}:${number}`, trace: Trace, x = false): Auth => {
  trace.step(`[HIP1] Proving client to ${hostname}`)
  const result = {
    address: account.address,
    hostname: `${node.hostname}:${node.port}`,
    signature: account.sign(`I am connecting to ${hostname}`, trace).toString(),
    userAgent: `Hydrabase/${VERSION}`,
    username: node.username
  } as const
  return x ? Object.fromEntries(Object.entries(result).map(entry => ([`x-${entry[0]}`, entry[1]]))) as Auth : result
}

export const verifyClient = async (node: Config['node'], hostname: string, auth: Auth | { apiKey: string }, apiKey: string | undefined, authenticateHostname: (hostname: `${string}:${number}`) => [number, string] | Promise<[number, string] | Identity>, trace: Trace): Promise<[number, string] | Identity> => {
  if ('apiKey' in auth) {
    trace.step(`[HIP1] Verifying API`)
    return auth.apiKey === apiKey ? { address: '0x0', hostname: 'API:4545', userAgent: `Hydrabase-API/${VERSION}`, username: `${node.username} (API)` } : [500, 'Invalid API Key']
  }
  trace.step(`[HIP1] Verifying client address ${auth.address}`)
  const signatureValid = Signature.fromString(auth.signature).verify(`I am connecting to ${node.hostname}:${node.port}`, auth.address, trace)
  trace.step(`[HIP1] Signature verify for ${auth.address}: message="I am connecting to ${node.hostname}:${node.port}" result=${signatureValid}`)
  if (!signatureValid) {
    const altHostname = `${node.ip}:${node.port}`
    if (altHostname === `${node.hostname}:${node.port}`) return [403, 'Failed to authenticate address']
    const altValid = Signature.fromString(auth.signature).verify(`I am connecting to ${altHostname}`, auth.address, trace)
    trace.step(`[HIP1] Alt signature verify for ${auth.address}: message="I am connecting to ${altHostname}" result=${altValid}`)
    if (altValid) trace.step(`[HIP1] Accepted signature against alternate hostname ${altHostname}`)
    else return [403, 'Failed to authenticate address']
  }
  trace.step(`[HIP1] Hostname check: peer claims ${auth.hostname}, connecting from ${hostname}`)
  const isHostnameValid = await upgradeHostname(hostname, auth, authenticateHostname, trace)
  if (Array.isArray(isHostnameValid)) return isHostnameValid
  return auth
}
