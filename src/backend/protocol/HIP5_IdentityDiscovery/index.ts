import bencode from 'bencode'
import dgram from 'dgram'
import { resolve4 } from 'dns/promises'
import net from 'net'
import z from 'zod'

import type { Config } from '../../../types/hydrabase'
import type { Account } from '../../Crypto/Account'
import type PeerManager from '../../PeerManager'

import { debug, log, warn } from '../../../utils/log'
import { Trace } from '../../../utils/trace'
import { DHT_Node } from '../../networking/dht'
import { UDP_Client } from '../../networking/udp/client'
import { authenticatedPeers, type RPCMessage, UDP_Server } from '../../networking/udp/server'
import { BaseMessage, BinaryHex, BinaryString } from '../DHT'
import { type Auth, type Identity, proveClient, proveServer, verifyServer } from '../HIP1_Identity'

export const AuthSchema = z.object({
  address: BinaryString,
  hostname: BinaryString,
  signature: BinaryString,
  userAgent: BinaryString,
  username:  BinaryString,
}).strict()

export const H0_HandshakeDiscoverySchema = BaseMessage.extend({
  tid: BinaryString.optional(),
  y: z.literal('h0')
}).strict()
export const H0R_HandshakeDiscoveryResponseSchema = BaseMessage.extend({
  h0r: AuthSchema,
  tid: BinaryString.optional(),
  y: z.literal('h0r')
}).strict()
export const H1_HandshakeRequestSchema = BaseMessage.extend({ 
  h1: AuthSchema,
  id: BinaryHex,
  tid: BinaryString.optional(),
  y: z.literal('h1') 
}).strict()
export const H2_HandshakeResponseSchema = BaseMessage.extend({ 
  h2: AuthSchema,
  tid: BinaryString.optional(),
  y: z.literal('h2')
}).strict()
export type HandshakeDiscovery = z.infer<typeof H0_HandshakeDiscoverySchema>
export type HandshakeDiscoveryResponse = z.infer<typeof H0R_HandshakeDiscoveryResponseSchema>
export type HandshakeRequest = z.infer<typeof H1_HandshakeRequestSchema>
export type HandshakeResponse = z.infer<typeof H2_HandshakeResponseSchema>

export const doH0Probe = (server: UDP_Server, hostname: `${string}:${number}`, trace: Trace): Promise<[number, string] | Identity> => new Promise(resolve => {
  const txnId = Buffer.alloc(4)
  txnId.writeUInt32BE(Math.floor(Math.random() * 0xFFFFFFFF))
  const t = txnId.toString('hex')
  trace.step(`h0 probe → ${hostname}`)

  const timer = setTimeout(() => {
    server.cancelAwaiter(t)
    trace.step('h0 probe timeout')
    resolve([408, 'UDP h0 probe timeout'])
  }, 10_000)

  server.awaitResponse(t, msg => {
    if (msg.y !== 'h0r') return false
    clearTimeout(timer)
    const identity = msg.h0r as unknown as Identity
    trace.step(`h0 probe response: ${identity.address}`)
    resolve(identity)
    return true
  })

  const [host, port] = hostname.split(':') as [string, `${number}`]
  const payload: HandshakeDiscovery = { t, y: 'h0' }
  server.socket.send(bencode.encode(payload), Number(port), host)
})

// eslint-disable-next-line max-lines-per-function
export const doH1Handshake = (server: UDP_Server, hostname: `${string}:${number}`, account: Account, node: Config['node'], trace: Trace, tid?: string): Promise<[number, string] | Identity> => new Promise(resolve => {
  const txnId = Buffer.alloc(4)
  txnId.writeUInt32BE(Math.floor(Math.random() * 0xFFFFFFFF))
  const t = txnId.toString('hex')
  trace.step(`[CLIENT] Auth attempt to ${hostname} with txnId=${t}`)
  trace.step('h1 sent, proving client identity')
  const timer = setTimeout(() => {
    server.cancelAwaiter(t)
    trace.step(`[CLIENT] Auth timeout for ${hostname} txnId=${t} — no matching response received`)
    trace.step('Timeout waiting for h2')
    resolve([408, 'UDP auth timeout'])
  }, 10_000)
  server.awaitResponse(t, (msg) => {
    trace.step(`[CLIENT] Awaiter fired for txnId=${t}, msg.y=${msg.y}`)
    if (msg.y === 'e') {
      trace.step(`[CLIENT] Auth error from ${hostname}: ${msg.e.join(' ')}`)
      clearTimeout(timer)
      const code = typeof msg.e[0] === 'number' ? msg.e[0] : 500
      const text = typeof msg.e[1] === 'string' ? msg.e[1] : String(msg.e[0])
      trace.step(`h2 error: ${text}`)
      resolve([code, text])
      return true
    }
    if (msg.y !== 'h2') return false
    trace.step(`[CLIENT] Received h2 from ${hostname}, verifying...`)
    const verification = verifyServer(msg.h2 as unknown as Auth, hostname, trace)
    if (verification !== true) {
      trace.step(`[CLIENT] h2 verification failed for ${hostname}: ${JSON.stringify(verification)}`)
      clearTimeout(timer)
      trace.step('HIP1 verifyServer → invalid')
      resolve(verification)
      return true
    }
    trace.step('HIP1 verifyServer → valid')
    const identity = msg.h2 as unknown as Identity
    authenticatedPeers.set(hostname, identity)
    trace.step(`[CLIENT] Authenticated server ${hostname}`)
    clearTimeout(timer)
    resolve(identity)
    const [dnsHost] = hostname.split(':') as [string]
    const [,port] = hostname.split(':')
    if (!net.isIP(dnsHost)) resolve4(dnsHost).then(addresses => {
      if (addresses.length > 0 && addresses[0] !== dnsHost) {
        const ipHostname = `${addresses[0]}:${port}` as `${string}:${number}`
        authenticatedPeers.set(ipHostname, identity)
        trace.step(`[CLIENT] Also stored auth under resolved IP ${ipHostname}`)
      }
    }).catch((error: Error) => warn('DEVWARN:', '[CLIENT] Dns lookup threw error', {error}))
    return true
  })
  const [host, port] = hostname.split(':') as [string, `${number}`]
  const payload: HandshakeRequest = { h1: proveClient(account, node, hostname, trace, false), id: DHT_Node.getNodeId(node), t, y: 'h1' }
  if (tid) payload.tid = tid
  server.socket.send(bencode.encode(payload), Number(port), host)
  trace.step(`[CLIENT] Sent h1 to ${host}:${port} txnId=${t}`)
})

export const authenticateServerUDP = (server: UDP_Server, hostname: `${string}:${number}`, account: Account, node: Config['node'], trace: Trace): Promise<[number, string] | Identity> => new Promise(resolve => {
  const txnId = Buffer.alloc(4)
  txnId.writeUInt32BE(Math.floor(Math.random() * 0xFFFFFFFF))
  const t = txnId.toString('hex')
  const tid = trace.traceId
  trace.step('[HIP5] Sending h0 discovery request')

  const timer = setTimeout(() => {
    server.cancelAwaiter(t)
    resolve([408, '[HIP5] h0 discovery request timed out'])
  }, 10_000)

  server.awaitResponse(t, (msg) => {
    if (msg.y !== 'h0r') return false
    clearTimeout(timer)
    trace.step(`h0r received, server identifies as ${msg.h0r.hostname}`)

    const canonicalHostname = msg.h0r.hostname as `${string}:${number}`
    if (canonicalHostname !== hostname) {
      trace.step(`Upgrading hostname → ${canonicalHostname}`)
      const childTrace = trace.child(`h1 handshake to ${canonicalHostname}`)
      authenticateServerUDP(server, canonicalHostname, account, node, childTrace).then(result => {
        if (!Array.isArray(result)) authenticatedPeers.set(hostname, result)
        resolve(result)
      })
      return true
    }

    doH1Handshake(server, hostname, account, node, trace, tid).then(resolve)
    return true
  })

  const [host, port] = hostname.split(':') as [string, `${number}`]
  const payload: HandshakeDiscovery = { t, y: 'h0' }
  if (tid) payload.tid = tid
  server.socket.send(bencode.encode(payload), Number(port), host)
  trace.step(`[HIP5] Sent h0 discovery request with txnId=${t}`)
})

export const handleHandshake = async (server: UDP_Server, socket: dgram.Socket, peerManager: PeerManager, query: RPCMessage, peerHostname: `${string}:${number}`, peer: { host: string, port: number }, node: Config['node'], config: Config['rpc'], apiKey: string | undefined): Promise<boolean> => {
  /** Rate-limit inbound h0 discovery per source: one response per 5 s */
  const h0LastSeen = new Map<string, number>()
  const H0_COOLDOWN_MS = 5_000

  /** Deduplicate rapid re-entrant h1s from the same peer (handshake storm guard) */
  const h1LastSeen = new Map<string, number>()
  const H1_COOLDOWN_MS = 5_000

  if (query.y === 'h0') {
    const now = Date.now()
    const last = h0LastSeen.get(peerHostname)
    if (last !== undefined && now - last < H0_COOLDOWN_MS) {
      debug(`[HANDSHAKE] Dropping duplicate h0 from ${peerHostname} (${now - last}ms since last response)`)
      return true
    }
    h0LastSeen.set(peerHostname, now)
    const trace = Trace.start(`[HANDSHAKE] Received h0 discovery from ${peerHostname}`)
    const payload: HandshakeDiscoveryResponse = { h0r: proveServer(peerManager.account, node, trace), t: query.t, y: 'h0r' }
    if ('tid' in query && query.tid) payload.tid = query.tid
    socket.send(bencode.encode(payload), peer.port, peer.host)
    trace.success()
    return true
  } else if (query.y === 'h1') {
    const now = Date.now()
    const last = h1LastSeen.get(peerHostname)
    if (last !== undefined && now - last < H1_COOLDOWN_MS) {
      debug(`[HANDSHAKE] Dropping duplicate h1 from ${peerHostname} (${now - last}ms since last)`)
      return true
    }
    h1LastSeen.set(peerHostname, now)
    const tid = 'tid' in query && query.tid ? query.tid : undefined
    const trace = tid ? new Trace(tid, `Inbound UDP h1 from ${peerHostname}`) : Trace.start(`Inbound UDP h1 from ${peerHostname}`)
    trace.step('Received h1')
    log(`[HANDSHAKE] Received h1 from ${peerHostname} txnId=${query.t} address=${query.h1.address} hostname=${query.h1.hostname}`)
    const result = await UDP_Client.connectToUnauthenticatedPeer(peerManager, query, peerHostname, node, config, apiKey, socket, server, trace)
    if (result) {
      trace.step('HIP1 verifyClient → valid')
      return true
    } 
    trace.fail('Failed to validate UDP auth')
    return warn('DEVWARN:', '[SERVER] Failed to validate UDP auth')
  } else if (query.y === 'h2') return warn('DEVWARN:', `[HANDSHAKE] Received h2 from ${peerHostname} txnId=${query.t} but no awaiter matched — this means the txnId doesn't match any pending auth request`)
  else if (query.y === 'h0r') {
    debug(`[HANDSHAKE] Received orphaned h0r from ${peerHostname}`)
    return false
  }
  return false
}
