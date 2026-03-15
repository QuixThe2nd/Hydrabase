import type { Auth, Identity } from "../HIP1/handshake"

import { debug, warn } from "../../../utils/log"

export const upgradeHostname = async (hostname: string, auth: Auth, authenticateHostname: (hostname: `${string}:${number}`) => [number, string] | Promise<[number, string] | Identity>) =>
  hostname === auth.hostname || await new Promise<[number, string] | true>(resolve => {
    debug(`[HIP4] Verifying claimed hostname ${auth.address} ${auth.hostname}`);
    (async () => {
      const identity = await authenticateHostname(auth.hostname)
      if (Array.isArray(identity)) return resolve(identity)
      if (identity.address !== auth.address) {
        warn('DEVWARN:', `[HIP4] Invalid Address - Expected ${auth.address} - Got ${identity.address}`)
        return resolve([500, `Invalid address`])
      }
      return resolve(true)
    })()
  })
