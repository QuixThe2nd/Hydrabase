import natUpnp from 'nat-upnp'

import type { Config } from '../../types/hydrabase'

import { debug } from '../../utils/log'
import { Trace } from '../../utils/trace'

let upnpClient: null | ReturnType<typeof natUpnp.createClient> = null
let upnpInitError: Error | null = null
const renewalTimers = new Set<Timer>()
const activeMappings = new Set<string>()

const mappingKey = (port: number, protocol: 'TCP' | 'UTP') => `${port}:${protocol}`

const getUpnpClient = (trace?: Trace) => {
  if (upnpClient) return upnpClient
  if (upnpInitError) throw upnpInitError
  try {
    upnpClient = natUpnp.createClient()
    return upnpClient
  } catch (error) {
    upnpInitError = error instanceof Error ? error : new Error(String(error))
    // #region agent log
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    fetch('http://127.0.0.1:7488/ingest/ae9253ff-0376-45a8-b089-19456fa3761b',{body:JSON.stringify({data:{error:upnpInitError.message},hypothesisId:'H7',location:'src/backend/networking/upnp.ts:19',message:'UPnP client init failed',runId:'post-fix',sessionId:'58f352',timestamp:Date.now()}),headers:{'Content-Type':'application/json','X-Debug-Session-Id':'58f352'},method:'POST'}).catch(()=>{})
    // #endregion
    trace?.step(`[UPnP] Client init failed: ${upnpInitError.message}`)
    throw upnpInitError
  }
}

const mapPort = (port: number, description: string, ttl: number, protocol: 'TCP' | 'UTP', trace?: Trace) => new Promise<void>((res, rej) => {
  const upnp = getUpnpClient(trace)
  const timeoutId = setTimeout(() => {
    rej(new Error(`UPnP port mapping timeout after 5s for ${protocol} port ${port}`))
  }, 5000)
  upnp.portMapping({ description, private: port, protocol, public: port, ttl }, err => {
    clearTimeout(timeoutId)
    if (err) rej(err)
    else {
      activeMappings.add(mappingKey(port, protocol))
      trace?.step(`[UPnP] Successfully forwarded ${protocol} port ${port}`)
      if (!trace) debug(`[UPnP] Successfully renewed ${protocol} forwarding on port ${port}`)
      res(undefined)
    }
  })
})

const unmapPort = (port: number, protocol: 'TCP' | 'UTP') => new Promise<void>((res, rej) => {
  const upnp = getUpnpClient()
  const timeoutId = setTimeout(() => {
    rej(new Error(`UPnP port unmapping timeout after 5s for ${protocol} port ${port}`))
  }, 5000)
  upnp.portUnmapping({ protocol, public: port }, err => {
    clearTimeout(timeoutId)
    if (err) {
      rej(err)
      return
    }
    activeMappings.delete(mappingKey(port, protocol))
    res(undefined)
  })
})

const portForward = async (port: number, description: string, announceInterval: number, ttl: number, protocol: 'TCP' | 'UTP', trace: Trace) => {
  await mapPort(port, description, ttl, protocol, trace)
  const timer = setInterval(() => mapPort(port, description, ttl, protocol), announceInterval)
  renewalTimers.add(timer)
}

export const requestPort = async (node: Config['node'], upnp: Config['upnp']) => {
  const trace = Trace.start(`[UPnP] Requesting port ${node.port}`)
  const errors: string[] = []
  try {
    await portForward(node.port, 'Hydrabase (TCP)', upnp.reannounce, upnp.ttl, 'TCP', trace)
  } catch (err) {
    const msg = `TCP: ${(err as Error).message} - Ignore if manually port forwarded`
    errors.push(msg)
  }
  for (let i = 0; i < errors.length; i++) {
    const prefixed = `[UPnP][FAIL] ${errors[i] ?? 'Error not found??'}`
    if (i === errors.length - 1) trace.fail(prefixed)
    else trace.caughtError(prefixed)
  }
  if (errors.length === 0) trace.success()
}

export const releasePortLeases = async () => {
  for (const timer of renewalTimers) clearInterval(timer)
  renewalTimers.clear()

  const trace = Trace.start('[UPnP] Releasing mapped ports')
  const mappings = [...activeMappings.values()]
  if (mappings.length === 0) {
    trace.softFail('No active mappings to release')
    return
  }

  const errors: string[] = []
  for (const mapping of mappings) {
    const [portRaw, protocolRaw] = mapping.split(':')
    const port = Number(portRaw)
    const protocol = protocolRaw as 'TCP' | 'UTP'
    if (!Number.isFinite(port)) continue

    try {
      await unmapPort(port, protocol)
      trace.step(`[UPnP] Released ${protocol} forwarding on port ${port}`)
    } catch (err) {
      errors.push(`${protocol}:${port}: ${(err as Error).message}`)
    }
  }

  if (errors.length > 0) {
    for (let i = 0; i < errors.length; i++) {
      if (i === errors.length - 1) trace.fail(errors[i] ?? 'Unknown UPnP unmap error')
      else trace.caughtError(errors[i] ?? 'Unknown UPnP unmap error')
    }
    return
  }

  trace.success()
}
