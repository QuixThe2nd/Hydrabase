import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import type { Peer } from './peer'

import { Account, generatePrivateKey } from './Crypto/Account'
import { Signature } from './Crypto/Signature'
import { startDatabase } from './db'
import MetadataManager from './Metadata'
import { startServer, type WebSocketData } from './networking/ws/server'
import { Node } from './Node'
import Peers from './Peers'
import { proveServer, verifyServer } from './protocol/HIP1/handshake'


const NODE1_PORT = 14545
const NODE2_PORT = 14546

let peers1: Peers
let peers2: Peers
let server1: Bun.Server<WebSocketData>
let server2: Bun.Server<WebSocketData>

beforeAll(async () => {
  const { db, repos } = startDatabase()
  const metadataManager = new MetadataManager([], repos)

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
  // TODO: test udp

  it('peers are connected to each other', () => {
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
    peer2.socket.onMessage(msg => {
      console.log('bbbbb', msg)
    })
    peer2.send({ nonce: 3, ping: { time: Number(new Date()) } })
    await new Promise(res => { setTimeout(res, 60_000) })
    // TODO: assert pong received
  }, { timeout: 61_000 })

  // TODO: Request/response

  /*
  it('handles multiple in-flight requests by nonce', async () => {
    const peer2 = peers1.connectedPeers.find(peer => peer.hostname === peers2.hostname) as Peer
    expect(peer2).toBeDefined()

    bobSocket.onMessage(raw => {
      const msg = JSON.parse(raw)
      if (msg.request) {
        // Simulate async delay between responses
        setTimeout(() => bobSocket.send(JSON.stringify({ nonce: msg.nonce, response: [`result for ${msg.nonce}`] })), Math.random() * 20)
      }
    })

    const results: Record<number, string> = {}
    aliceSocket.onMessage(raw => {
      const msg = JSON.parse(raw) as { nonce: number; response: string[] }
      results[msg.nonce] = msg.response[0]!
    })

    aliceSocket.send(JSON.stringify({ nonce: 1, request: { query: 'a', type: 'artists' } }))
    aliceSocket.send(JSON.stringify({ nonce: 2, request: { query: 'b', type: 'artists' } }))
    aliceSocket.send(JSON.stringify({ nonce: 3, request: { query: 'c', type: 'artists' } }))

    await new Promise(r => setTimeout(r, 100))
    expect(results[1]).toBe('result for 1')
    expect(results[2]).toBe('result for 2')
    expect(results[3]).toBe('result for 3')
  })
  */
})

// TODO: HIP3

// describe('MockSocket — pairing sanity checks', () => {
//   it('delivers messages from A to B', async () => {
//     const [aliceSocket, bobSocket] = MockSocket.pair(ALICE, BOB)
//     aliceSocket.open()

//     const received: string[] = []
//     bobSocket.onMessage(msg => received.push(msg))

//     aliceSocket.send('hello from alice')
//     await tick()
//     expect(received).toContain('hello from alice')
//   })

//   it('delivers messages from B to A', async () => {
//     const [aliceSocket, bobSocket] = MockSocket.pair(ALICE, BOB)
//     aliceSocket.open()

//     const received: string[] = []
//     aliceSocket.onMessage(msg => received.push(msg))

//     bobSocket.send('hello from bob')
//     await tick()
//     expect(received).toContain('hello from bob')
//   })

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
