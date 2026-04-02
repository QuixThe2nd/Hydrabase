import { error } from '../../utils/log'

export const PEER_PORT_MIN = 4000
export const PEER_PORT_MAX = 5000

export const isPeerLocalHostname = (hostname: string): boolean =>
  hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'

/** Returns true if the peer is allowed (localhost or port in range 4000-5000), false otherwise. */
export const isAllowedPeer = (hostname: string, port: number): boolean =>
  isPeerLocalHostname(hostname) || (port >= PEER_PORT_MIN && port <= PEER_PORT_MAX)

const ipServers = ['https://icanhazip.com', 'https://api.ipify.org']
const IP_FETCH_TIMEOUT_MS = 3_000

const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

export const getIp = async (): Promise<string> => {
  let lastError: unknown
  for (const ipServer of ipServers) {
    try {
      const response = await fetchWithTimeout(ipServer, IP_FETCH_TIMEOUT_MS)
      if (!response.ok) throw new Error(`Received HTTP ${response.status} from ${ipServer}`)
      const ip = (await response.text()).trim()
      if (!ip) throw new Error(`Received empty response from ${ipServer}`)
      return ip
    } catch (e) {
      lastError = e
      error('ERROR:', `[IP] Failed to fetch external IP from ${ipServer}`, { e })
    }
  }
  // #region agent log
  fetch('http://127.0.0.1:7488/ingest/ae9253ff-0376-45a8-b089-19456fa3761b',{body:JSON.stringify({data:{fallbackIp:'127.0.0.1',lastError:lastError instanceof Error ? lastError.message : String(lastError)},hypothesisId:'H8',location:'src/backend/networking/utils.ts:40',message:'External IP lookup failed, using loopback fallback',runId:'post-fix',sessionId:'59157e',timestamp:Date.now()}),headers:{'Content-Type':'application/json','X-Debug-Session-Id':'59157e'},method:'POST'}).catch(() => undefined)
  // #endregion
  return '127.0.0.1'
}
