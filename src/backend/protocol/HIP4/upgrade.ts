import type { Trace } from "../../../utils/trace";
import type { Auth, Identity } from "../HIP1/handshake"

export const upgradeHostname = async (hostname: string, auth: Auth, authenticateHostname: (hostname: `${string}:${number}`) => [number, string] | Promise<[number, string] | Identity>, trace?: Trace) =>
  hostname === auth.hostname || await new Promise<[number, string] | true>(resolve => {
    trace.step(`[HIP4] Verifying claimed hostname ${auth.address} ${auth.hostname}`);
    (async () => {
      const identity = await authenticateHostname(auth.hostname)
      if (Array.isArray(identity)) return resolve(identity)
      if (identity.address !== auth.address) {
        trace.fail(`[HIP4] Invalid Address - Expected ${auth.address} - Got ${identity.address}`)
        return resolve([500, `Invalid address`])
      }
      return resolve(true)
    })()
  })
