import natUpnp from 'nat-upnp'

import type { Config } from '../../types/hydrabase';

import { debug, warn } from '../../utils/log';

const upnp = natUpnp.createClient();
const mapPort = (port: number, description: string, ttl: number, protocol: 'TCP' | 'UDP', renew = false) => new Promise((res, rej) => {
  upnp.portMapping({ description, private: port, protocol, public: port, ttl }, err => {
    if (err) rej(err)
    else {
      debug(`[UPnP] Successfully ${renew ? 'renewed' : ''} forwarded ${protocol} port ${port}`)
      res(undefined)
    }
  })
})
const portForward = async (port: number, description: string, announceInterval: number, ttl: number, protocol: 'TCP' | 'UDP' = 'TCP') => {
  await mapPort(port, description, ttl, protocol)
  setInterval(() => mapPort(port, description, ttl, protocol, true), announceInterval)
}

export const requestPort = async (node: Config['node'], upnp: Config['upnp']) => {
  try {
    await portForward(node.port, 'Hydrabase (TCP)', upnp.reannounce, upnp.ttl, 'TCP');
  } catch (err) {
    warn('WARN:', `[UPnP] Failed: ${(err as Error).message} - Ignore if manually port forwarded`)
  }
  try {
    await portForward(node.port, 'Hydrabase (UDP)', upnp.reannounce, upnp.ttl, 'UDP');
  } catch (err) {
    warn('WARN:', `[UPnP] Failed: ${(err as Error).message} - Ignore if manually port forwarded`)
  }
}
