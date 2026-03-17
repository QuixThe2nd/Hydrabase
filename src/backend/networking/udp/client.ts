/* eslint-disable max-lines-per-function */
import bencode from 'bencode'
import dgram from 'dgram'
import { resolve4 } from 'dns/promises'
import net from 'net'

import type { Config, Socket } from '../../../types/hydrabase'
import type { Account } from '../../Crypto/Account'
import type PeerManager from '../../PeerManager'

import { debug, log, warn } from '../../../utils/log'
import { Trace } from '../../../utils/trace'
import { type Auth, type Identity, proveClient, proveServer, verifyClient, verifyServer } from '../../protocol/HIP1/handshake'
import { DHT_Node } from '../dht'
import { authenticatedPeers, type HandshakeDiscovery, type HandshakeRequest, type HandshakeResponse, type Query, UDP_Server, udpConnections } from './server'

const doH0Probe = (server: UDP_Server, hostname: `${string}:${number}`): Promise<[number, string] | Identity> => new Promise(resolve => {
  const txnId = Buffer.alloc(4)
  txnId.writeUInt32BE(Math.floor(Math.random() * 0xFFFFFFFF))
  const t = txnId.toString('hex')
  debug(`[UDP] [CLIENT] h0 probe to ${hostname} with txnId=${t}`)

  const timer = setTimeout(() => {
    server.cancelAwaiter(t)
    debug(`[UDP] [CLIENT] h0 probe timeout for ${hostname} txnId=${t}`)
    resolve([408, 'UDP h0 probe timeout'])
  }, 10_000)

  server.awaitResponse(t, (msg) => {
    if (msg.y !== 'h0r') return false
    clearTimeout(timer)
    const identity = msg.h0r as unknown as Identity
    debug(`[UDP] [CLIENT] h0 probe response from ${hostname}: address=${identity.address}`)
    resolve(identity)
    return true
  })

  const [host, port] = hostname.split(':') as [string, `${number}`]
  const payload: HandshakeDiscovery = { t, y: 'h0' }
  server.socket.send(bencode.encode(payload), Number(port), host)
})

const doH1Handshake = (server: UDP_Server, hostname: `${string}:${number}`, account: Account, node: Config['node'], trace?: Trace, tid?: string): Promise<[number, string] | Identity> => new Promise(resolve => {
  const txnId = Buffer.alloc(4)
  txnId.writeUInt32BE(Math.floor(Math.random() * 0xFFFFFFFF))
  const t = txnId.toString('hex')
  debug(`[UDP] [CLIENT] Auth attempt to ${hostname} with txnId=${t}`)
  trace?.step('h1 sent, proving client identity')
  const timer = setTimeout(() => {
    server.cancelAwaiter(t)
    debug(`[UDP] [CLIENT] Auth timeout for ${hostname} txnId=${t} — no matching response received`)
    trace?.step('Timeout waiting for h2')
    resolve([408, 'UDP auth timeout'])
  }, 10_000)
  server.awaitResponse(t, (msg) => {
    debug(`[UDP] [CLIENT] Awaiter fired for txnId=${t}, msg.y=${msg.y}`)
    if (msg.y === 'e') {
      debug(`[UDP] [CLIENT] Auth error from ${hostname}: ${msg.e.join(' ')}`)
      clearTimeout(timer)
      const code = typeof msg.e[0] === 'number' ? msg.e[0] : 500
      const text = typeof msg.e[1] === 'string' ? msg.e[1] : String(msg.e[0])
      trace?.step(`h2 error: ${text}`)
      resolve([code, text])
      return true
    }
    if (msg.y !== 'h2') return false
    trace?.step('h2 received')
    debug(`[UDP] [CLIENT] Received h2 from ${hostname}, verifying...`)
    const verification = verifyServer(msg.h2 as unknown as Auth, hostname)
    if (verification !== true) {
      debug(`[UDP] [CLIENT] h2 verification failed for ${hostname}: ${JSON.stringify(verification)}`)
      clearTimeout(timer)
      trace?.step('HIP1 verifyServer → invalid')
      resolve(verification)
      return true
    }
    trace?.step('HIP1 verifyServer → valid')
    const identity = msg.h2 as unknown as Identity
    authenticatedPeers.set(hostname, identity)
    log(`[UDP] [CLIENT] Authenticated server ${hostname}`)
    clearTimeout(timer)
    resolve(identity)
    const [dnsHost] = hostname.split(':') as [string]
    const [,port] = hostname.split(':')
    if (!net.isIP(dnsHost)) resolve4(dnsHost).then(addresses => {
      if (addresses.length > 0 && addresses[0] !== dnsHost) {
        const ipHostname = `${addresses[0]}:${port}` as `${string}:${number}`
        authenticatedPeers.set(ipHostname, identity)
        debug(`[UDP] [CLIENT] Also stored auth under resolved IP ${ipHostname}`)
      }
    }).catch((error: Error) => warn('DEVWARN:', `[UDP] [CLIENT] Dns lookup threw error`, {error}))
    return true
  })
  const [host, port] = hostname.split(':') as [string, `${number}`]
  const payload: HandshakeRequest = { h1: proveClient(account, node, hostname), id: DHT_Node.getNodeId(node), t, y: 'h1' }
  if (tid) payload.tid = tid
  server.socket.send(bencode.encode(payload), Number(port), host)
  debug(`[UDP] [CLIENT] Sent h1 to ${host}:${port} txnId=${t}`)
})

export const authenticateServerUDP = (server: UDP_Server, hostname: `${string}:${number}`, account: Account, node: Config['node'], trace?: Trace): Promise<[number, string] | Identity> => new Promise(resolve => {
    const txnId = Buffer.alloc(4)
    txnId.writeUInt32BE(Math.floor(Math.random() * 0xFFFFFFFF))
    const t = txnId.toString('hex')
    const tid = trace?.traceId
    debug(`[UDP] [CLIENT] h0 discovery to ${hostname} with txnId=${t}`)
    trace?.step('h0 discovery → sent')

    const timer = setTimeout(() => {
      server.cancelAwaiter(t)
      debug(`[UDP] [CLIENT] h0 timeout for ${hostname} txnId=${t}`)
      trace?.step('h0 timeout')
      resolve([408, 'UDP h0 discovery timeout'])
    }, 10_000)

    server.awaitResponse(t, (msg) => {
      if (msg.y !== 'h0r') return false
      clearTimeout(timer)
      trace?.step(`h0r received, server identifies as ${msg.h0r.hostname}`)
      debug(`[UDP] [CLIENT] Received h0r from ${hostname}, server identifies as ${msg.h0r.hostname}`)

      const canonicalHostname = msg.h0r.hostname as `${string}:${number}`
      if (canonicalHostname !== hostname) {
        trace?.step(`Upgrading hostname → ${canonicalHostname}`)
        debug(`[UDP] [CLIENT] Upgrading hostname from ${hostname} to ${canonicalHostname}`)
        const childTrace = trace?.child(`h1 handshake to ${canonicalHostname}`)
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
    debug(`[UDP] [CLIENT] Sent h0 to ${host}:${port} txnId=${t}`)
  })

export class UDP_Client implements Socket {
  public isOpened = true
  public readonly messageHandlers: ((message: string) => void)[] = []
  private closeHandlers: (() => void)[] = []
  private readonly node: { host: string, port: number }
  private openHandler?: () => void
  private constructor(private readonly peers: PeerManager, public readonly peer: Identity, private readonly config: Config['rpc'], private readonly id: string) {
    authenticatedPeers.set(`${peer.hostname}`, peer)
    udpConnections.set(peer.hostname, this)
    log(`[UDP] [CLIENT] Connecting to peer ${peer.hostname}`)
    const [host, port] = peer.hostname.split(':') as [string, `${number}`]
    this.node = { host, port: Number(port) }
    
    // Also store under resolved IP
    const [dnsHost] = peer.hostname.split(':') as [string]
    const [,portStr] = peer.hostname.split(':')
    if (!net.isIP(dnsHost)) {
      resolve4(dnsHost).then(addresses => {
        if (addresses.length > 0 && addresses[0] !== dnsHost) {
          const ipHostname = `${addresses[0]}:${portStr}` as `${string}:${number}`
          authenticatedPeers.set(ipHostname, peer)
          debug(`[UDP] [CLIENT] Also stored peer auth under resolved IP ${ipHostname}`)
        }
      }).catch((error: Error) => warn('DEVWARN:', `[UDP] [CLIENT] Dns lookup threw error`, {error}))
    }
    
    setTimeout(() => this.openHandler?.(), 0)
  }
  static readonly connectToAuthenticatedPeer = (peerManager: PeerManager, identity: Identity, config: Config['rpc'], nodeId: string): UDP_Client => new UDP_Client(peerManager, identity, config, nodeId)
  static readonly connectToUnauthenticatedPeer = async (peerManager: PeerManager, auth: HandshakeRequest, peerHostname: `${string}:${number}`, node: Config['node'], config: Config['rpc'], apiKey: string | undefined, socket: dgram.Socket, server: UDP_Server, trace: Trace): Promise<false | UDP_Client> => {
    debug(`[UDP] [CLIENT] Sending h2 to ${peerHostname} txnId=${auth.t}`)
    socket.send(bencode.encode({ h2: proveServer(peerManager.account, node), t: auth.t, y: 'h2' } satisfies HandshakeResponse), Number(peerHostname.split(':')[1]), peerHostname.split(':')[0])
    const identity = await verifyClient(node, peerHostname, auth.h1 as unknown as Auth, apiKey, async (claimedHostname): Promise<[number, string] | Identity> => {
      const [actualIP] = peerHostname.split(':')
      const [claimedHost] = claimedHostname.split(':')
      
      if (actualIP === claimedHost) {
        debug(`[UDP] [CLIENT] Hostname verified: ${peerHostname} matches claimed ${claimedHostname} (direct IP match)`)
        return { ...auth.h1, hostname: peerHostname } as unknown as Identity
      }
      
      debug(`[UDP] [CLIENT] Verifying claimed hostname ${claimedHostname} via h0 probe (actual=${actualIP}, claimed=${claimedHost})`)
      const probeResult = await doH0Probe(server, claimedHostname)
      if (Array.isArray(probeResult)) {
        debug(`[UDP] [CLIENT] h0 probe to ${claimedHostname} failed: ${probeResult[1]}`)
        return probeResult
      }
      if (probeResult.address !== (auth.h1 as unknown as Auth).address) {
        debug(`[UDP] [CLIENT] h0 probe address mismatch: h1 claims ${(auth.h1 as unknown as Auth).address} but ${claimedHostname} has ${probeResult.address}`)
        return [500, 'Address mismatch between h1 and h0 probe']
      }
      debug(`[UDP] [CLIENT] Hostname verified via h0 probe: ${claimedHostname} has same address ${probeResult.address}`)
      return probeResult
    }, trace)
    debug(`[UDP] [CLIENT] verifyClient result for ${peerHostname}: ${Array.isArray(identity) ? identity.join(' ') : `success ${identity.username}`}`)
    if (Array.isArray(identity)) return warn('DEVWARN:', `[UDP] [CLIENT] UDP auth query verification failed for ${peerHostname}: ${identity[1]}`)
    log(`[UDP] [CLIENT] Authenticated peer ${identity.username} ${identity.address} at ${peerHostname} via UDP auth query`)
    authenticatedPeers.set(peerHostname, identity)
    if (!udpConnections.has(peerHostname)) peerManager.add(new UDP_Client(peerManager, { ...identity, hostname: peerHostname }, config, auth.id))
    return new UDP_Client(peerManager, identity, config, auth.id)
  }
  public readonly close = () => {
    this.isOpened = false
    udpConnections.delete(`${this.node.host}:${this.node.port}`)
    this.closeHandlers.map(handler => handler())
  }
  public readonly onClose = (handler: () => void) => {
    this.closeHandlers.push(() => handler())
  }
  public onMessage(handler: (message: string) => void) {
    this.messageHandlers.push(handler)
  }
  public onOpen(handler: () => void) {
    this.openHandler = () => handler()
  }
  public readonly send = (message: string) => {
    const MAX_CHUNK_PAYLOAD = 1200
    const tid = Buffer.alloc(4)
    tid.writeUInt32BE(Math.floor(Math.random() * 0xFFFFFFFF))
    const txnId = tid.toString('hex')
    
    if (message.length <= MAX_CHUNK_PAYLOAD) {
      this.peers.socket.send(bencode.encode({ a: { d: message, id: this.id }, q: `${this.config.prefix}msg`, t: txnId, y: 'q' } satisfies Query), Number(this.peer.hostname.split(':')[1]), this.peer.hostname.split(':')[0])
      return
    }
    
    const chunkId = Buffer.alloc(4)
    chunkId.writeUInt32BE(Math.floor(Math.random() * 0xFFFFFFFF))
    const c = chunkId.toString('hex')
    const totalChunks = Math.ceil(message.length / MAX_CHUNK_PAYLOAD)
    
    debug(`[UDP] [CLIENT] Chunking message to ${this.peer.hostname}: ${message.length} bytes -> ${totalChunks} chunks (chunkId=${c})`)
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * MAX_CHUNK_PAYLOAD
      const end = Math.min(start + MAX_CHUNK_PAYLOAD, message.length)
      const chunkData = message.slice(start, end)
      
      const sendChunk = () => {
        this.peers.socket.send(
          bencode.encode({ 
            a: { c, d: chunkData, i, id: this.id, n: totalChunks }, 
            q: `${this.config.prefix}msg`, 
            t: txnId, 
            y: 'q' 
          } satisfies Query), 
          Number(this.peer.hostname.split(':')[1]), 
          this.peer.hostname.split(':')[0]
        )
        debug(`[UDP] [CLIENT] Sent chunk ${i + 1}/${totalChunks} to ${this.peer.hostname} (${chunkData.length} bytes)`)
      }
      
      if (i === 0) {
        sendChunk()
      } else {
        setTimeout(sendChunk, i * 2)
      }
    }
  }
}
