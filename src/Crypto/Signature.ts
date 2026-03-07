import { keccak256 } from 'js-sha3'
import secp256k1 from 'secp256k1'
import SuperJSON from 'superjson'
import z from 'zod'

import { debug } from '../log'
import { Account } from './Account'

export const SignatureSchema = z.object({
  message: z.string().default(''),
  recid: z.number(),
  signature: z.custom<Uint8Array<ArrayBufferLike>>(v => v instanceof Uint8Array)
})
type SignatureObj = z.infer<typeof SignatureSchema>

export class Signature implements SignatureObj {
  public readonly message: string
  public readonly recid: number
  public readonly signature: Uint8Array

  constructor({ message, recid, signature }: SignatureObj) {
    this.signature = signature
    this.recid = recid
    this.message = message
  }
  static readonly fromString = (serialisedSignature: string): Signature => new Signature(SignatureSchema.parse(SuperJSON.parse(serialisedSignature)))

  static sign(message: string, privKey: Uint8Array) {
    debug(`[SIGNATURE] Signing message ${message}`)
    const { recid, signature } = secp256k1.ecdsaSign(Account.hash(message), privKey)
    return new Signature({ message, recid, signature })
  }
  public readonly toString = (): string => SuperJSON.stringify({ message: this.message, recid: this.recid, signature: this.signature } satisfies SignatureObj)

  public readonly verify = (message: string, address: string) => {
    debug(`[SIGNATURE] Verifying message ${message} from ${address}`)
    return `0x${  keccak256(secp256k1.ecdsaRecover(this.signature, this.recid, Account.hash(message), false).slice(1)).slice(-40)}` === address
  }
}
