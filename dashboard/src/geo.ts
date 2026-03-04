import ipLookup from "@iplookup/country"
import { countryCodeEmoji } from "country-code-emoji"

import type { ApiPeer } from "../../src/StatsReporter"
import type { PeerWithCountry } from "./types"

import { parseWsHost } from "./utils"

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

export const enrichPeers = (apiPeers: ApiPeer[] = [], knownPeers: `0x${string}`[] = [], existingPeers: PeerWithCountry[] = []): Promise<PeerWithCountry[]> => {
  const allAddrs = Array.from(new Set([...apiPeers.map<`0x${string}`>(p => p.address), ...knownPeers]))

  return Promise.all(allAddrs.map(async address => {
    const apiPeer  = apiPeers.find(p => p.address === address)
    const existing = existingPeers.find(p => p.address === address)
    return {
      address,
      confidence: apiPeer?.confidence ?? 0,
      country: apiPeer?.hostname ? await getCountry(parseWsHost(apiPeer.hostname).hostname) : '-',
      hostname: apiPeer?.hostname,
      latency: apiPeer?.latency ?? 0,
      plugins: apiPeer?.plugins ?? [],
      rxTotal: apiPeer?.rxTotal ?? 0,
      status: apiPeer?.status ?? "disconnected",
      txTotal: apiPeer?.txTotal ?? 0,
      uptime: apiPeer?.uptime ?? 0,
      username: apiPeer?.username ?? "Anonymous",
      userAgent: apiPeer?.userAgent ?? "Hydrabase/Unknown",
      activity: existing?.activity ?? [],
    } satisfies PeerWithCountry
  }))
};