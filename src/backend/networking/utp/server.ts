import utp from 'utp-native'

import type { Config } from '../../../types/hydrabase'
import type { Account } from '../../crypto/Account'

import { Trace } from '../../../utils/trace'
import { UDP_Server } from '../udp/server'
import { UTPClient } from './client'

export const startUTPServer = (port: number, address: string, udpServer: UDP_Server, account: Account, node: Config['node']): Promise<true> => new Promise((res, rej) => {
  const trace = Trace.start(`[UTP] Starting server on ${address}:${port}`)
  const socket = utp()
  socket.listen(port, address, () => {
    trace.step(`[UTP] Server listening on ${address}:${port}`)
    trace.success()
    res(true)
  })
  socket.on('error', err => {
    trace.fail(`[UTP] Server error: ${String(err)}`)
    rej(err)
  })
  socket.on('close', () => {
    trace.fail('[UTP] Server closed unexpectedly')
    rej(new Error('UTP server closed unexpectedly'))
  })

  socket.on('connection', conn => {
    UTPClient.authenticateConnectedPeer(conn, udpServer, account, node).catch(err => {
      trace.fail(`[UTP] Inbound authentication error: ${String(err)}`)
      conn.destroy()
    })
  })
})
