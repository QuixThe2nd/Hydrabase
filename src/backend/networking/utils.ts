export const PEER_PORT_MIN = 4000
export const PEER_PORT_MAX = 5000

export const isPeerLocalHostname = (hostname: string): boolean =>
  hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'

/** Returns true if the peer is allowed (localhost or port in range 4000-5000), false otherwise. */
export const isAllowedPeer = (hostname: string, port: number): boolean =>
  isPeerLocalHostname(hostname) || (port >= PEER_PORT_MIN && port <= PEER_PORT_MAX)
