/* eslint-disable max-lines-per-function */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import z from 'zod'

import type { Config, WebSocketData } from '../types/hydrabase'
import type { Peer } from './peer'

import { type Response, ResponseSchema } from '../types/hydrabase-schemas'
import { Account, generatePrivateKey } from './Crypto/Account'
import { Signature } from './Crypto/Signature'
import { startDatabase } from './db'
import MetadataManager from './Metadata'
import ITunes from './Metadata/plugins/iTunes'
import { startServer } from './networking/http'
import { authenticatedPeers } from './networking/rpc'
import { Node } from './Node'
import PeerManager from './PeerManager'
import { proveClient, proveServer, verifyClient, verifyServer } from './protocol/HIP1/handshake'
import { type Ping, PingSchema } from './protocol/HIP2/message'

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

const dhtConfig = {
  bootstrapNodes: '',
  reannounce: 24*60*60*1_000,
  requireConnection: true,
  roomSeed: 'hydrabase_test',
  rpcPrefix: 'hydra_test',
} satisfies Config['dht']

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
  peerManager1 = new PeerManager(account1, metadataManager, repos, async (type, query, searchPeers) => node1 ? await node1.search(type, query, searchPeers) : [], config1, dhtConfig, false)
  server1 = startServer(account1, peerManager1, config1, '')

  // Start Node 2
  const account2 = new Account(generatePrivateKey())
  const node2 = new Node(metadataManager, () => peerManager2, formulas)
  peerManager2 = new PeerManager(account2, metadataManager, repos, async (type, query, searchPeers) => node2 ? await node2.search(type, query, searchPeers) : [], config2, dhtConfig, false)
  server2 = startServer(account2, peerManager2, config2, '')

  // Start Node 3
  const account3 = new Account(generatePrivateKey())
  const node3 = new Node(metadataManager, () => peerManager3, formulas)
  peerManager3 = new PeerManager(account3, metadataManager, repos, async (type, query, searchPeers) => node3 ? await node3.search(type, query, searchPeers) : [], config3, dhtConfig, false)
  server3 = startServer(account3, peerManager3, config3, '')

  await new Promise(res => { setTimeout(res, 5_000) })

  return { peers1: peerManager1, peers2: peerManager2, server1, server2 }
}, {
  timeout: 15_000
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
    expect(await verifyClient(config2, auth, '')).not.toBeArray()
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

  it('peer 2 connected to peer 3 over TCP', async () => { // TODO: switch to UDP
    expect(await peerManager2.add(`${config3.hostname}:${config3.port}`, 'TCP')).toBe(true)
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
// TODO: test dht
// TODO: reconnect to a disconnected peer

// describe('MockSocket — pairing sanity checks', () => {
//   it('fires close handlers on both sides', async () => {
//     const [aliceSocket, bobSocket] = MockSocket.pair(ALICE, BOB)
//     aliceSocket.open()

//     let aliceClosed = false
//     let bobClosed = false
//     aliceSocket.onClose(() => { aliceClosed = true })
//     bobSocket.onClose(() => { bobClosed = true })

//     aliceSocket.close()
//     expect(aliceClosed).toBe(true)
//     expect(bobClosed).toBe(true)
//   })

//   it('throws if you send on a closed socket', () => {
//     const [aliceSocket] = MockSocket.pair(ALICE, BOB)
//     // Never opened → isOpened = false
//     expect(() => aliceSocket.send('nope')).toThrow()
//   })
// })
