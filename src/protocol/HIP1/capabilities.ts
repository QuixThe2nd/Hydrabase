import z from 'zod'
import type { Peer } from '../../networking/ws/peer'

export const CapabilitySchema = z.object({
  userAgent: z.string(),
  hips: z.record(z.coerce.number(), z.number()),
  plugins: z.array(z.string()),
})
export type Capability = z.infer<typeof CapabilitySchema>

const IMPLEMENTED_HIPS: Record<number, number> = {
  1: 1, // HIP1 — Capability exchange
  2: 1, // HIP2 — Message schema
  3: 1, // HIP3 — Authentication
  4: 1, // HIP4 — Gossip / peer announcement
}

export class HIP1_Conn_Capabilities {
  constructor(private readonly peer: Peer) {}

  get capabilities(): Capability {
    return {
      userAgent: `Hydrabase/${Bun.file('VERSION').toString().trim() ?? 'unknown'}`,
      hips: IMPLEMENTED_HIPS,
      plugins: this.peer.plugins.map(({id}) => id),
    }
  }

  static validateCapability(raw: unknown): CapabilityValidationResult {
    const parsed = CapabilitySchema.safeParse(raw)
    if (!parsed.success) return { ok: false, reason: 'parse_failed' }
    const hip1Version = parsed.data.hips[1]
    if (hip1Version === undefined) return { ok: false, reason: 'missing_hip1' }
    if (hip1Version < IMPLEMENTED_HIPS[1]!) return { ok: false, reason: 'hip1_version_too_low' }
    return { ok: true, capability: parsed.data }
  }
}

type CapabilityRejectionReason = 'parse_failed' | 'missing_hip1' | 'hip1_version_too_low'
type CapabilityValidationResult = { ok: true; capability: Capability } | { ok: false; reason: CapabilityRejectionReason }

const peerSupportsHip = (capability: Capability, hip: number, minVersion: number = 1): boolean => {
  const version = capability.hips[hip]
  return version !== undefined && version >= minVersion
}
const peerHasPlugin = (capability: Capability, pluginId: string): boolean => capability.plugins.includes(pluginId)
// TODO: actually use negotiated capabilities
