import ipLookup from "@iplookup/country"
import { countryCodeEmoji } from "country-code-emoji"

export const fmt = (n: null | number | undefined, d = 1): string => n === null ? "—" : Number(n).toFixed(d)

export const fmtBytes = (bytes: number): string => bytes > 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(2)}MB`
  : bytes > 1024
  ? `${(bytes / 1024).toFixed(2)}KB`
  : `${bytes}B`

export const shortAddr = (a?: null | string): string => a ? `${a.slice(0, 10)}…${a.slice(-6)}` : "—"

export const parseWsHost = (wsUrl: string): { hostname: string; port: number } => {
  const url = new URL(wsUrl)
  return { hostname: url.host, port: Number(url.port) }
};

export const fmtUptime = (ms: number): string => `${String(Math.floor(ms / 3_600_000)).padStart(2, "0")}:${String(Math.floor(ms / 60_000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1_000) % 60).padStart(2, "0")}`

export const fmtClock = (seconds: number): string => `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`

export const toEmoji = (country: string): string => country === "N/A" || country === '-' ? "🌐" : countryCodeEmoji(country)

const ipMap = new Map<string, string>()

export const getCountry = async (ip: string): Promise<string> => {
  const known = ipMap.get(ip)
  if (known) return known
  const result = await ipLookup(ip)
  if (!result || !("country" in result) || !result.country) return "N/A"
  const { country } = result
  ipMap.set(ip, country)
  return country
};
