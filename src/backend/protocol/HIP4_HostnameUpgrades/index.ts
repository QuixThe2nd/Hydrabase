import type { Trace } from '../../../utils/trace'
import type { Auth, Identity } from '../HIP1_Identity'

import { authenticatePeer } from '../../PeerManager'


const authenticateHostname = async (claimedHostname: `${string}:${number}`, claimedAddress: `0x${string}`, preferTransport: 'TCP' | 'UTP', trace: Trace, identity: Identity, ip: { address: string }): Promise<[number, string] | Identity> => {
  const result = await authenticatePeer(claimedHostname, preferTransport, trace)
  if (!Array.isArray(result)) return result
  const actualIP = ip.address
  const [claimedIP] = claimedHostname.split(':')
  if (actualIP === claimedIP) {
    trace.step(`[WS] [SERVER] NAT detected: same IP (${actualIP}), accepting claimed peer ${claimedAddress} at ${claimedHostname}`)
    return { address: claimedAddress, hostname: claimedHostname, userAgent: identity.userAgent, username: identity.username }
  }
  return result
}

export const upgradeHostname = async (hostname: string, auth: Auth, trace: Trace, preferTransport: 'TCP' | 'UTP', _identity: Identity, ip: { address: string }) =>
  hostname === auth.hostname || await new Promise<[number, string] | true>(resolve => {
    trace.step(`[HIP4] Verifying claimed hostname ${auth.address} ${auth.hostname}`);
    (async () => {
      const identity = await authenticateHostname(auth.hostname, auth.address, preferTransport, trace, _identity, ip)
      if (Array.isArray(identity)) return resolve(identity)
      if (identity.address !== auth.address) {
        trace.fail(`[HIP4] Invalid Address - Expected ${auth.address} - Got ${identity.address}`)
        return resolve([500, 'Invalid address'])
      }
      return resolve(true)
    })()
  })
