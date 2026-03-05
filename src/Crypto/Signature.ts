import { keccak256 } from 'js-sha3'
import secp256k1 from 'secp256k1'
import SuperJSON from 'superjson'
import z from 'zod'

import { Account } from './Account'


export const SignatureSchema = z.object({
  recid: z.number(),
  signature: z.custom<Uint8Array<ArrayBufferLike>>(v => v instanceof Uint8Array)
})

export class Signature implements z.infer<typeof SignatureSchema> {
  public readonly recid: number
  public readonly signature: Uint8Array

  constructor({ recid, signature }: { recid: number; signature: Uint8Array, }) {
    this.signature = signature
    this.recid = recid
  }
  static readonly fromString = (serialisedSignature: string): Signature => new Signature(SignatureSchema.parse(SuperJSON.parse(serialisedSignature)))

  static sign(message: string, privKey: Uint8Array) {
    console.log('Verify:', message)
    const { recid, signature } = secp256k1.ecdsaSign(Account.hash(message), privKey)
    return new Signature({ recid, signature })
  }
  public readonly toString = (): string => SuperJSON.stringify({ recid: this.recid, signature: this.signature })

  verify = (message: string, address: string) => {
    console.log('Verify:', message, address)
    return `0x${  keccak256(secp256k1.ecdsaRecover(this.signature, this.recid, Account.hash(message), false).slice(1)).slice(-40)}` === address
  }
}
