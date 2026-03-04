import { type JSX, useState } from "react";

import type { Album, Artist, Request, SearchResult, Track } from "../../../../../src/RequestManager";

import { BORD, MUTED, panel, SURF, TEXT } from "../../../theme";

type Props = SearchResultsProps & {
  onSearch: () => void
  searchError: null | string
  searchQuery: string
  setSearchQuery: (q: string) => void
  setSearchType: (t: Request['type']) => void
  setSearchResults: (searchResults: null | unknown[]) => void
}

interface SearchResultsProps {
  onTogglePlay: (id: string, previewUrl: string) => void
  playingId: null | string
  searchElapsed: null | number
  searchLoading: boolean
  searchResults: null | unknown[]
  searchType: Request['type']
}

const isTrack  = (_r: SearchResult[keyof SearchResult], type: Request['type']): _r is Track  => type === "track" || type === "artist.tracks" || type === 'album.tracks'
const isAlbum  = (_r: SearchResult[keyof SearchResult], type: Request['type']): _r is Album  => type === "album" || type === "artist.albums"
const isArtist = (_r: SearchResult[keyof SearchResult], type: Request['type']): _r is Artist => type === "artist"

const getSubtitle = (r: SearchResult[keyof SearchResult], type: Request['type']): string => {
  if (isTrack(r, type)) return `${r.artists.join(", ")} · ${r.album}`
  if (isAlbum(r, type)) return `${r.artists.join(", ")} · ${r.release_date.slice(0, 4)} · ${r.total_tracks} tracks`
  if (isArtist(r, type)) return `${r.followers} followers · ${r.genres.join(", ")}`
  return '';
}

const DetailRow = ({ label, value }: { label: string; value: React.ReactNode }) => {
  if (value === undefined || value === null || value === "") return null
  return <div style={{ borderBottom: `1px solid ${BORD}`, display: "flex", gap: 10, padding: "5px 0" }}>
    <span style={{ color: MUTED, flexShrink: 0, fontSize: 11, minWidth: 120 }}>{label}</span>
    <span style={{ color: TEXT, fontSize: 12, wordBreak: "break-all" }}>{value}</span>
  </div>
}

const DetailPanel = ({ onClose, onTogglePlay, playingId, r, type }: { onClose: () => void; onTogglePlay: (id: string, previewUrl: string) => void; playingId: null | string; r: SearchResult[keyof SearchResult]; type: Request['type'] }) => {
  const link = r.external_urls ? Object.values(r.external_urls)[0] as string : undefined;
  const isPlaying = playingId === r.id;
  const artStyle = isArtist(r, type) ? { borderRadius: "50%" } : { borderRadius: 6 };
  const previewUrl = isTrack(r, type) ? r.preview_url : undefined;

  return <div style={{ ...panel(), display: "flex", flexDirection: "column", gap: 12, padding: "16px 18px", position: "relative" }}>
    <div style={{ alignItems: "flex-start", display: "flex", gap: 14 }}>
      <img alt={r.name} height={72} src={r.image_url} style={artStyle} width={72} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{r.name}</div>
        <div style={{ color: MUTED, fontSize: 12, marginTop: 3 }}>{getSubtitle(r, type)}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {link && <button className="fbtn" onClick={() => window.open(link, "_blank", "noopener,noreferrer")} style={{ fontSize: 10 }}>Open ↗</button>}
          {previewUrl && <button className="fbtn" onClick={() => onTogglePlay(r.id, previewUrl)} style={{ fontSize: 10 }}>{isPlaying ? "⏸ Pause" : "▶ Preview"}</button>}
        </div>
      </div>
      <button className="fbtn" onClick={onClose} style={{ flexShrink: 0, fontSize: 11, padding: "3px 8px" }}>✕ Close</button>
    </div>
    <div style={{ display: "flex", flexDirection: "column" }}>
      <DetailRow label="ID" value={r.id} />
      <DetailRow label="Name" value={r.name} />
      {Object.entries(r).map(([key, val]) => <DetailRow key={key} label={key} value={val === null || val === undefined ? undefined : Array.isArray(val) ? val.join(", ") : typeof val === "object" ? JSON.stringify(val) : val} />)}
    </div>
  </div>
}

const getColumns = (type: Request['type']) => {
  if (type === "track" || type === 'artist.tracks' || type === 'album.tracks') return ["", "Name", "Soul ID", "Confidence", "Plugin ID", "Track ID", "Artists", "Album", "Duration", "Popularity", ""]
  if (type === "album" || type === "artist.albums") return ["", "Name", "Soul ID", "Confidence", "Plugin ID", "Album ID", "Artists", "Release Date", "Tracks", ""]
  if (type === "artist") return ["", "Name", "Soul ID", "Confidence", "Plugin ID", "Artist ID", "Genres", "Followers", "Popularity", ""]
  return ["", "Name", ""]
}

const rawCellBase: React.CSSProperties = {
  borderBottom: `1px solid ${BORD}`,
  color: TEXT,
  fontSize: 12,
  outlineOffset: -1,
  padding: "8px 10px",
  verticalAlign: "middle",
};

const formatDuration = (ms: number): string => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`

const ResultRow = ({ isPlaying, isSelected, onClick, onTogglePlay, r, type }: { isPlaying: boolean; isSelected: boolean; onClick: () => void; onTogglePlay: (id: string, previewUrl: string) => void; r: SearchResult[keyof SearchResult]; type: Request['type'] }) => {
  const cellBase = { ...rawCellBase, background: isSelected ? `${SURF}cc` : "transparent", outline: isSelected ? `2px solid ${TEXT}` : "none", }
  const cells: React.ReactNode[] = [
    <td key="art" style={{ ...cellBase, padding: "6px 8px 6px 10px", width: 44 }}><img alt="" height={30} src={r.image_url} style={isArtist(r, type) ? { borderRadius: "50%", flexShrink: 0 } : { borderRadius: 3, flexShrink: 0 }} width={30} /></td>,
    <td key="name" style={{ ...cellBase, fontWeight: 600, maxWidth: 200 }}><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div></td>,
    <td key="soul_id" style={{ ...cellBase, fontWeight: 600, maxWidth: 200 }}><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.soul_id}</div></td>,
    <td key="confidence" style={{ ...cellBase, fontWeight: 600, maxWidth: 200 }}><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.confidence}</div></td>,
    <td key="plugin_id" style={{ ...cellBase, fontWeight: 600, maxWidth: 200 }}><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.plugin_id}</div></td>,
    <td key="id" style={{ ...cellBase, fontWeight: 600, maxWidth: 200 }}><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.id}</div></td>,
  ];
  if (isTrack(r, type)) cells.push(...[
    <td key="artists" style={{ ...cellBase, color: MUTED, maxWidth: 160 }}><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.artists.join(", ")}</div></td>,
    <td key="album" style={{ ...cellBase, color: MUTED, maxWidth: 160 }}><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.album}</div></td>,
    <td key="duration" style={{ ...cellBase, color: MUTED, whiteSpace: "nowrap" }}>{formatDuration(r.duration_ms)}</td>,
    <td key="popularity" style={{ ...cellBase, color: MUTED }}>{r.popularity}</td>,
    <td key="actions" style={{ ...cellBase, paddingRight: 10, textAlign: "right", width: 60 }}>{r.preview_url && <button className="fbtn" onClick={(e) => { e.stopPropagation(); onTogglePlay(r.id, r.preview_url); }} style={{ fontSize: 10, padding: "3px 6px" }}>{isPlaying ? "⏸" : "▶"}</button>}</td>
  ])
  else if (isAlbum(r, type)) cells.push(...[
    <td key="artists" style={{ ...cellBase, color: MUTED, maxWidth: 160 }}><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.artists.join(", ")}</div></td>,
    <td key="release" style={{ ...cellBase, color: MUTED, whiteSpace: "nowrap" }}>{r.release_date.slice(0, 4)}</td>,
    <td key="tracks" style={{ ...cellBase, color: MUTED }}>{r.total_tracks}</td>,
    <td key="actions" style={{ ...cellBase }} />,
  ])
  else if (isArtist(r, type)) cells.push(...[
    <td key="genres" style={{ ...cellBase, color: MUTED, maxWidth: 200 }}><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.genres.join(", ")}</div></td>,
    <td key="followers" style={{ ...cellBase, color: MUTED, whiteSpace: "nowrap" }}>{typeof r.followers === "number" ? r.followers.toLocaleString() : r.followers}</td>,
    <td key="popularity" style={{ ...cellBase, color: MUTED }}>{r.popularity}</td>,
    <td key="actions" style={{ ...cellBase }} />,
  ])
  return <tr onClick={onClick} style={{ cursor: "pointer" }}>{cells}</tr>
}

const SearchResults = ({ onTogglePlay, playingId, searchElapsed, searchLoading, searchResults, searchType, selected, setSelected }: SearchResultsProps & { selected: null | SearchResult[keyof SearchResult], setSelected: React.Dispatch<React.SetStateAction<null | SearchResult[keyof SearchResult]>> }): JSX.Element | undefined => {
  if (searchResults === null || searchLoading) return undefined
  if (searchResults.length === 0) return <div style={{ color: MUTED, padding: "20px 14px" }}>No results found</div>
  const columns = getColumns(searchType)
  return <>
    <div style={{ color: MUTED, fontSize: 11, marginBottom: 2 }}>
      {searchResults.length} {searchType + (searchResults.length === 1 ? "" : "s")} found · {searchElapsed?.toFixed(0)}ms
      {selected && <span> · <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: MUTED, cursor: "pointer", fontSize: 11, padding: 0, textDecoration: "underline" }}>clear selection</button></span>}
    </div>
    <div style={{ ...panel(), overflow: "hidden", padding: 0 }}>
      <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: "100%" }}>
        <thead>
          <tr>{columns.map((col, i) => <th key={i} style={{ background: SURF, borderBottom: `1px solid ${BORD}`, color: MUTED, fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", padding: "7px 10px", textAlign: "left", textTransform: "uppercase", width: i === 0 ? 44 : i === columns.length - 1 ? 60 : undefined }}>{col}</th>)}</tr>
        </thead>
        <tbody>{(searchResults as SearchResult[keyof SearchResult][]).map((r) => <ResultRow isPlaying={playingId === r.id} isSelected={selected?.id === r.id} key={r.soul_id} onClick={() => setSelected(selected?.id === r.id ? null : r)} onTogglePlay={onTogglePlay} r={r} type={searchType} />)}</tbody>
      </table>
    </div>
  </>
}

export const SearchTab = ({ onSearch, onTogglePlay, playingId, searchElapsed, searchError, searchLoading, searchQuery, searchResults, setSearchResults, searchType, setSearchQuery, setSearchType }: Props) => {
  const [selected, setSelected] = useState<null | SearchResult[keyof SearchResult]>(null)
  const handleSearch = () => {
    setSelected(null)
    onSearch()
  }
  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
      <span style={{ color: MUTED, fontSize: 11 }}>Type:</span>
      {(["track", "album", "artist", "artist.tracks", "artist.albums", "album.tracks"] as const).map(t => <button className={`fbtn${searchType === t ? " on" : ""}`} key={t} onClick={() => {
        setSelected(null)
        setSearchType(t)
        setSearchResults(null)
      }}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>)}
    </div>
    <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
      <input onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()} placeholder="Enter search query…" style={{ background: SURF, border: `1px solid ${BORD}`, borderRadius: 4, color: TEXT, flex: 1, fontFamily: "inherit", fontSize: 13, padding: "6px 10px" }} type="text" value={searchQuery} />
      <button className="fbtn" disabled={searchLoading} onClick={handleSearch} style={searchLoading ? { cursor: "default", opacity: 0.5 } : {}}>SEARCH →</button>
    </div>
    {searchLoading && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {[1, 2, 3, 4, 5].map((i) => <div key={i} style={{ ...panel(), animation: "blink 1.2s infinite", height: 44 }} />)}
    </div>}
    {searchError && <div style={{ ...panel(), border: "1px solid #f85149", color: "#f85149", padding: "12px 14px" }}>{searchError}</div>}
    {selected && !searchLoading && <DetailPanel onClose={() => setSelected(null)} onTogglePlay={onTogglePlay} playingId={playingId} r={selected} type={searchType} />}
    <SearchResults onTogglePlay={onTogglePlay} playingId={playingId} searchElapsed={searchElapsed} searchLoading={searchLoading} searchResults={searchResults} searchType={searchType} selected={selected} setSelected={setSelected} />
  </div>
}
