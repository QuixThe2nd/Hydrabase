import bencode from 'bencode'
import dgram from 'dgram'

// Use the same type as in server.ts for compatibility
import type { RPCMessage } from './server'

import { warn } from '../../../utils/log'
export type ResponseAwaiter = (msg: RPCMessage, rinfo: { address: string, port: number }) => boolean

export const handleAwaiter = function handleAwaiter(
  data: RPCMessage,
  peer: dgram.RemoteInfo,
  responseAwaiters: Map<string, ResponseAwaiter>
): boolean {
  const txnId = typeof data['t'] === 'string' ? data['t'] as string : undefined
  const awaiter = txnId ? responseAwaiters.get(txnId) : undefined
  if (awaiter && txnId) {
    const done = awaiter(data, { address: peer.address, port: peer.port })
    if (done) {
      responseAwaiters.delete(txnId)
      return true
    }
  }
  return false
}


export const handleInvalidUsernameError = function handleInvalidUsernameError(error: unknown, peer: dgram.RemoteInfo): boolean {
  if (!error || typeof error !== 'object' || !('message' in error)) return false
  try {
    const errObj = JSON.parse((error as { message: string }).message)
    if (Array.isArray(errObj.err)) {
      for (const e of errObj.err) {
        if (
          e &&
          typeof e === 'object' &&
          'path' in e &&
          Array.isArray(e.path) &&
          e.path.includes('username') &&
          typeof e.message === 'string' &&
          e.message.includes('Username must be 3-20 alphanumeric characters')
        ) {
          warn('DEVWARN:', `received ${peer.address}:${peer.port} invalid username`)
          return true
        }
      }
    }
  } catch {
    // fallback to generic log
  }
  return false
}

export const tryDecodeMessage = function tryDecodeMessage(_msg: Buffer): unknown {
  try {
    return bencode.decode(_msg)
  } catch {
    return undefined
  }
}

export const tryParseError = function tryParseError(error: unknown): unknown {
  if (!error || typeof error !== 'object' || !('message' in error)) return error
  try {
    return JSON.parse((error as { message: string }).message)
  } catch {
    return error
  }
}