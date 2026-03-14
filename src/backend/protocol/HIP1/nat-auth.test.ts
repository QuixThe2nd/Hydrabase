import { describe, expect, it } from 'bun:test'

import type { Config } from '../../../types/hydrabase'

import { Account, generatePrivateKey } from '../../Crypto/Account'
import { proveClient, verifyClient } from './handshake'

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

    const mockFailedAuthenticator = async (_hostname: `${string}:${number}`) => {
      return [500, 'Failed to authenticate server via HTTP: Unable to connect'] as [number, string]
    }

    const result = await verifyClient(mockNode, clientAuth, false, mockFailedAuthenticator)

    expect(Array.isArray(result)).toBe(false)
    if (!Array.isArray(result)) {
      expect(result.address).toBe(clientAccount.address)
      expect(result.username).toBe(mockNATClient.username)
    }
  })

  it('accepts client when UDP authentication fails', async () => {
    const clientAccount = new Account(generatePrivateKey())
    const clientAuth = proveClient(clientAccount, mockNATClient, `${mockNode.hostname}:${mockNode.port}`)

    const mockFailedAuthenticator = async (_hostname: `${string}:${number}`) => {
      return [500, 'Failed to authenticate server via UDP'] as [number, string]
    }

    const result = await verifyClient(mockNode, clientAuth, false, mockFailedAuthenticator)

    expect(Array.isArray(result)).toBe(false)
    if (!Array.isArray(result)) {
      expect(result.address).toBe(clientAccount.address)
    }
  })

  it('accepts client when fetch fails', async () => {
    const clientAccount = new Account(generatePrivateKey())
    const clientAuth = proveClient(clientAccount, mockNATClient, `${mockNode.hostname}:${mockNode.port}`)

    const mockFailedAuthenticator = async (_hostname: `${string}:${number}`) => {
      return [500, 'Failed to fetch server authentication'] as [number, string]
    }

    const result = await verifyClient(mockNode, clientAuth, false, mockFailedAuthenticator)

    expect(Array.isArray(result)).toBe(false)
  })

  it('accepts client when parse fails (malformed response)', async () => {
    const clientAccount = new Account(generatePrivateKey())
    const clientAuth = proveClient(clientAccount, mockNATClient, `${mockNode.hostname}:${mockNode.port}`)

    const mockFailedAuthenticator = async (_hostname: `${string}:${number}`) => {
      return [500, 'Failed to parse server authentication'] as [number, string]
    }

    const result = await verifyClient(mockNode, clientAuth, false, mockFailedAuthenticator)

    expect(Array.isArray(result)).toBe(false)
  })

  it('rejects client with invalid signature even when reverse auth fails', async () => {
    const clientAccount = new Account(generatePrivateKey())
    const wrongAccount = new Account(generatePrivateKey())
    const clientAuth = proveClient(clientAccount, mockNATClient, `${mockNode.hostname}:${mockNode.port}`)
    
    const wrongSignature = proveClient(wrongAccount, mockNATClient, 'wrong.server:9999')
    clientAuth.signature = wrongSignature.signature

    const mockFailedAuthenticator = async (_hostname: `${string}:${number}`) => {
      return [500, 'Failed to authenticate server via HTTP: Unable to connect'] as [number, string]
    }

    const result = await verifyClient(mockNode, clientAuth, false, mockFailedAuthenticator)

    expect(Array.isArray(result)).toBe(true)
    if (Array.isArray(result)) {
      expect(result[0]).toBe(403)
      expect(result[1]).toContain('Failed to authenticate address')
    }
  })

  it('still performs reverse auth when connectivity succeeds', async () => {
    const clientAccount = new Account(generatePrivateKey())
    const clientAuth = proveClient(clientAccount, mockNATClient, `${mockNode.hostname}:${mockNode.port}`)

    const mockSuccessfulAuthenticator = async (_hostname: `${string}:${number}`) => {
      return {
        address: clientAccount.address,
        hostname: `${mockNATClient.hostname}:${mockNATClient.port}` as `${string}:${number}`,
        userAgent: 'Hydrabase/test',
        username: mockNATClient.username
      }
    }

    const result = await verifyClient(mockNode, clientAuth, false, mockSuccessfulAuthenticator)

    expect(Array.isArray(result)).toBe(false)
    if (!Array.isArray(result)) {
      expect(result.address).toBe(clientAccount.address)
    }
  })

  it('rejects when reverse auth succeeds but address mismatch', async () => {
    const clientAccount = new Account(generatePrivateKey())
    const differentAccount = new Account(generatePrivateKey())
    const clientAuth = proveClient(clientAccount, mockNATClient, `${mockNode.hostname}:${mockNode.port}`)

    const mockMismatchAuthenticator = async (_hostname: `${string}:${number}`) => {
      return {
        address: differentAccount.address,
        hostname: `${mockNATClient.hostname}:${mockNATClient.port}` as `${string}:${number}`,
        userAgent: 'Hydrabase/test',
        username: mockNATClient.username
      }
    }

    const result = await verifyClient(mockNode, clientAuth, false, mockMismatchAuthenticator)

    expect(Array.isArray(result)).toBe(true)
    if (Array.isArray(result)) {
      expect(result[0]).toBe(500)
      expect(result[1]).toContain('Invalid address')
    }
  })

  it('rejects non-connection errors during reverse auth', async () => {
    const clientAccount = new Account(generatePrivateKey())
    const clientAuth = proveClient(clientAccount, mockNATClient, `${mockNode.hostname}:${mockNode.port}`)

    const mockAuthenticator = async (_hostname: `${string}:${number}`) => {
      return [403, 'Invalid signature from server'] as [number, string]
    }

    const result = await verifyClient(mockNode, clientAuth, false, mockAuthenticator)

    expect(Array.isArray(result)).toBe(true)
    if (Array.isArray(result)) {
      expect(result[0]).toBe(403)
      expect(result[1]).toContain('Invalid signature')
    }
  })
})
