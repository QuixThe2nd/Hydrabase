import z from "zod";

import type { Account } from "../../Crypto/Account";

import { CONFIG } from "../../config";
import { Signature } from "../../Crypto/Signature";
import { log, warn } from "../../log";
import { version } from "../../networking/ws/server";

const AuthSchema = z.object({
  address: z.string().regex(/^0x/iu, { message: "Address must start with 0x" }).transform(val => val as `0x${string}`),
  signature: z.string(),
  userAgent: z.string(),
  username: z.string()
})

type Auth =
  | { apiKey: string; signature: Signature }
  | { apiKey: string; signature?: undefined }
  | { apiKey?: undefined; signature: Signature }

const verifyAddress = async (_unverifiedSignature: string | undefined, _unverifiedApiKey: string | undefined, protocol: string | undefined, unverifiedAddress: string | undefined): [number, string] | { address: `0x${string}`; hostname: `${string}:${number}`; userAgent: string; username: string } | { address: `0x${string}` } => {
  const unverifiedSignature = _unverifiedSignature ? Signature.fromString(_unverifiedSignature) : undefined
  const unverifiedApiKey = _unverifiedApiKey ?? protocol?.split(',').map(s => s.trim()).find(s => s.startsWith('x-api-key-'))?.replace('x-api-key-', '')
  const unverifiedAuth = unverifiedApiKey !== undefined || unverifiedSignature !== undefined ? { apiKey: unverifiedApiKey, signature: unverifiedSignature } as Auth : undefined

  if (!unverifiedAuth) return [400, 'Missing authentication']
  if (unverifiedAuth.apiKey && unverifiedAuth.apiKey !== CONFIG.apiKey) return [401, 'Invalid API key']
  else if (unverifiedAuth.signature) {
    if (!unverifiedAddress) return [400, 'Missing address header']
    if (!unverifiedAuth.signature.verify(`I am connecting to ${CONFIG.domainName ?? CONFIG.externalIp}`, unverifiedAddress)) return [403, 'Authentication failed']
    return { address: unverifiedAddress as `0x${string}` }
  }
  return { address: '0x0', hostname: '0.0.0.0:0', userAgent: `Hydrabase-API/${version}`, username: 'API' }
}

const prove = {
  client: (account: Account, hostname: string) => ({
    'x-address': account.address,
    'x-hostname': CONFIG.domainName ?? CONFIG.externalIp,
    'x-signature': account.sign(`I am connecting to ${hostname})`).toString()
  }),
  server: (account: Account) => new Response(JSON.stringify({
    address: account.address,
    signature: account.sign(`I am ${CONFIG.domainName ?? CONFIG.externalIp}:${CONFIG.port}`).toString(),
    userAgent: `Hydrabase/${version}`,
    username: CONFIG.username
  } satisfies z.infer<typeof AuthSchema>))
}

const verify = {
  clientFromServer: async (headers: Record<string, string>): Promise<[number, string] | { address: `0x${string}`, hostname: `${string}:${number}`, userAgent: string; username: string, }> => {
    const { 'sec-websocket-protocol': protocol, 'x-address': unverifiedAddress, 'x-api-key': _unverifiedApiKey, 'x-hostname': unverifiedHostname, 'x-signature': _unverifiedSignature } = headers

    log(`[HIP3] Verifying client address ${unverifiedAddress ?? '0x0'}`)
    const res = verifyAddress(_unverifiedSignature, _unverifiedApiKey, protocol, unverifiedAddress)
    if (Array.isArray(res)) return res
    if ('hostname' in res) return res

    log(`[HIP3] Verifying client hostname ${res.address}`)
    if (!unverifiedHostname) return [500, "Missing Hostname"]
    const data = await new Promise<[number, string] | { hostname: `${string}:${number}`; userAgent: string, username: string, }>(resolve => {
      fetch(`http://${unverifiedHostname}/auth`).then(async response => {
        const auth = AuthSchema.parse(JSON.parse(await response.text()))
        return resolve(Signature.fromString(auth.signature).verify(`I am ${unverifiedHostname}`, auth.address) ? { hostname: unverifiedHostname as `${string}:${number}`, userAgent: auth.userAgent, username: auth.username } : [500, 'Invalid authentication from server'])
      }).catch(() => resolve([500, `Failed to verify hostname`]))
    })
    if (Array.isArray(data)) return data
    return { address: res.address, hostname: data.hostname, userAgent: data.userAgent, username: data.username }
  },
  serverFromClient: (hostname: `${string}:${number}`) => new Promise<false | { address: `0x${string}`, userAgent: string; username: string, }>(resolve => {
    log(`[HIP3] Verifying server address ${hostname}`)
    fetch(`http://${hostname}/auth`).then(async response => {
      const { data: auth } = AuthSchema.safeParse(JSON.parse(await response.text()))
      if (!auth) return resolve(warn('WARN:', `[HIP3] Failed to authenticate server ${hostname}`))
      const signature = Signature.fromString(auth.signature)
      console.log({ expected: `I am ${hostname}`, signed: signature.message })
      return resolve(signature.verify(`I am ${hostname}`, auth.address) ? { address: auth.address, userAgent: auth["userAgent"], username: auth.username } : warn('DEVWARN:', `[HIP3] Invalid authentication from client ${hostname}`))
    }).catch((error: Error) => resolve(warn('WARN:', `[HIP3] Failed to connect to server ${hostname}`, `- ${error.name} ${error.message}`)))
  })
}

export const HIP3_CONN_Authentication =  {
  proveClientAddress: (account: Account, hostname: string) => prove.client(account, hostname),
  proveServerIdentity: (account: Account) => prove.server(account),
  verifyClientFromServer: (headers: Record<string, string>) => verify.clientFromServer(headers),
  verifyServerFromClient: (hostname: `${string}:${number}`) => verify.serverFromClient(hostname),
}
