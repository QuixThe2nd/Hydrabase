import type { Config } from '../../../types/hydrabase'
import type { Trace } from '../../../utils/trace'
import type { Account } from '../../Crypto/Account'
import type { UDP_Server } from '../../networking/udp/server'
import type { Auth, Identity } from '../HIP1_Identity'

import { authenticatePeer } from '../../PeerManager'


const authenticateHostname = async (claimedHostname: `${string}:${number}`, claimedAddress: `0x${string}`, preferTransport: 'TCP' | 'UDP', udpServer: UDP_Server, account: Account, trace: Trace, node: Config['node'], identity: Identity, ip: { address: string }): Promise<[number, string] | Identity> => {
  const result = await authenticatePeer(claimedHostname, preferTransport, trace, udpServer, account, node)
  if (!Array.isArray(result)) return result
  const actualIP = ip.address
  const [claimedIP] = claimedHostname.split(':')
  if (actualIP === claimedIP) {
    trace.step(`[WS] [SERVER] NAT detected: same IP (${actualIP}), accepting claimed peer ${claimedAddress} at ${claimedHostname}`)
    return { address: claimedAddress, hostname: claimedHostname, userAgent: identity.userAgent, username: identity.username }
  }
  return result
}

export const upgradeHostname = async (hostname: string, auth: Auth, trace: Trace, preferTransport: 'TCP' | 'UDP', udpServer: UDP_Server, account: Account, node: Config['node'], _identity: Identity, ip: { address: string }) =>
  hostname === auth.hostname || await new Promise<[number, string] | true>(resolve => {
    trace.step(`[HIP4] Verifying claimed hostname ${auth.address} ${auth.hostname}`);
    (async () => {
      const identity = await authenticateHostname(auth.hostname, auth.address, preferTransport, udpServer, account, trace, node, _identity, ip)
      if (Array.isArray(identity)) return resolve(identity)
      if (identity.address !== auth.address) {
        trace.fail(`[HIP4] Invalid Address - Expected ${auth.address} - Got ${identity.address}`)
        return resolve([500, 'Invalid address'])
      }
      return resolve(true)
    })()
  })
