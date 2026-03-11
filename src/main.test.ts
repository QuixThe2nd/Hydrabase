import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import z from 'zod'

import type { Peer } from './peer'

import { Account, generatePrivateKey } from './Crypto/Account'
import { Signature } from './Crypto/Signature'
import { startDatabase } from './db'
import MetadataManager from './Metadata'
import ITunes from './Metadata/plugins/iTunes'
import { authenticatedPeers } from './networking/rpc'
import { startServer, type WebSocketData } from './networking/ws/server'
import { Node } from './Node'
import Peers from './Peers'
import { proveServer, verifyServer } from './protocol/HIP1/handshake'
import { type Ping, PingSchema } from './protocol/HIP2/message'
import { type Response, ResponseSchema } from './RequestManager'


const NODE1_PORT = 14545
const NODE2_PORT = 14546

let peers1: Peers
let peers2: Peers
let server1: Bun.Server<WebSocketData>
let server2: Bun.Server<WebSocketData>

beforeAll(async () => {
  authenticatedPeers.clear()
  const { db, repos } = startDatabase()
  const metadataManager = new MetadataManager([new ITunes()], repos)

  // Start Node 1
  Object.assign(process.env, {
    LISTEN_ADDRESS: '127.0.0.1',
    PORT: String(NODE1_PORT),
    USERNAME: 'TestNode1',
  })
  const account1 = new Account(generatePrivateKey())
  const node1 = new Node(metadataManager, () => peers1)
  peers1 = new Peers(account1, metadataManager, repos, db, async (type, query, searchPeers) => node1 ? await node1.search(type, query, searchPeers) : [], `127.0.0.1:${NODE1_PORT}`)
  server1 = startServer(account1, peers1, NODE1_PORT, '127.0.0.1', `127.0.0.1:${NODE1_PORT}`)

  // Start Node 2
  Object.assign(process.env, {
    LISTEN_ADDRESS: '127.0.0.1',
    PORT: String(NODE2_PORT),
    USERNAME: 'TestNode2',
  })
  const account2 = new Account(generatePrivateKey())
  const node2 = new Node(metadataManager, () => peers2)
  peers2 = new Peers(account2, metadataManager, repos, db, async (type, query, searchPeers) => node2 ? await node2.search(type, query, searchPeers) : [], `127.0.0.1:${NODE2_PORT}`)
  server2 = startServer(account2, peers2, NODE2_PORT, '127.0.0.1', `127.0.0.1:${NODE2_PORT}`)

  await new Promise(res => { setTimeout(res, 10_000) })

  return { peers1, peers2, server1, server2 }
})

afterAll(() => {
  server1.stop()
  server2.stop()
})

describe('Signature', () => {
  it('signs and verifies a message round-trip', () => {
    const account = new Account(generatePrivateKey())
    const message = 'I am connecting to 127.0.0.1:4545'
    const sig = account.sign(message)
    expect(sig.verify(message, account.address)).toBe(true)
  })

  it('rejects a signature for the wrong message', () => {
    const account = new Account(generatePrivateKey())
    const sig = account.sign('I am connecting to 127.0.0.1:4545')
    expect(sig.verify('I am connecting to 127.0.0.1:9999', account.address)).toBe(false)
  })

  it('rejects a signature from the wrong keypair', () => {
    const a = new Account(generatePrivateKey())
    const b = new Account(generatePrivateKey())
    const msg = 'I am connecting to 127.0.0.1:4545'
    const sig = a.sign(msg)
    // B's address ≠ a's address → verify should fail
    expect(sig.verify(msg, b.address)).toBe(false)
  })

  it('serialises and deserialises a Signature without data loss', () => {
    const account = new Account(generatePrivateKey())
    const message = 'I am 127.0.0.1:4545'
    const original = account.sign(message)
    const roundTripped = Signature.fromString(original.toString())
    expect(roundTripped.message).toBe(message)
    expect(roundTripped.verify(message, account.address)).toBe(true)
  })
})

describe('HIP1', () => {
  // It('produces client proof that is is verified by server', async () => {
  //   Const account = new Account(generatePrivateKey())
  //   Const clientHostname = '127.0.0.1:4545'
  //   Const serverHostname = '127.0.0.1:4546'
  //   Const auth = proveClient(account, clientHostname, serverHostname)
  //   Expect(await verifyClient(auth, clientHostname)).not.toBeArray()
  // })

  it('produces server proof that is is verified by client', () => {
    const account = new Account(generatePrivateKey())
    const serverHostname = '127.0.0.1:4545'
    expect(verifyServer(proveServer(account, serverHostname), serverHostname)).not.toBeArray()
  })

  it('peer 1 connected to peer 2 over TCP', async () => {
    expect(await peers1.add(peers2.hostname, 'TCP')).toBe(true)
  })

  it('connecting to existing peer should throw', async () => {
    expect(await peers1.add(peers2.hostname, 'TCP')).toBe(false)
  })
  // TODO: test udp

  it('peers are connected to each other', async () => {
    await new Promise(res => { setTimeout(res, 1_000) })
    const server = peers1.connectedPeers.find(peer => peer.hostname === peers2.hostname)
    expect(server).toBeDefined()
    const client = peers2.connectedPeers.find(peer => peer.hostname === peers1.hostname)
    expect(client).toBeDefined()
  })

  // it('peers connected over UDP', async () => {
  //   expect(await peers1.add(peers2.hostname, 'UDP')).toBe(true)
  // })
})

describe('HIP2', () => {
  it('received pong from ping', async () => {
    const peer2 = peers1.connectedPeers.find(peer => peer.hostname === peers2.hostname) as Peer
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
    expect(pong.time).toBeGreaterThan(time)
  })

  it('received response from request', async () => {
    const peer2 = peers1.connectedPeers.find(peer => peer.hostname === peers2.hostname) as Peer
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
    const peer2 = peers1.connectedPeers.find(peer => peer.hostname === peers2.hostname) as Peer
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
    expect(receivedResponse).toBe(true)
  }, { timeout: 30_000 })
})

// TODO: HIP3 - run 3 peers, check that peer connect peer 1 to peers 2 and 3 and check if peer 2 and 3 discover each other
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
