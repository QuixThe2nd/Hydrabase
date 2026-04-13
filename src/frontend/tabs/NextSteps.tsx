import type { NodeStats, PeerWithCountry, RuntimeConfigSnapshot } from '../../types/hydrabase'

import { BORD, MUTED, TEXT } from '../theme'
import { parseEndpoint } from '../utils'

interface NextStep {
  actionLabel?: string
  actionTab?: 'messages' | 'peers' | 'search' | 'settings'
  description: string
  done: boolean
  key: string
  severity: StepSeverity
  title: string
}

interface NextStepsTabProps {
  messageCount: number
  onOpenMessages: () => void
  onOpenPeers: () => void
  onOpenSearch: () => void
  onOpenSettings: () => void
  peers: PeerWithCountry[]
  runtimeConfig: null | RuntimeConfigSnapshot
  stats: NodeStats | null
}

type StepSeverity = 'critical' | 'important' | 'nice'

const DEFAULT_BIO = 'Welcome to my part of the internet'
const DEFAULT_USERNAME = 'anonymous'
const GITHUB_BOOTSTRAP_NODE = '0x26cc08d7f906b2e55a06af561f870ec427d0caf7'

const LOCAL_HOSTNAMES = new Set(['0.0.0.0', '127.0.0.1', 'localhost'])
const IPV4_PRIVATE_BLOCK_REGEX = /^(?:10\.|127\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/u

const isIpv6Local = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase()
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')
}

const isLocalOrPrivateHost = (rawHostname: string): boolean => {
  const hostname = rawHostname.trim().toLowerCase()
  if (!hostname) return true
  if (LOCAL_HOSTNAMES.has(hostname)) return true
  if (hostname.endsWith('.local')) return true
  if (IPV4_PRIVATE_BLOCK_REGEX.test(hostname)) return true
  if (hostname.includes(':') && isIpv6Local(hostname)) return true
  return false
}

const severityColor = (severity: StepSeverity): string => {
  if (severity === 'critical') return '#f85149'
  if (severity === 'important') return '#d29922'
  return '#58a6ff'
}

const completionBadge = (done: boolean): { bg: string; border: string; color: string; label: string } => done
  ? { bg: 'rgba(63, 185, 80, .1)', border: 'rgba(63, 185, 80, .4)', color: '#3fb950', label: 'Done' }
  : { bg: 'rgba(248, 81, 73, .08)', border: 'rgba(248, 81, 73, .35)', color: '#ff7b72', label: 'Pending' }

const NextStepCard = ({ onNavigate, step }: { onNavigate: (tab: NonNullable<NextStep['actionTab']>) => void; step: NextStep }) => {
  const status = completionBadge(step.done)
  const {actionTab} = step
  return <article style={{ background: '#0d1117', border: `1px solid ${BORD}`, borderRadius: 10, display: 'grid', gap: 10, padding: 14 }}>
    <div style={{ alignItems: 'flex-start', display: 'flex', gap: 10, justifyContent: 'space-between' }}>
      <div>
        <h3 style={{ color: TEXT, fontSize: 14, margin: 0 }}>{step.title}</h3>
        <p style={{ color: MUTED, fontSize: 12, lineHeight: 1.45, margin: '5px 0 0' }}>{step.description}</p>
      </div>
      <span style={{ background: status.bg, border: `1px solid ${status.border}`, borderRadius: 999, color: status.color, fontSize: 10, fontWeight: 700, letterSpacing: '.05em', padding: '3px 8px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{status.label}</span>
    </div>

    <div style={{ alignItems: 'center', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
      <span style={{ color: severityColor(step.severity), fontSize: 10, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase' }}>{step.severity}</span>
      {actionTab && step.actionLabel && <button onClick={() => onNavigate(actionTab)} style={{ background: step.done ? 'transparent' : '#58a6ff', border: step.done ? `1px solid ${BORD}` : 'none', borderRadius: 7, color: step.done ? TEXT : '#071224', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, padding: '7px 11px' }}>
        {step.actionLabel}
      </button>}
    </div>
  </article>
}

// eslint-disable-next-line max-lines-per-function
const buildSteps = ({ messageCount, peers, runtimeConfig, stats }: Pick<NextStepsTabProps, 'messageCount' | 'peers' | 'runtimeConfig' | 'stats'>): NextStep[] => {
  const connectedPeers = peers.filter(peer => peer.connection !== undefined && peer.address !== '0x0')
  const hasGithubNode = peers.some(peer => peer.connection?.address.toLowerCase() === GITHUB_BOOTSTRAP_NODE)
  const hasConnectedNonApiPeer = connectedPeers.length > 0
  const isConnectable = hasGithubNode

  const desiredHostname = runtimeConfig?.desired.node.hostname ?? stats?.self.hostname ?? ''
  const parsedHostname = desiredHostname ? parseEndpoint(desiredHostname).hostname : ''
  const hasPublicDomain = Boolean(parsedHostname) && !isLocalOrPrivateHost(parsedHostname)

  const username = (runtimeConfig?.desired.node.username ?? '').trim()
  const hasCustomUsername = Boolean(username) && username.toLowerCase() !== DEFAULT_USERNAME

  const bio = (runtimeConfig?.desired.node.bio ?? '').trim()
  const hasCustomBio = Boolean(bio) && bio !== DEFAULT_BIO

  const hasMessages = messageCount > 0

  return [
    {
      actionLabel: 'Open Settings',
      actionTab: 'settings',
      description: isConnectable
        ? 'Your node appears reachable by external peers.'
        : hasConnectedNonApiPeer
          ? 'You can connect outward, but inbound reachability is limited. Configure router/NAT port-forwarding for your node port for better reliability.'
          : 'No successful peer connectivity yet. Forward your node port in your router, then restart and re-check peers.',
      done: isConnectable,
      key: 'connectability',
      severity: 'critical',
      title: 'Make Your Node Reachable',
    },
    {
      actionLabel: 'Open Settings',
      actionTab: 'settings',
      description: hasCustomUsername
        ? 'Your username is customized and discoverable.'
        : 'Set a unique username so peers can recognize you quickly instead of seeing the default identity.',
      done: hasCustomUsername,
      key: 'username',
      severity: 'important',
      title: 'Set Your Username',
    },
    {
      actionLabel: 'Open Settings',
      actionTab: 'settings',
      description: hasCustomBio
        ? 'Your profile bio is customized.'
        : 'Add a short bio so others know what your node shares or what you are interested in.',
      done: hasCustomBio,
      key: 'bio',
      severity: 'nice',
      title: 'Personalize Your Bio',
    },
    {
      actionLabel: 'Open Settings',
      actionTab: 'settings',
      description: hasPublicDomain
        ? `Hostname is configured as ${parsedHostname}.`
        : 'Consider pointing a domain to your node and setting it as hostname. Domains are easier to share and usually survive IP changes.',
      done: hasPublicDomain,
      key: 'domain',
      severity: 'important',
      title: 'Point a Domain to Your Node',
    },
    {
      actionLabel: 'Open Peers',
      actionTab: 'peers',
      description: connectedPeers.length > 0
        ? `You currently have ${connectedPeers.length} connected ${connectedPeers.length === 1 ? 'peer' : 'peers'}.`
        : 'No connected peers yet. Add or connect to peers to start exchanging network data.',
      done: connectedPeers.length > 0,
      key: 'peers',
      severity: 'important',
      title: 'Establish Peer Connections',
    },
    {
      actionLabel: hasMessages ? 'Open Messages' : 'Open Search',
      actionTab: hasMessages ? 'messages' : 'search',
      description: hasMessages
        ? 'You have active message history. Keep conversations going and follow up with peers.'
        : 'Try a search to test your setup end-to-end, then message a peer once results come in.',
      done: hasMessages,
      key: 'activity',
      severity: 'nice',
      title: 'Do a First Real Interaction',
    },
  ]
}

export const NextStepsTab = ({ messageCount, onOpenMessages, onOpenPeers, onOpenSearch, onOpenSettings, peers, runtimeConfig, stats }: NextStepsTabProps) => {
  const steps = buildSteps({ messageCount, peers, runtimeConfig, stats })
  const pendingSteps = steps.filter(step => !step.done)
  const doneSteps = steps.filter(step => step.done)

  const navigateTo = (tab: NonNullable<NextStep['actionTab']>) => {
    if (tab === 'settings') onOpenSettings()
    else if (tab === 'peers') onOpenPeers()
    else if (tab === 'messages') onOpenMessages()
    else onOpenSearch()
  }

  return <section style={{ display: 'grid', gap: 14, maxWidth: 920 }}>
    <header style={{ background: '#0d1117', border: `1px solid ${BORD}`, borderRadius: 10, padding: 16 }}>
      <h2 style={{ fontSize: 22, margin: 0 }}>Next Steps</h2>
      <p style={{ color: MUTED, fontSize: 12, lineHeight: 1.5, margin: '8px 0 0' }}>
        New node? Start here. These recommendations are generated from your current network + node configuration so you always know what to do next.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <span style={{ background: 'rgba(248, 81, 73, .08)', border: '1px solid rgba(248, 81, 73, .35)', borderRadius: 999, color: '#ff7b72', fontSize: 10, fontWeight: 700, letterSpacing: '.05em', padding: '3px 9px', textTransform: 'uppercase' }}>
          {pendingSteps.length} pending
        </span>
        <span style={{ background: 'rgba(63, 185, 80, .08)', border: '1px solid rgba(63, 185, 80, .35)', borderRadius: 999, color: '#3fb950', fontSize: 10, fontWeight: 700, letterSpacing: '.05em', padding: '3px 9px', textTransform: 'uppercase' }}>
          {doneSteps.length} complete
        </span>
      </div>
    </header>

    <div style={{ display: 'grid', gap: 10 }}>
      {pendingSteps.map(step => <NextStepCard key={step.key} onNavigate={navigateTo} step={step} />)}
    </div>

    {doneSteps.length > 0 && <details open={pendingSteps.length === 0} style={{ background: '#0d1117', border: `1px solid ${BORD}`, borderRadius: 10, padding: 12 }}>
      <summary style={{ color: TEXT, cursor: 'pointer', fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>
        Completed Steps ({doneSteps.length})
      </summary>
      <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
        {doneSteps.map(step => <NextStepCard key={step.key} onNavigate={navigateTo} step={step} />)}
      </div>
    </details>}
  </section>
}
