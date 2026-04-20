import { keccak256 } from 'js-sha3'

/**
 * Computes the Ethereum personalSign prefix hash of a UTF-8 message.
 * Equivalent to eth_sign / personal_sign hashing used in EIP-191.
 */
export const hashMessage = (message: string): Buffer => {
  const msg = Buffer.from(message)
  return Buffer.from(
    keccak256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`), msg])),
    'hex',
  )
}
