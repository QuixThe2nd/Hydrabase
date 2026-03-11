import natUpnp from 'nat-upnp'

import { debug } from '../../utils/log';
import { CONFIG } from '../config'

const upnp = natUpnp.createClient();
const mapPort = (port: number, description: string, protocol: 'TCP' | 'UDP' = 'TCP') => new Promise((res, rej) => {
  upnp.portMapping({ description, private: port, protocol, public: port, ttl: CONFIG.upnpTTL }, err => {
    if (err) rej(err)
    else {
      debug(`[UPnP] Successfully forwarded ${protocol} port ${port}`)
      res(undefined)
    }
  })
})
export const portForward = async (port: number, description: string, protocol: 'TCP' | 'UDP' = 'TCP') => {
  await mapPort(port, description, protocol)
  setInterval(() => mapPort(port, description, protocol), CONFIG.upnpReannounce*1_000)
}
