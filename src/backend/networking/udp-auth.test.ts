/* eslint-disable max-lines, max-lines-per-function */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import type { Config } from '../../types/hydrabase'

import { Account, generatePrivateKey } from '../Crypto/Account'
import { startDatabase } from '../db'
import MetadataManager from '../Metadata'
import ITunes from '../Metadata/plugins/iTunes'
import { startRPC, authenticatedPeers, authenticateServerUDP, RPC } from './rpc'
import PeerManager from '../PeerManager'
import { proveServer, verifyServer } from '../protocol/HIP1/handshake'

const config1 = {
  hostname: '127.0.0.1',
  ip: '127.0.0.1',
  listenAddress: '127.0.0.1',
  port: 14547,
  preferTransport: 'UDP',
  username: 'TestNode1'
} satisfies Config['node']

const config2 = {
  hostname: '127.0.0.1', 
  ip: '127.0.0.1',
  listenAddress: '127.0.0.1',
  port: 14548,
  preferTransport: 'UDP',
  username: 'TestNode2'
} satisfies Config['node']

const dhtConfig = {
  bootstrapNodes: '',
  reannounce: 24*60*60*1_000,
  requireConnection: true,
  roomSeed: 'hydrabase_test_udp',
  rpcPrefix: 'hydra_test_udp',
} satisfies Config['dht']

const formulas = {
  finalConfidence: '0.5',
  pluginConfidence: '0.5'
} satisfies Config['formulas']

let account1: Account
let account2: Account
let peerManager1: PeerManager
let peerManager2: PeerManager
let rpc1: RPC
let rpc2: RPC

beforeAll(async () => {
  // Clear any existing auth cache
  authenticatedPeers.clear()
  
  // Setup test data
  const repos = startDatabase(formulas.pluginConfidence)
  const metadataManager = new MetadataManager([new ITunes()], repos, 32)
  
  // Create test accounts
  account1 = new Account(generatePrivateKey())
  account2 = new Account(generatePrivateKey())
  
  // Create peer managers
  peerManager1 = new PeerManager(account1, metadataManager, repos, async () => [], config1, dhtConfig, false)
  peerManager2 = new PeerManager(account2, metadataManager, repos, async () => [], config2, dhtConfig, false)
  
  // Start RPC nodes
  const result1 = startRPC(peerManager1, config1, dhtConfig, false)
  const result2 = startRPC(peerManager2, config2, dhtConfig, false)
  peerManager1.rpc = result1.rpc
  peerManager2.rpc = result2.rpc
  
  // Bind to ports
  peerManager1.rpc.bind(config1.port)
  peerManager2.rpc.bind(config2.port)
  
  // Wait for DHT to settle
  await new Promise(res => setTimeout(res, 2_000))
}, { timeout: 10_000 })

afterAll(() => {
  peerManager1.rpc?.destroy()
  peerManager2.rpc?.destroy()
  authenticatedPeers.clear()
})

describe('UDP Authentication', () => {
  describe('authenticateServerUDP function', () => {
    it('successfully authenticates a valid server', async () => {
      const authFn = authenticateServerUDP(peerManager1.rpc, dhtConfig)
      
      const result = await authFn(`${config2.hostname}:${config2.port}`)
      
      expect(Array.isArray(result)).toBe(false)
      if (!Array.isArray(result)) {
        expect(result.address).toBe(account2.address)
        expect(result.hostname).toBe(`${config2.hostname}:${config2.port}`)
        expect(result.username).toBe(config2.username)
      }
    }, { timeout: 10_000 })

    it('returns cached result on second call', async () => {
      const authFn = authenticateServerUDP(peerManager1.rpc, dhtConfig)
      
      // First call should work and cache result
      const result1 = await authFn(`${config2.hostname}:${config2.port}`)
      expect(Array.isArray(result1)).toBe(false)
      
      // Second call should return cached result immediately 
      const result2 = await authFn(`${config2.hostname}:${config2.port}`)
      expect(result2).toBe(result1)
    }, { timeout: 5_000 })

    it('returns error for non-existent server', async () => {
      const authFn = authenticateServerUDP(peerManager1.rpc, dhtConfig)
      
      const result = await authFn('127.0.0.1:9999')
      
      expect(Array.isArray(result)).toBe(true)
      if (Array.isArray(result)) {
        expect(result[0]).toBe(500)
        expect(result[1]).toContain('Failed to authenticate')
      }
    }, { timeout: 10_000 })
  })

  describe('RPC connection establishment', () => {
    it('creates outbound RPC connection with authentication', async () => {
      // First get the server identity
      const authFn = authenticateServerUDP(peerManager1.rpc, dhtConfig)
      const identity = await authFn(`${config2.hostname}:${config2.port}`)
      
      expect(Array.isArray(identity)).toBe(false)
      if (!Array.isArray(identity)) {
        // Now create outbound connection
        const rpcConnection = await RPC.fromOutbound(identity, peerManager1, dhtConfig, config1)
        expect(rpcConnection).toBeDefined()
        
        if (rpcConnection) {
          expect(rpcConnection.isOpened).toBe(true)
          expect(rpcConnection.peer.address).toBe(account2.address)
          rpcConnection.close()
        }
      }
    }, { timeout: 10_000 })

    it('handles connection failure gracefully', async () => {
      const fakeIdentity = {
        address: '0x1234567890123456789012345678901234567890' as `0x${string}`,
        hostname: '192.168.99.99:9999' as `${string}:${number}`,
        signature: 'fake-sig',
        userAgent: 'test',
        username: 'fake'
      }
      
      const rpcConnection = await RPC.fromOutbound(fakeIdentity, peerManager1, dhtConfig, config1)
      expect(rpcConnection).toBe(false)
    }, { timeout: 10_000 })
  })

  describe('Server identity verification', () => {
    it('validates server proof correctly', () => {
      const serverProof = proveServer(account2, config2)
      const result = verifyServer(serverProof, `${config2.hostname}:${config2.port}`)
      
      expect(result).toBe(true)
    })

    it('rejects proof with wrong hostname', () => {
      const serverProof = proveServer(account2, config2)
      const result = verifyServer(serverProof, 'wrong.host:9999')
      
      expect(Array.isArray(result)).toBe(true)
      if (Array.isArray(result)) {
        expect(result[0]).toBe(500)
        expect(result[1]).toContain('Expected')
      }
    })

    it('detects tampered signatures', () => {
      const serverProof = proveServer(account2, config2)
      serverProof.signature = 'tampered'
      
      expect(() => {
        verifyServer(serverProof, `${config2.hostname}:${config2.port}`)
      }).toThrow()
    })
  })

  describe('UDP transport edge cases', () => {
    it('handles authentication failures gracefully', async () => {
      // Try to authenticate a non-existent server
      const authFn = authenticateServerUDP(peerManager1.rpc, dhtConfig)
      const result = await authFn('192.168.99.99:4545')
      
      expect(Array.isArray(result)).toBe(true)
      if (Array.isArray(result)) {
        expect(result[0]).toBe(500)
        expect(result[1]).toContain('Failed to authenticate')
      }
    }, { timeout: 10_000 })
  })

  describe('Authentication cache behavior', () => {
    it('shares cache between different auth functions', async () => {
      // First auth call populates cache
      const authFn1 = authenticateServerUDP(peerManager1.rpc, dhtConfig)
      const result1 = await authFn1(`${config2.hostname}:${config2.port}`)
      
      // Second auth function should use same cache
      const authFn2 = authenticateServerUDP(peerManager2.rpc, dhtConfig) 
      const result2 = await authFn2(`${config2.hostname}:${config2.port}`)
      
      expect(result1).toBe(result2)
    }, { timeout: 5_000 })

    it('cache persists across function calls', async () => {
      const hostname = `${config2.hostname}:${config2.port}`
      
      // Verify cache is populated
      expect(authenticatedPeers.has(hostname)).toBe(true)
      const cached = authenticatedPeers.get(hostname)
      
      // New auth function should use cached result
      const authFn = authenticateServerUDP(peerManager1.rpc, dhtConfig)
      const result = await authFn(hostname)
      expect(result).toBe(cached)
    }, { timeout: 5_000 })
  })

  describe('Integration with peer connections', () => {
    it('RPC connection can be added to peer manager', async () => {
      // Clear existing connections
      peerManager1.peers.clear()
      
      // Get server identity via UDP auth
      const authFn = authenticateServerUDP(peerManager1.rpc, dhtConfig)
      const identity = await authFn(`${config2.hostname}:${config2.port}`)
      
      expect(Array.isArray(identity)).toBe(false)
      if (!Array.isArray(identity)) {
        // Create RPC connection
        const rpcPeer = await RPC.fromOutbound(identity, peerManager1, dhtConfig, config1)
        expect(rpcPeer).toBeDefined()
        
        if (rpcPeer) {
          // Add to peer manager 
          const added = await peerManager1.add(rpcPeer)
          expect(added).toBe(true)
          expect(peerManager1.peers.size).toBeGreaterThan(0)
          
          rpcPeer.close()
        }
      }
    }, { timeout: 10_000 })
  })
})