import type { NodeStats, PeerWithCountry, Votes } from '../../types/hydrabase'

import { PanelHeader } from '../components/PanelHeader'
import { ACCENT, BORD, MUTED, panel } from '../theme'

interface PluginVoteRow {
  peerTotal: number
  plugin: string
  selfTotal: number
  total: number
}

interface Props {
  peers: PeerWithCountry[]
  stats: NodeStats | null
}

const Header = ({ peerVotes, selfVotes }: { peerVotes: Votes, selfVotes: Votes }) => {
  const rows = [
    ['Tracks', selfVotes.tracks, selfVotes.tracks+peerVotes.tracks, '#bc8cff'],
    ['Albums', selfVotes.albums, selfVotes.albums+peerVotes.albums, '#56d364'],
    ['Artists', selfVotes.artists, selfVotes.artists+peerVotes.artists, '#ff9bce'],
  ] as const

  return <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
    {rows.map(([l, local, total, color]) => <div key={l} style={panel()}>
      <div style={{ padding: '12px 14px' }}>
        <div style={{ color: MUTED, fontSize: 9, letterSpacing: '.12em', marginBottom: 6, textTransform: 'uppercase' }}>{l}</div>
        <div style={{ alignItems: 'flex-end', display: 'flex', gap: 4, marginBottom: 10 }}>
          <span style={{ color, fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{local}</span>
          <span style={{ color: MUTED, fontSize: 13, marginBottom: 2 }}>/ {total}</span>
          <span style={{ color: MUTED, fontSize: 11, marginBottom: 2, marginLeft: 'auto' }}>{total > 0 ? ((local / total) * 100).toFixed(0) : 0}%</span>
        </div>
        <div style={{ background: '#21262d', borderRadius: 3, height: 5, overflow: 'hidden' }}>
          <div style={{ background: color, borderRadius: 3, height: '100%', width: `${total > 0 ? (local / total) * 100 : 0}%` }} />
        </div>
        <div style={{ color: MUTED, display: 'flex', fontSize: 9, justifyContent: 'space-between', marginTop: 4 }}>
          <span>your votes</span><span>peer votes</span>
        </div>
      </div>
    </div>)}
  </div>
}

const buildPluginVoteRows = (stats: NodeStats | null): PluginVoteRow[] => (stats?.peers.plugins ?? [])
    .map((plugin) => {
      const peerVotes = stats?.peers.pluginVotes[plugin] ?? { albums: 0, artists: 0, tracks: 0 }
      const selfVotes = stats?.self.pluginVotes[plugin] ?? { albums: 0, artists: 0, tracks: 0 }
      const peerTotal = peerVotes.albums + peerVotes.artists + peerVotes.tracks
      const selfTotal = selfVotes.albums + selfVotes.artists + selfVotes.tracks
      return { peerTotal, plugin, selfTotal, total: peerTotal + selfTotal }
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total)

const PluginVoteBreakdown = ({ rows }: { rows: PluginVoteRow[] }) => <div style={panel()}>
    <PanelHeader label='Votes By Plugin' />
    <div style={{ padding: '12px 16px' }}>
      {rows.length === 0 && (
        <div style={{ color: MUTED, fontSize: 11 }}>No votes have been recorded yet.</div>
      )}
      {rows.map((row) => {
        const selfPct = row.total > 0 ? (row.selfTotal / row.total) * 100 : 0
        return <div key={row.plugin} style={{ borderBottom: `1px solid ${BORD}`, marginBottom: 10, paddingBottom: 10 }}>
          <div style={{ alignItems: 'baseline', display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>{row.plugin}</span>
            <span style={{ color: MUTED, fontSize: 11 }}>{row.selfTotal} / {row.total}</span>
          </div>
          <div style={{ background: '#21262d', borderRadius: 3, height: 6, marginBottom: 4, overflow: 'hidden' }}>
            <div style={{ background: ACCENT, borderRadius: 3, height: '100%', width: `${selfPct}%` }} />
          </div>
          <div style={{ color: MUTED, display: 'flex', fontSize: 10, justifyContent: 'space-between' }}>
            <span>your votes: {row.selfTotal}</span>
            <span>peer votes: {row.peerTotal}</span>
          </div>
        </div>
      })}
    </div>
  </div>

export const VotesTab = ({ peers, stats }: Props) => {
  const knownPeerCount = peers.length
  const getPeerPlugins = (peer: PeerWithCountry): string[] => peer.connection?.plugins ?? peer.knownPlugins ?? []
  const pluginVoteRows = buildPluginVoteRows(stats)

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <Header peerVotes={stats?.peers.votes ?? { albums: 0, artists: 0, tracks: 0 }} selfVotes={stats?.self.votes ?? { albums: 0, artists: 0, tracks: 0 }} />
    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
      <div style={panel()}>
        <PanelHeader label="Plugins" />
        <div style={{ padding: '10px 0' }}>
          {stats?.peers.plugins.map(pl => {
            const on = stats.self.plugins.includes(pl)
            return <div key={pl} style={{ alignItems: 'center', borderBottom: `1px solid ${BORD}`, display: 'flex', justifyContent: 'space-between', padding: '10px 16px' }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>{pl}</div>
                <div style={{ color: MUTED, fontSize: 10 }}>{on ? 'Installed' : 'Not installed'}</div>
              </div>
              <span style={{ background: on ? 'rgba(63,185,80,.1)' : 'rgba(248,81,73,.1)', border: `1px solid ${on ? '#3fb95044' : '#f8514944'}`, borderRadius: 4, color: on ? '#3fb950' : '#f85149', fontSize: 10, padding: '3px 10px' }}>{on ? 'ACTIVE' : 'INACTIVE'}</span>
            </div>
          })}
        </div>
      </div>
      <div style={panel()}>
        <PanelHeader label="Plugin Coverage" />
        <div style={{ padding: '12px 16px' }}>
          {stats?.peers.plugins.map(pl => {
            const n = peers.filter(peer => getPeerPlugins(peer).includes(pl)).length
            return <div key={pl} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 12 }}>{pl}</span>
                <span style={{ color: MUTED, fontSize: 11 }}>{n}/{knownPeerCount} peers</span>
              </div>
              <div style={{ background: '#21262d', borderRadius: 3, height: 5, overflow: 'hidden' }}>
                <div style={{ background: ACCENT, borderRadius: 3, height: '100%', width: `${knownPeerCount > 0 ? (n / knownPeerCount) * 100 : 0}%` }} />
              </div>
            </div>
          })}
        </div>
      </div>
    </div>

    <PluginVoteBreakdown rows={pluginVoteRows} />
  </div>
}
