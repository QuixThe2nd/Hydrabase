import z from 'zod'
import crypto from 'crypto'
import { keccak256 } from 'js-sha3'
import secp256k1 from 'secp256k1'

const generatePrivateKey = (): Buffer => {
  const key = crypto.randomBytes(32);
  return secp256k1.privateKeyVerify(key) ? key : generatePrivateKey();
}

export const getPrivateKey = async (offset = 0): Promise<Uint8Array> => {
  const keyFile = Bun.file(`.key${offset}.env`)
  if (await keyFile.exists()) return new Uint8Array(await keyFile.arrayBuffer())
  const privateKey = generatePrivateKey()
  await keyFile.write(privateKey)
  return privateKey
}

export const SignatureSchema = z.object({
  signature: z.instanceof(Uint8Array),
  recid: z.number(),
})

export type Signature = z.infer<typeof SignatureSchema>

export class Crypto {
  public readonly address: `0x${string}`

  constructor(private readonly privKey: Uint8Array) {
    this.address = `0x${keccak256(secp256k1.publicKeyCreate(this.privKey, false).slice(1)).slice(-40)}`
  }

  static hash = (message: string) => {
    const msg = Buffer.from(message)
    return Buffer.from(keccak256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`), msg])), 'hex')
  }
  static verify = (message: string, sig: Signature, address: string) => '0x' + keccak256(secp256k1.ecdsaRecover(sig.signature, sig.recid, this.hash(message), false).slice(1)).slice(-40) === address

  public readonly sign = (message: string) => secp256k1.ecdsaSign(Crypto.hash(message), this.privKey)
}
