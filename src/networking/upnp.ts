import natUpnp from 'nat-upnp'
import { CONFIG } from '..';

const upnp = natUpnp.createClient();
const _portForward = (port: number, description: string, protocol: 'TCP' | 'UDP' = 'TCP') => {
  upnp.portMapping({ public: port, private: port, ttl: CONFIG.upnpTTL, protocol, description }, err => { if (err) console.error('ERROR:', "Couldn't automatically port forward with UPnP", `- ${err.stack?.split('\n')[0]}`) })
}
export const portForward = (port: number, description: string, protocol: 'TCP' | 'UDP' = 'TCP') => {
  _portForward(port, description, protocol)
  setInterval(() => _portForward(port, description, protocol), CONFIG.upnpReannounce*1_000)
}