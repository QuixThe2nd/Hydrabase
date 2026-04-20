import type { Mapping, MappingInfo, Protocol } from 'node-portmapping'

import type { Config } from '../../types/hydrabase'

import { debug } from '../../utils/log'
import { Trace } from '../../utils/trace'

type PortMappingModule = typeof import('node-portmapping')

let portMappingModulePromise: null | Promise<PortMappingModule> = null
let portMappingInitError: Error | null = null
const activeMappings = new Map<string, Mapping>()

const mappingKey = (port: number, protocol: Protocol) => `${port}:${protocol}`

const toError = (error: unknown) => error instanceof Error ? error : new Error(String(error))

const normaliseLoadError = (error: unknown) => {
  const resolved = toError(error)
  if (resolved.message.includes('node_portmapping.node')) {
    return new Error('node-portmapping native addon is unavailable; run `bun pm trust node-portmapping && bun install` to allow Bun to build it, and ensure CMake is installed before starting Hydrabase')
  }

  return resolved
}

const loadPortMappingModule = async (): Promise<PortMappingModule> => {
  const mod = await import('node-portmapping')
  mod.init()
  return mod
}

const getPortMappingModule = (trace?: Trace): Promise<PortMappingModule> => {
  if (portMappingInitError) throw portMappingInitError
  if (portMappingModulePromise) return portMappingModulePromise

  const loadPromise = loadPortMappingModule()
    .catch((error: unknown) => {
      const nextError = normaliseLoadError(error)
      portMappingInitError = nextError
      portMappingModulePromise = null
      trace?.step(`[UPnP] Port mapping init failed: ${nextError.message}`)
      throw nextError
    })

  portMappingModulePromise = loadPromise
  return loadPromise
}

const destroyMapping = (mapping: Mapping): void => {
  try {
    mapping.destroy()
  } catch {
    // Best-effort cleanup for native mapping handles.
  }
}

const removeActiveMapping = (port: number, protocol: Protocol): void => {
  const existingMapping = activeMappings.get(mappingKey(port, protocol))
  if (!existingMapping) return
  destroyMapping(existingMapping)
  activeMappings.delete(mappingKey(port, protocol))
}

const describeSuccess = (port: number, protocol: Protocol, info: MappingInfo, trace?: Trace): void => {
  trace?.step(`[UPnP] Successfully forwarded ${protocol} port ${port} to ${info.externalHost}:${info.externalPort}`)
  if (!trace) debug(`[UPnP] Successfully renewed ${protocol} forwarding on port ${port}`)
}

const handleMappingState = ({
  info,
  mapping,
  port,
  protocol,
  reject,
  resolve,
  trace,
}: {
  info: MappingInfo
  mapping: Mapping
  port: number
  protocol: Protocol
  reject: (reason?: unknown) => void
  resolve: () => void
  trace: Trace | undefined
}): MappingInfo => {
  if (info.state === 'Success') {
    activeMappings.set(mappingKey(port, protocol), mapping)
    describeSuccess(port, protocol, info, trace)
    resolve()
    return info
  }

  if (info.state === 'Failure' || info.state === 'Destroyed') {
    destroyMapping(mapping)
    reject(new Error(`Port mapping failed for ${protocol} port ${port} with state ${info.state}`))
  }

  return info
}

const tryReadMappingInfo = (mapping: Mapping, onInfo: (info: MappingInfo) => MappingInfo): void => {
  try {
    onInfo(mapping.getInfo())
  } catch {
    // Ignore eager query failures and wait for the async callback instead.
  }
}

const createObserverFinish = () => {
  let settled = false
  let timeoutId: null | ReturnType<typeof setTimeout> = null

  return {
    finish: (callback: () => void): void => {
      if (settled) return
      settled = true
      if (timeoutId) clearTimeout(timeoutId)
      callback()
    },
    isSettled: (): boolean => settled,
    setTimeoutId: (nextTimeoutId: ReturnType<typeof setTimeout>): void => {
      timeoutId = nextTimeoutId
    },
  }
}

const createObserverInfoHandler = ({
  finish,
  isSettled,
  mapping,
  port,
  protocol,
  reject,
  resolve,
  trace,
}: {
  finish: (callback: () => void) => void
  isSettled: () => boolean
  mapping: Mapping
  port: number
  protocol: Protocol
  reject: (reason?: unknown) => void
  resolve: () => void
  trace: Trace | undefined
}) => (info: MappingInfo): MappingInfo => {
  if (isSettled()) return info

  handleMappingState({
    info,
    mapping,
    port,
    protocol,
    reject: reason => {
      finish(() => {
        reject(reason)
      })
    },
    resolve: () => {
      finish(() => {
        resolve()
      })
    },
    trace,
  })
  return info
}

const scheduleObserverTimeout = ({
  finish,
  mapping,
  port,
  protocol,
  reject,
}: {
  finish: (callback: () => void) => void
  mapping: Mapping
  port: number
  protocol: Protocol
  reject: (reason?: unknown) => void
}): ReturnType<typeof setTimeout> => setTimeout(() => {
  finish(() => {
    destroyMapping(mapping)
    reject(new Error(`Port mapping timeout after 5s for ${protocol} port ${port}`))
  })
}, 5000)

const createMappingObserver = ({
  mapping,
  port,
  protocol,
  reject,
  resolve,
  trace,
}: {
  mapping: Mapping
  port: number
  protocol: Protocol
  reject: (reason?: unknown) => void
  resolve: () => void
  trace: Trace | undefined
}) => {
  const { finish, isSettled, setTimeoutId } = createObserverFinish()
  const onInfo = createObserverInfoHandler({ finish, isSettled, mapping, port, protocol, reject, resolve, trace })

  setTimeoutId(scheduleObserverTimeout({ finish, mapping, port, protocol, reject }))
  return onInfo
}

const createPortMapping = async (port: number, protocol: Protocol, trace?: Trace): Promise<void> => {
  const portMapping = await getPortMappingModule(trace)
  removeActiveMapping(port, protocol)
  await new Promise<void>((resolve, reject) => {
    let observer: (info: MappingInfo) => MappingInfo = info => info
    const onInfo = (info: MappingInfo): MappingInfo => observer(info)
    const mapping = portMapping.createMapping({ externalPort: port, internalPort: port, protocol }, onInfo)
    observer = createMappingObserver({ mapping, port, protocol, reject, resolve, trace })
    tryReadMappingInfo(mapping, observer)
  })
}

const recordMappingError = (errors: string[], protocol: Protocol, error: unknown): void => {
  errors.push(`${protocol}: ${toError(error).message} - Ignore if manually port forwarded`)
}

const logTraceErrors = (trace: Trace, errors: string[], fallback: string): void => {
  for (let i = 0; i < errors.length; i++) {
    const message = errors[i] ?? fallback
    if (i === errors.length - 1) trace.fail(message)
    else trace.caughtError(message)
  }
}

export const requestPort = async (node: Config['node']) => {
  const trace = Trace.start(`[UPnP] Requesting port ${node.port}`)

  const errors: string[] = []
  try {
    await createPortMapping(node.port, 'TCP', trace)
  } catch (err) {
    recordMappingError(errors, 'TCP', err)
  }

  try {
    await createPortMapping(node.port, 'UDP', trace)
  } catch (err) {
    recordMappingError(errors, 'UDP', err)
  }

  if (errors.length > 0) {
    logTraceErrors(trace, errors.map(message => `[UPnP][FAIL] ${message}`), '[UPnP][FAIL] Unknown port mapping error')
    return
  }

  trace.success()
}

export const releasePortLeases = async () => {
  const trace = Trace.start('[UPnP] Releasing mapped ports')
  const mappings = [...activeMappings.entries()]
  const modulePromise = portMappingModulePromise

  if (mappings.length === 0 && !modulePromise) {
    trace.softFail('No active mappings to release')
    return
  }

  const errors: string[] = []
  for (const [mappingId, mapping] of mappings) {
    const [portRaw, protocolRaw] = mappingId.split(':')
    try {
      destroyMapping(mapping)
      activeMappings.delete(mappingId)
      trace.step(`[UPnP] Released ${protocolRaw} forwarding on port ${portRaw}`)
    } catch (err) {
      errors.push(`${protocolRaw}:${portRaw}: ${toError(err).message}`)
    }
  }

  portMappingModulePromise = null
  if (modulePromise) {
    try {
      const mod = await modulePromise
      await mod.cleanup()
    } catch (err) {
      errors.push(`cleanup: ${toError(err).message}`)
    }
  }

  if (errors.length > 0) {
    logTraceErrors(trace, errors, 'Unknown UPnP cleanup error')
    return
  }

  trace.success()
}
