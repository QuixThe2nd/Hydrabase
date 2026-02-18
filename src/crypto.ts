import z from 'zod'
import crypto from 'crypto'
import { keccak256 } from 'js-sha3'
import secp256k1 from 'secp256k1'
import SuperJSON from 'superjson'

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
  signature: z.custom<Uint8Array<ArrayBufferLike>>(v => v instanceof Uint8Array),
  recid: z.number()
})

export class Signature implements z.infer<typeof SignatureSchema> {
  public readonly signature: Uint8Array
  public readonly recid: number

  constructor({ signature, recid }: { signature: Uint8Array, recid: number }) {
    this.signature = signature
    this.recid = recid
  }
  static sign(message: string, privKey: Uint8Array) {
    const { signature, recid } = secp256k1.ecdsaSign(Crypto.hash(message), privKey)
    return new Signature({ signature, recid })
  }

  static readonly fromString = (serialisedSignature: string): Signature => new Signature(SignatureSchema.parse(SuperJSON.parse(serialisedSignature)))

  verify = (message: string, address: string) => '0x' + keccak256(secp256k1.ecdsaRecover(this.signature, this.recid, Crypto.hash(message), false).slice(1)).slice(-40) === address
}

export class Crypto {
  public readonly address: `0x${string}`

  constructor(private readonly privKey: Uint8Array) {
    this.address = `0x${keccak256(secp256k1.publicKeyCreate(this.privKey, false).slice(1)).slice(-40)}`
  }

  static hash = (message: string) => {
    const msg = Buffer.from(message)
    return Buffer.from(keccak256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`), msg])), 'hex')
  }

  public readonly sign = (message: string) => Signature.sign(message, this.privKey)
}
