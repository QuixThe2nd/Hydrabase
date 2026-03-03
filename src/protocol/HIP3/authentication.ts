import type { Account } from "../../Crypto/Account";

import { CONFIG } from "../../config";
import { Signature } from "../../Crypto/Signature";
import { log, warn } from "../../log";
import { AuthSchema } from "../../networking/ws/client";

type Auth =
  | { apiKey: string; signature: Signature }
  | { apiKey: string; signature?: undefined }
  | { apiKey?: undefined; signature: Signature }

const prove = {
  client: {
    address: (account: Account, peerHostname: `ws://${string}`) => ({
      'x-address': account.address,
      "x-hostname": `ws://${CONFIG.serverHostname}:${CONFIG.serverPort}`,
      'x-signature': account.sign(`I am connecting to ${peerHostname}`).toString()
    })
  },
  server: {
    identity: (account: Account, port: number) => new Response(JSON.stringify({
      address: account.address,
      username: CONFIG.username,
      signature: account.sign(`I am ws://${CONFIG.serverHostname}:${port}`).toString()
    }))
  }
}

const verifyAuth = (auth: Auth | undefined, address: string | undefined): [number, string] | true => {
  if (!auth) return [400, 'Missing authentication']
  if (auth.apiKey && auth.apiKey !== CONFIG.apiKey) return [401, 'Invalid API key']
  else if (auth.signature) {
    if (!address) return [400, 'Missing address header']
    if (!auth.signature.verify(`I am connecting to ws://${CONFIG.serverHostname}:${CONFIG.serverPort}`, address)) return [403, 'Authentication failed']
  }
  return true
}

const verify = {
  client: {
    identity: (hostname: `ws://${string}`) => new Promise<{ address: `0x${string}`, username: string } | false>(resolve => {
      log(`[HIP3] Verifying server address ${hostname}`)
      const authUrl = `${hostname.replace('ws://', 'http://')}/auth`
      fetch(authUrl).then(async response => {
        const auth = AuthSchema.parse(JSON.parse(await response.text()))
        return resolve(Signature.fromString(auth.signature).verify(`I am ${hostname}`, auth.address) ? { address: auth.address, username: auth.username } : warn('DEVWARN:', "[HIP3] Invalid authentication from client's server"))
      }).catch((error: Error) => resolve(warn('WARN:', `[HIP3] Failed to authenticate server ${authUrl}`, `- ${error.name} ${error.message}`)))
    })
  },
  server: {
    address: (headers: Record<string, string>): `0x${string}` | Response => {
      log(`[HIP3] Verifying client address`)
      const { 'sec-websocket-protocol': protocol, 'x-address': address, 'x-api-key': _apiKey, 'x-signature': _signature } = headers
      const signature = _signature ? Signature.fromString(_signature) : undefined

      const keyProto = protocol?.split(',').map(s => s.trim()).find(s => s.startsWith('x-api-key-'))
      const apiKey= _apiKey ?? keyProto?.replace('x-api-key-', '')

      const auth = apiKey !== undefined || signature !== undefined ? { apiKey, signature } as Auth : undefined

      const res = verifyAuth(auth, address)
      if (res !== true) return new Response(res[1], { status: res[0] })

      return address as `0x${string}` ?? '0x0'
    },
    hostname: async (headers: Record<string, string>, address: `0x${string}`): Promise<{ hostname: `ws://${string}`, username: string } | Response> => {
      log(`[HIP3] Verifying client hostname ${address}`)
      if (address === '0x0') return { hostname: 'ws://', username: CONFIG.username }
      const hostname = headers['x-hostname']
      if (!hostname) return new Response('Missing hostname header', { status: 400 })
      const authUrl = `${hostname.replace('ws://', 'http://')}/auth`
      const data = await new Promise<{ address: `0x${string}`, username: string } | false>(resolve => {
        fetch(authUrl).then(async response => {
          const auth = AuthSchema.parse(JSON.parse(await response.text()))
          return resolve(Signature.fromString(auth.signature).verify(`I am ${hostname}`, auth.address) ? { address: auth.address, username: auth.username } : warn('DEVWARN:', '[HIP3] Invalid authentication from server'))
        }).catch((error: Error) => resolve(warn('WARN:', `[HIP3] Failed to authenticate server ${authUrl}`, `- ${error.name} ${error.message}`)))
      })
      if (!data) return new Response('Invalid authentication from your server', { status: 401 })
      return { hostname: hostname as `ws://${string}`, username: data.username }
    }
  }
}

export const HIP3_CONN_Authentication =  {
  proveClientAddress: (account: Account, peerHostname: `ws://${string}`) => prove.client.address(account, peerHostname),
  proveServerIdentity: (account: Account, listenPort: number) => prove.server.identity(account, listenPort),
  verifyClientIdentity: async (peerHostname: `ws://${string}`): Promise<{ address: `0x${string}`, username: string } | false> => {
    try {
      return await verify.client.identity(peerHostname)
    } catch (e) {
      if ((e as { code: string }).code === 'ConnectionRefused') {return false}
      throw e
    }
  },
  verifyServerAddress: (headers: Record<string, string>) => verify.server.address(headers),
  verifyServerHostname: (headers: Record<string, string>, peerAddress: `0x${string}`) => verify.server.hostname(headers, peerAddress),
}
