import { error } from '../../utils/log'

export const PEER_PORT_MIN = 4000
export const PEER_PORT_MAX = 5000

export const isPeerLocalHostname = (hostname: string): boolean =>
  hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'

/** Returns true if the peer is allowed (localhost or port in range 4000-5000), false otherwise. */
export const isAllowedPeer = (hostname: string, port: number): boolean =>
  isPeerLocalHostname(hostname) || (port >= PEER_PORT_MIN && port <= PEER_PORT_MAX)

const ipServers = ['https://icanhazip.com', 'https://api.ipify.org']
export const getIp = () => new Promise<string>(resolve => {
  (async () => {
    for (const ipServer of ipServers) {
      try {
        const response = await fetch(ipServer)
        resolve((await response.text()).trim())
      } catch(e) {
        error('ERROR:', `[IP] Failed to fetch external IP from ${ipServer}`, {e})
      }
    }
  })()
})
