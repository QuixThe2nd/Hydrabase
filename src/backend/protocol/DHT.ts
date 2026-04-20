import z from 'zod'

const decoder = new TextDecoder()
const BinaryString = z.instanceof(Uint8Array).transform(m => decoder.decode(m))

const BaseMessage = z.object({
  t: BinaryString.optional(),
})
export const ResponseMessageSchema = BaseMessage.extend({
  r: z.object({}).loose(),
  y: z.literal('r'),
})
