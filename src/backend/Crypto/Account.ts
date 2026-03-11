import crypto from 'crypto'
import { keccak256 } from "js-sha3"
import secp256k1 from 'secp256k1'

import { log } from '../../utils/log'
import { Signature } from "./Signature"

export const generatePrivateKey = (): Buffer => {
  const key = crypto.randomBytes(32);
  return secp256k1.privateKeyVerify(key) ? key : generatePrivateKey();
}

export const getPrivateKey = async (): Promise<Uint8Array> => {
  const keyFile = Bun.file(`data/.key.env`)
  if (await keyFile.exists()) return new Uint8Array(await keyFile.arrayBuffer())
  log(`[CRYPTO] Generating new private key`)
  const privateKey = generatePrivateKey()
  await keyFile.write(privateKey)
  return privateKey
}

export class Account {
  public readonly address: `0x${string}`

  constructor(private readonly privKey: Uint8Array) {
    this.address = `0x${keccak256(secp256k1.publicKeyCreate(this.privKey, false).slice(1)).slice(-40)}`
  }

  static readonly hash = (message: string) => {
    const msg = Buffer.from(message)
    return Buffer.from(keccak256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`), msg])), 'hex')
  }

  public readonly sign = (message: string) => Signature.sign(message, this.privKey)
}
