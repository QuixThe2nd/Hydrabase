/* eslint-disable max-lines, max-lines-per-function */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import z from 'zod'

import type { Config, WebSocketData } from '../types/hydrabase'
import type { Peer } from './peer'

import { RequestSchema, type Response, ResponseSchema } from '../types/hydrabase-schemas'
import { Account, generatePrivateKey } from './Crypto/Account'
import { Signature } from './Crypto/Signature'
import { startDatabase } from './db'
import MetadataManager from './Metadata'
import ITunes from './Metadata/plugins/iTunes'
import { startServer } from './networking/http'
import { authenticatedPeers, UDP_Server } from './networking/udp'
import { handleConnection } from './networking/ws/server'
import { Node } from './Node'
import PeerManager from './PeerManager'
import { PeerMap } from './PeerMap'
import { AuthSchema, proveClient, proveServer, verifyClient, verifyServer } from './protocol/HIP1/handshake'
import { HIP2_Conn_Message } from './protocol/HIP2/message'
import { type Ping, PingSchema } from './protocol/HIP2/message'
import { AnnounceSchema } from './protocol/HIP3/announce'
import { RequestManager } from './RequestManager'

const config1 = {
  hostname: '127.0.0.1',
  ip: '127.0.0.1',
  listenAddress: '127.0.0.1',
  port: 14545,
  preferTransport: 'TCP',
  username: 'TestNode1'
} satisfies Config['node']
const config2 = {
  hostname: '127.0.0.1',
  ip: '127.0.0.1',
  listenAddress: '127.0.0.1',
  port: 14546,
  preferTransport: 'TCP',
  username: 'TestNode2'
} satisfies Config['node']
const config3 = {
  hostname: '127.0.0.1',
  ip: '127.0.0.1',
  listenAddress: '127.0.0.1',
  port: 14547,
  preferTransport: 'UDP',
  username: 'TestNode3'
} satisfies Config['node']

const rpcConfig = {
  prefix: 'hydra_'
} satisfies Config['rpc']

const formulas = {
  finalConfidence: '0.5',
  pluginConfidence: '0.5'
} satisfies Config['formulas']

let peerManager1: PeerManager
let peerManager2: PeerManager
let peerManager3: PeerManager
let server1: Bun.Server<WebSocketData>
let server2: Bun.Server<WebSocketData>
let server3: Bun.Server<WebSocketData>

beforeAll(async () => {
  authenticatedPeers.clear()
  const repos = startDatabase(formulas.pluginConfidence)
  const metadataManager = new MetadataManager([new ITunes()], repos, 32)

  // Start Node 1
  const account1 = new Account(generatePrivateKey())
  const node1 = new Node(metadataManager, () => peerManager1, formulas)
  const udpServer1 = await UDP_Server.init(() => peerManager1, rpcConfig, config1, undefined)
  peerManager1 = new PeerManager(account1, metadataManager, repos, async (type, query, searchPeers) => node1 ? await node1.search(type, query, searchPeers) : [], config1, rpcConfig, udpServer1, udpServer1.socket)
  server1 = startServer(account1, peerManager1, config1, '')
  udpServer1.socket.bind(config1.port)

  // Start Node 2
  const account2 = new Account(generatePrivateKey())
  const node2 = new Node(metadataManager, () => peerManager2, formulas)
  const udpServer2 = await UDP_Server.init(() => peerManager2, rpcConfig, config2, undefined)
  peerManager2 = new PeerManager(account2, metadataManager, repos, async (type, query, searchPeers) => node2 ? await node2.search(type, query, searchPeers) : [], config2, rpcConfig, udpServer2, udpServer2.socket)
  server2 = startServer(account2, peerManager2, config2, '')
  udpServer2.socket.bind(config2.port)

  // Start Node 3
  const account3 = new Account(generatePrivateKey())
  const node3 = new Node(metadataManager, () => peerManager3, formulas)
  const udpServer3 = await UDP_Server.init(() => peerManager3, rpcConfig, config3, undefined)
  peerManager3 = new PeerManager(account3, metadataManager, repos, async (type, query, searchPeers) => node3 ? await node3.search(type, query, searchPeers) : [], config3, rpcConfig, udpServer3, udpServer3.socket)
  server3 = startServer(account3, peerManager3, config3, '')
  udpServer3.socket.bind(config3.port)

  await new Promise(res => { setTimeout(res, 5_000) })
}, {
  timeout: 20_000
})

afterAll(() => {
  server1.stop()
  server2.stop()
  server3.stop()
})

describe('Signature', () => {
  it('signs and verifies a message round-trip', () => {
    const account = new Account(generatePrivateKey())
    const message = 'I am connecting to 127.0.0.1:14545'
    const sig = account.sign(message)
    expect(sig.verify(message, account.address)).toBe(true)
  })

  it('rejects a signature for the wrong message', () => {
    const account = new Account(generatePrivateKey())
    const sig = account.sign('I am connecting to 127.0.0.1:14545')
    expect(sig.verify('I am connecting to 127.0.0.1:9999', account.address)).toBe(false)
  })

  it('rejects a signature from the wrong keypair', () => {
    const a = new Account(generatePrivateKey())
    const b = new Account(generatePrivateKey())
    const msg = 'I am connecting to 127.0.0.1:14545'
    const sig = a.sign(msg)
    // B's address ≠ a's address → verify should fail
    expect(sig.verify(msg, b.address)).toBe(false)
  })

  it('serialises and deserialises a Signature without data loss', () => {
    const account = new Account(generatePrivateKey())
    const message = 'I am 127.0.0.1:14545'
    const original = account.sign(message)
    const roundTripped = Signature.fromString(original.toString())
    expect(roundTripped.message).toBe(message)
    expect(roundTripped.verify(message, account.address)).toBe(true)
  })
})

describe('HIP1', () => {
  it('produces client proof that is is verified by server', async () => {
    const auth = proveClient(peerManager1.account, config1, `${config2.hostname}:${config2.port}`)
    expect(await verifyClient(config2, `${config1.hostname}:${config1.port}`, auth, '', (): [number, string] => [500, 'Bad path'])).not.toBeArray()
  })

  it('produces server proof that is is verified by client', () => {
    expect(verifyServer(proveServer(peerManager1.account, config1), `${config1.hostname}:${config1.port}`)).not.toBeArray()
  })

  it('peer 1 connected to peer 2 over TCP', async () => {
    expect(await peerManager1.add(`${config2.hostname}:${config2.port}`, 'TCP')).toBe(true)
  })

  it('connecting to existing peer should throw', async () => {
    expect(await peerManager1.add(`${config2.hostname}:${config2.port}`, 'TCP')).toBe(false)
  })

  it('peer 2 connected to peer 3 over UDP', async () => {
    expect(await peerManager2.add(`${config3.hostname}:${config3.port}`, 'UDP')).toBe(true)
  })

  it('peers 1 and 2 have connected to each other', async () => {
    await new Promise(res => { setTimeout(res, 1_000) })
    const server = peerManager1.connectedPeers.find(peer => peer.hostname === `${config2.hostname}:${config2.port}`)
    expect(server).toBeDefined()
    const client = peerManager2.connectedPeers.find(peer => peer.hostname === `${config1.hostname}:${config1.port}`)
    expect(client).toBeDefined()
  })
})

describe('HIP2', () => {
  it('received pong from ping', async () => {
    const peer2 = peerManager1.connectedPeers.find(peer => peer.hostname === `${config2.hostname}:${config2.port}`) as Peer
    expect(peer2).toBeDefined()
    const time = Number(new Date())
    peer2.send({ nonce: 3, ping: { time } })
    const pong = await new Promise<Ping>(res => {
      peer2.socket.onMessage(msg => {
        const {data} = z.object({ pong: PingSchema }).safeParse(JSON.parse(msg))
        if (data) res(data.pong)
      })
    })
    expect(pong.time).toBeNumber()
    expect(pong.time).toBeGreaterThanOrEqual(time)
  })

  it('received response from request', async () => {
    const peer2 = peerManager1.connectedPeers.find(peer => peer.hostname === `${config2.hostname}:${config2.port}`) as Peer
    expect(peer2).toBeDefined()
    peer2.send({ nonce: 3, request: { query: 'elton john', type: 'artists' } })
    const results = await new Promise<Response>(res => {
      peer2.socket.onMessage(msg => {
        const {data} = z.object({ response: ResponseSchema }).safeParse(JSON.parse(msg))
        if (data) res(data.response)
      })
    })
    expect(results.length).toBeGreaterThan(0)
  })
  
  it('concurrent requests resolve to correct nonces', async () => {
    const peer2 = peerManager1.connectedPeers.find(peer => peer.hostname === `${config2.hostname}:${config2.port}`) as Peer
    expect(peer2).toBeDefined()
    let receivedResponse = false
    peer2.socket.onMessage(msg => {
      const {data} = z.object({ response: ResponseSchema }).safeParse(JSON.parse(msg))
      if (data) receivedResponse = true
    })
    const [r1, r2, r3] = await Promise.all([
      peer2.search('artists', 'elton john'),
      peer2.search('artists', 'beatles'),
      peer2.search('artists', 'radiohead'),
    ])
    expect(Array.isArray(r1)).toBe(true)
    expect(Array.isArray(r2)).toBe(true)
    expect(Array.isArray(r3)).toBe(true)
    expect(r1.length).toBeGreaterThan(0)
    expect(r2.length).toBeGreaterThan(0)
    expect(r3.length).toBeGreaterThan(0)
    expect(receivedResponse).toBe(true)
  }, { timeout: 30_000 })
})

describe('HIP3', () => {
  it('peers 1 and 3 discovered each other through peer 2', () => {
    const peer3 = peerManager1.connectedPeers.find(peer => peer.hostname === `${config3.hostname}:${config3.port}`) as Peer
    const peer1 = peerManager3.connectedPeers.find(peer => peer.hostname === `${config1.hostname}:${config1.port}`) as Peer
    expect(peer1).toBeDefined()
    expect(peer3).toBeDefined()
  })
})
describe('Account', () => {
  it('generates unique private keys', () => {
    const key1 = generatePrivateKey()
    const key2 = generatePrivateKey()
    expect(Buffer.compare(key1, key2)).not.toBe(0)
  })

  it('derives a valid Ethereum-style address', () => {
    const account = new Account(generatePrivateKey())
    expect(account.address).toStartWith('0x')
    expect(account.address).toHaveLength(42)
  })

  it('derives deterministic address from same key', () => {
    const key = generatePrivateKey()
    const a1 = new Account(key)
    const a2 = new Account(key)
    expect(a1.address).toBe(a2.address)
  })

  it('different keys produce different addresses', () => {
    const a1 = new Account(generatePrivateKey())
    const a2 = new Account(generatePrivateKey())
    expect(a1.address).not.toBe(a2.address)
  })
})

describe('Signature edge cases', () => {
  it('handles empty string message', () => {
    const account = new Account(generatePrivateKey())
    const sig = account.sign('')
    expect(sig.verify('', account.address)).toBe(true)
  })

  it('handles very long messages', () => {
    const account = new Account(generatePrivateKey())
    const longMsg = 'a'.repeat(10_000)
    const sig = account.sign(longMsg)
    expect(sig.verify(longMsg, account.address)).toBe(true)
  })

  it('handles unicode messages', () => {
    const account = new Account(generatePrivateKey())
    const msg = 'I am connecting to 🌍:4545'
    const sig = account.sign(msg)
    expect(sig.verify(msg, account.address)).toBe(true)
  })

  it('fromString throws on invalid input', () => {
    expect(() => Signature.fromString('')).toThrow()
    expect(() => Signature.fromString('not-json')).toThrow()
    expect(() => Signature.fromString('{}')).toThrow()
  })

  it('preserves message through serialization', () => {
    const account = new Account(generatePrivateKey())
    const msg = 'I am connecting to 127.0.0.1:4545'
    const sig = account.sign(msg)
    const serialized = sig.toString()
    const deserialized = Signature.fromString(serialized)
    expect(deserialized.message).toBe(msg)
    expect(deserialized.recid).toBe(sig.recid)
  })
})

describe('HIP1 handshake edge cases', () => {
  it('rejects client proof with wrong target hostname', async () => {
    const auth = proveClient(peerManager1.account, config1, '10.0.0.1:9999')
    const result = await verifyClient(config2, `${config1.hostname}:${config1.port}`, auth, '', () => [500, 'Bad path'])
    expect(result).toBeArray()
    const [code] = result as [number, string]
    expect(code).toBe(403)
  })

  // it('rejects tampered signature', async () => {
  //   const auth = proveClient(peerManager1.account, config1, `${config2.hostname}:${config2.port}`)
  //   auth.signature = 'invalid-signature-data'
  //   expect(await verifyClient(config2, `${config1.hostname}:${config1.port}`, auth, '', () => [500, 'Bad path'])).rejects.toThrow()
  // })

  it('verifies API key auth', async () => {
    const result = await verifyClient(config1, '', { apiKey: 'test-key' }, 'test-key', () => [500, 'unused'])
    expect(result).not.toBeArray()
    const identity = result as { address: `0x${string}`, hostname: string }
    expect(identity.address).toBe('0x0')
  })

  it('rejects wrong API key', async () => {
    const result = await verifyClient(config1, '', { apiKey: 'wrong-key' }, 'correct-key', () => [500, 'unused'])
    expect(result).toBeArray()
    const [code] = result as [number, string]
    expect(code).toBe(500)
  })

  it('verifyServer rejects mismatched hostname', () => {
    const proof = proveServer(peerManager1.account, config1)
    const result = verifyServer(proof, 'wrong.host:9999')
    expect(result).toBeArray()
    expect((result as [number, string])[1]).toContain('Expected')
  })

  it('verifyServer crashes on tampered signature (no input validation)', () => {
    const proof = proveServer(peerManager1.account, config1)
    proof.signature = 'tampered'
    expect(() => verifyServer(proof, `${config1.hostname}:${config1.port}`)).toThrow()
  })
})

describe('PeerMap', () => {
  it('excludes 0x0 (API peer) from addresses list', () => {
    const map = new PeerMap()
    const [mockPeer] = peerManager1.connectedPeers
    if (mockPeer) {
      map.set(mockPeer.address, mockPeer)
      map.set('0x0' as `0x${string}`, mockPeer)
      expect(map.addresses).not.toContain('0x0')
      expect(map.count).toBe(map.addresses.length)
    }
  })

  it('tracks count correctly through set and delete', () => {
    const map = new PeerMap()
    const [mockPeer] = peerManager1.connectedPeers
    if (mockPeer) {
      expect(map.count).toBe(0)
      map.set('0xabc' as `0x${string}`, mockPeer)
      expect(map.count).toBe(1)
      map.delete('0xabc' as `0x${string}`)
      expect(map.count).toBe(0)
    }
  })
})

describe('RequestManager', () => {
  it('registers and resolves a request', async () => {
    const rm = new RequestManager(5_000)
    const { nonce, promise } = rm.register<'artists'>()
    expect(nonce).toBe(0)
    const mockResponse = [{ address: '0xabc' as `0x${string}`, confidence: 1, external_urls: {}, followers: 100, genres: ['rock'], id: '1', image_url: '', name: 'Test', plugin_id: 'test', popularity: 50, soul_id: 'soul_1' }]
    rm.resolve(nonce, mockResponse)
    const result = await promise
    expect(result).toBeArray()
    expect((result as typeof mockResponse).length).toBe(1)
  })

  it('increments nonces', () => {
    const rm = new RequestManager(5_000)
    const r1 = rm.register<'artists'>()
    const r2 = rm.register<'artists'>()
    const r3 = rm.register<'artists'>()
    expect(r1.nonce).toBe(0)
    expect(r2.nonce).toBe(1)
    expect(r3.nonce).toBe(2)
    rm.close()
  })

  it('times out unresolved requests', async () => {
    const rm = new RequestManager(100) // 100ms timeout
    const { promise } = rm.register<'artists'>()
    const result = await promise
    expect(result).toBe(false)
  }, { timeout: 5_000 })

  it('resolve returns false for unknown nonce', () => {
    const rm = new RequestManager(5_000)
    expect(rm.resolve(999, [])).toBe(false)
    rm.close()
  })

  it('tracks average latency', async () => {
    const rm = new RequestManager(5_000)
    const { nonce, promise } = rm.register<'artists'>()
    await new Promise(res => { setTimeout(res, 50) })
    rm.resolve(nonce, [])
    await promise
    expect(rm.averageLatencyMs).toBeGreaterThan(0)
  })

  it('close resolves all pending requests with false', async () => {
    const rm = new RequestManager(60_000)
    const { promise: p1 } = rm.register<'artists'>()
    const { promise: p2 } = rm.register<'artists'>()
    rm.close()
    expect(await p1).toBe(false)
    expect(await p2).toBe(false)
  })
})

describe('HIP2 message parsing', () => {
  it('identifies message types correctly', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const identify = (obj: any) => HIP2_Conn_Message.identifyType(obj)
    expect(identify({ request: { query: 'test', type: 'artists' } })).toBe('request')
    expect(identify({ response: [] })).toBe('response')
    expect(identify({ announce: { hostname: '1.2.3.4:4545' } })).toBe('announce')
    expect(identify({ ping: { time: 123 } })).toBe('ping')
    expect(identify({ pong: { time: 123 } })).toBe('pong')
    expect(identify({ unknown: true })).toBeNull()
  })
})

describe('Schema validation', () => {
  it('RequestSchema validates correct input', () => {
    const result = RequestSchema.safeParse({ query: 'elton john', type: 'artists' })
    expect(result.success).toBe(true)
  })

  it('RequestSchema rejects invalid type', () => {
    const result = RequestSchema.safeParse({ query: 'test', type: 'invalid' })
    expect(result.success).toBe(false)
  })

  it('RequestSchema rejects missing query', () => {
    const result = RequestSchema.safeParse({ type: 'artists' })
    expect(result.success).toBe(false)
  })

  it('AnnounceSchema validates hostname', () => {
    const result = AnnounceSchema.safeParse({ hostname: '192.168.1.1:4545' })
    expect(result.success).toBe(true)
  })

  it('PingSchema validates time field', () => {
    const result = PingSchema.safeParse({ time: Date.now() })
    expect(result.success).toBe(true)
  })

  it('PingSchema rejects non-number time', () => {
    const result = PingSchema.safeParse({ time: 'not-a-number' })
    expect(result.success).toBe(false)
  })

  it('AuthSchema validates complete auth object', () => {
    const account = new Account(generatePrivateKey())
    const sig = account.sign('I am 127.0.0.1:4545')
    const result = AuthSchema.safeParse({
      address: account.address,
      hostname: '127.0.0.1:4545',
      signature: sig.toString(),
      userAgent: 'Hydrabase/test',
      username: 'TestNode'
    })
    expect(result.success).toBe(true)
  })

  it('AuthSchema rejects address without 0x prefix', () => {
    const result = AuthSchema.safeParse({
      address: 'no-prefix',
      hostname: '127.0.0.1:4545',
      signature: 'sig',
      userAgent: 'test',
      username: 'test'
    })
    expect(result.success).toBe(false)
  })
})

describe('WebSocket server handleConnection', () => {
  it('rejects requests missing handshake headers', async () => {
    const result = await handleConnection(server1,
      new globalThis.Request('http://localhost:14545', { headers: { upgrade: 'websocket' } }),
      {
        address: '',
        family: 'IPv4',
        port: 0
      },
      config1,
      ''
    )
    expect(result).toBeDefined()
    expect(result?.res[0]).toBe(400)
    expect(result?.res[1]).toContain('Missing required handshake headers')
  })
})

describe('Peer search integration', () => {
  it('search for non-existent artist returns empty', async () => {
    const peer2 = peerManager1.connectedPeers.find(peer => peer.hostname === `${config2.hostname}:${config2.port}`)
    expect(peer2).toBeDefined()
    if (!peer2) return
    const results = await peer2.search('artists', 'zzz_nonexistent_artist_xyz_12345')
    expect(Array.isArray(results)).toBe(true)
  }, { timeout: 30_000 })

  it('search returns results with valid schema', async () => {
    const peer2 = peerManager1.connectedPeers.find(peer => peer.hostname === `${config2.hostname}:${config2.port}`)
    expect(peer2).toBeDefined()
    if (!peer2) return
    const results = await peer2.search('artists', 'drake')
    expect(Array.isArray(results)).toBe(true)
    for (const result of results) {
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('address')
      expect(result).toHaveProperty('confidence')
    }
  }, { timeout: 30_000 })
})

// TODO: test dht
// TODO: reconnect to a disconnected peer

const mockNode: Config['node'] = {
  hostname: 'server.example.com',
  ip: '203.0.113.10',
  listenAddress: '0.0.0.0',
  port: 4545,
  preferTransport: 'TCP',
  username: 'TestServer'
}

const mockNATClient = {
  hostname: '49.186.30.234',
  ip: '192.168.1.100',
  listenAddress: '0.0.0.0',
  port: 4545,
  preferTransport: 'TCP',
  username: 'NATClient'
} satisfies Config['node']

describe('NAT-friendly authentication', () => {
  it('accepts client with valid signature when reverse auth fails', async () => {
    const clientAccount = new Account(generatePrivateKey())
    const clientAuth = proveClient(clientAccount, mockNATClient, `${mockNode.hostname}:${mockNode.port}`)

    const mockFailedAuthenticator = () =>
      Promise.resolve([500, 'Failed to authenticate server via HTTP: Unable to connect'] as [number, string])

    const result = await verifyClient(mockNode, `${mockNATClient.hostname}:${mockNATClient.port}`, clientAuth, undefined, mockFailedAuthenticator)

    expect(Array.isArray(result)).toBe(false)
    if (!Array.isArray(result)) {
      expect(result.address).toBe(clientAccount.address)
      expect(result.username).toBe(mockNATClient.username)
    }
  })

  it('accepts client when UDP authentication fails', async () => {
    const clientAccount = new Account(generatePrivateKey())
    const clientAuth = proveClient(clientAccount, mockNATClient, `${mockNode.hostname}:${mockNode.port}`)

    const mockFailedAuthenticator = () =>
      Promise.resolve([500, 'Failed to authenticate server via UDP'] as [number, string])

    const result = await verifyClient(mockNode, `${mockNATClient.hostname}:${mockNATClient.port}`, clientAuth, undefined, mockFailedAuthenticator)

    expect(Array.isArray(result)).toBe(false)
    if (!Array.isArray(result)) {
      expect(result.address).toBe(clientAccount.address)
    }
  })

  it('accepts client when fetch fails', async () => {
    const clientAccount = new Account(generatePrivateKey())
    const clientAuth = proveClient(clientAccount, mockNATClient, `${mockNode.hostname}:${mockNode.port}`)

    const mockFailedAuthenticator = () =>
      Promise.resolve([500, 'Failed to fetch server authentication'] as [number, string])

    const result = await verifyClient(mockNode, `${mockNATClient.hostname}:${mockNATClient.port}`, clientAuth, undefined, mockFailedAuthenticator)

    expect(Array.isArray(result)).toBe(false)
  })

  it('accepts client when parse fails (malformed response)', async () => {
    const clientAccount = new Account(generatePrivateKey())
    const clientAuth = proveClient(clientAccount, mockNATClient, `${mockNode.hostname}:${mockNode.port}`)

    const mockFailedAuthenticator = () =>
      Promise.resolve([500, 'Failed to parse server authentication'] as [number, string])

    const result = await verifyClient(mockNode, `${mockNATClient.hostname}:${mockNATClient.port}`, clientAuth, undefined, mockFailedAuthenticator)

    expect(Array.isArray(result)).toBe(false)
  })

  it('rejects client with invalid signature even when reverse auth fails', async () => {
    const clientAccount = new Account(generatePrivateKey())
    const wrongAccount = new Account(generatePrivateKey())
    const clientAuth = proveClient(clientAccount, mockNATClient, `${mockNode.hostname}:${mockNode.port}`)
    
    const wrongSignature = proveClient(wrongAccount, mockNATClient, 'wrong.server:9999')
    clientAuth.signature = wrongSignature.signature

    const mockFailedAuthenticator = () =>
      Promise.resolve([500, 'Failed to authenticate server via HTTP: Unable to connect'] as [number, string])

    const result = await verifyClient(mockNode, `${mockNATClient.hostname}:${mockNATClient.port}`, clientAuth, undefined, mockFailedAuthenticator)

    expect(Array.isArray(result)).toBe(true)
    if (Array.isArray(result)) {
      expect(result[0]).toBe(403)
      expect(result[1]).toContain('Failed to authenticate address')
    }
  })

  it('still performs reverse auth when connectivity succeeds', async () => {
    const clientAccount = new Account(generatePrivateKey())
    const clientAuth = proveClient(clientAccount, mockNATClient, `${mockNode.hostname}:${mockNode.port}`)

    const mockSuccessfulAuthenticator = () =>
      Promise.resolve({
        address: clientAccount.address,
        hostname: `${mockNATClient.hostname}:${mockNATClient.port}` as `${string}:${number}`,
        userAgent: 'Hydrabase/test',
        username: mockNATClient.username
      })

    const result = await verifyClient(mockNode, `${mockNATClient.hostname}:${mockNATClient.port}`, clientAuth, undefined, mockSuccessfulAuthenticator)

    expect(Array.isArray(result)).toBe(false)
    if (!Array.isArray(result)) {
      expect(result.address).toBe(clientAccount.address)
    }
  })

  // it('rejects when reverse auth succeeds but address mismatch', async () => {
  //   const clientAccount = new Account(generatePrivateKey())
  //   const differentAccount = new Account(generatePrivateKey())
  //   const clientAuth = proveClient(clientAccount, mockNATClient, `${mockNode.hostname}:${mockNode.port}`)

  //   const mockMismatchAuthenticator = () =>
  //     Promise.resolve({
  //       address: differentAccount.address,
  //       hostname: `${mockNATClient.hostname}:${mockNATClient.port}` as `${string}:${number}`,
  //       userAgent: 'Hydrabase/test',
  //       username: mockNATClient.username
  //     })

  //   const result = await verifyClient(mockNode, `${mockNATClient.hostname}:${mockNATClient.port}`, clientAuth, undefined, mockMismatchAuthenticator)

  //   expect(Array.isArray(result)).toBe(true)
  //   if (Array.isArray(result)) {
  //     expect(result[0]).toBe(500)
  //     expect(result[1]).toContain('Invalid address')
  //   }
  // })

  // it('rejects non-connection errors during reverse auth', async () => {
  //   const clientAccount = new Account(generatePrivateKey())
  //   const clientAuth = proveClient(clientAccount, mockNATClient, `${mockNode.hostname}:${mockNode.port}`)

  //   const mockAuthenticator = () =>
  //     Promise.resolve([403, 'Invalid signature from server'] as [number, string])

  //   const result = await verifyClient(mockNode, `${mockNATClient.hostname}:${mockNATClient.port}`, clientAuth, undefined, mockAuthenticator)

  //   expect(Array.isArray(result)).toBe(true)
  //   if (Array.isArray(result)) {
  //     expect(result[0]).toBe(403)
  //     expect(result[1]).toContain('Invalid signature')
  //   }
  // })
})


describe('UDP Authentication Edge Cases', () => {
  it('handles authentication cache correctly', () => {

    authenticatedPeers.clear()
    
    const testIdentity = {
      address: '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`,
      hostname: '127.0.0.1:4545' as `${string}:${number}`,
      userAgent: 'Hydrabase/test',
      username: 'TestNode'
    }
    

    authenticatedPeers.set('127.0.0.1:4545', testIdentity)
    const cached = authenticatedPeers.get('127.0.0.1:4545')
    
    expect(cached).toEqual(testIdentity)
  })

  it('validates server proof correctly for UDP', () => {
    const account = new Account(generatePrivateKey())
    const nodeConfig = {
      hostname: 'test.example.com',
      ip: '203.0.113.10',
      listenAddress: '0.0.0.0',
      port: 4545,
      preferTransport: 'TCP' as const,
      username: 'TestNode'
    }
    
    const serverProof = proveServer(account, nodeConfig)
    
    expect(serverProof.address).toBe(account.address)
    expect(serverProof.hostname).toBe(`${nodeConfig.hostname}:${nodeConfig.port}`)
    expect(serverProof.username).toBe(nodeConfig.username)
    
    const isValid = verifyServer(serverProof, `${nodeConfig.hostname}:${nodeConfig.port}`)
    expect(isValid).toBe(true)
  })

  it('detects hostname mismatch in server verification', () => {
    const account = new Account(generatePrivateKey())
    const nodeConfig = {
      hostname: 'test.example.com',
      ip: '203.0.113.10',
      listenAddress: '0.0.0.0',
      port: 4545,
      preferTransport: 'TCP' as const,
      username: 'TestNode'
    }
    
    const serverProof = proveServer(account, nodeConfig)
    

    const isValid = verifyServer(serverProof, 'wrong.example.com:4545')
    expect(Array.isArray(isValid)).toBe(true)
    if (Array.isArray(isValid)) {
      expect(isValid[0]).toBe(500)
      expect(isValid[1]).toContain('Expected')
    }
  })
})

