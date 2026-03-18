import natUpnp from 'nat-upnp'

import type { Config } from '../../types/hydrabase';

import { debug } from '../../utils/log';
import { Trace } from '../../utils/trace';

const upnp = natUpnp.createClient();
const mapPort = (port: number, description: string, ttl: number, protocol: 'TCP' | 'UDP', trace?: Trace) => new Promise((res, rej) => {
  upnp.portMapping({ description, private: port, protocol, public: port, ttl }, err => {
    if (err) rej(err)
    else {
      trace?.step(`[UPnP] Successfully forwarded ${protocol} port ${port}`)
      if (!trace) debug(`[UPnP] Successfully renewed ${protocol} forwarding on port ${port}`)
      res(undefined)
    }
  })
})
const portForward = async (port: number, description: string, announceInterval: number, ttl: number, protocol: 'TCP' | 'UDP', trace: Trace) => {
  await mapPort(port, description, ttl, protocol, trace)
  setInterval(() => mapPort(port, description, ttl, protocol), announceInterval)
}

export const requestPort = async (node: Config['node'], upnp: Config['upnp']) => {
  const trace = Trace.start('[UPnP] Requesting port')
  try {
    await portForward(node.port, 'Hydrabase (TCP)', upnp.reannounce, upnp.ttl, 'TCP', trace)
  } catch (err) {
    trace.caughtError(`${(err as Error).message} - Ignore if manually port forwarded`)
  }
  let lastFailed = false
  try {
    await portForward(node.port, 'Hydrabase (UDP)', upnp.reannounce, upnp.ttl, 'UDP', trace)
  } catch (err) {
    lastFailed = true
    trace.fail(`${(err as Error).message} - Ignore if manually port forwarded`)
  }
  if (!lastFailed) trace.success()
}
