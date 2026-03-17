import z from "zod"

export const decoder = new TextDecoder()
export const BinaryString = z.instanceof(Uint8Array).transform(m => decoder.decode(m))
export const BinaryHex = z.instanceof(Uint8Array).transform(m => m.toHex())

export const BaseMessage = z.object({
  t: BinaryString.optional(),
})
export const QueryMessage = BaseMessage.extend({
  a: z.object({
    c: BinaryString.optional(),
    d: BinaryString.optional(),
    i: z.number().optional(),
    id: BinaryString,
    n: z.number().optional(),
  }),
  q: BinaryString,
  y: z.literal('q'),
})
export const ResponseMessageSchema = BaseMessage.extend({
  r: z.object({}),
  y: z.literal('r'),
})
export const ErrorMessage = BaseMessage.extend({
  e: z.union([
    z.tuple([z.number(), BinaryString]),
    z.tuple([BinaryString]),
    z.tuple([z.number()]),
  ]),
  y: z.literal('e'),
})

export type Query = z.infer<typeof QueryMessage>
