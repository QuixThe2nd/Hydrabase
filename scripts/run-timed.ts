#!/usr/bin/env bun
/**
 * run-timed.ts — starts the Hydrabase backend and kills it after a TTL.
 *
 * Usage:
 *   bun run          # 30 s default
 *   bun run -- 60    # 60 s
 *   bun run -- 2m    # 2 minutes  (m suffix)
 *   bun run -- 0     # run forever (0 = no timeout)
 */

const parseTTL = (raw: string): number => {
  if (raw.endsWith('m')) return Number.parseFloat(raw) * 60_000
  if (raw.endsWith('s')) return Number.parseFloat(raw) * 1_000
  return Number.parseFloat(raw) * 1_000 // bare number = seconds
}

const parseTTLArg = (raw: string): number => {
  const ttlMs = parseTTL(raw)

  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    process.stderr.write(
      '[run-timed] Invalid TTL. Usage: bun run [-- <seconds|seconds"s"|minutes"m">], where 0 means no timeout.\n',
    )
    process.exit(1)
  }

  return ttlMs
}

const DEFAULT_TTL_MS = 30_000
const ttlMs = process.argv[2] ? parseTTLArg(process.argv[2]) : DEFAULT_TTL_MS

const proc = Bun.spawn(['bun', 'src/backend'], {
  stderr: 'inherit',
  stdin: 'inherit',
  stdout: 'inherit',
})

if (ttlMs > 0) {
  process.stdout.write(`[run-timed] Backend started (pid ${proc.pid}), will exit in ${ttlMs / 1000}s\n`)
  setTimeout(() => {
    process.stdout.write(`[run-timed] TTL reached (${ttlMs / 1000}s) — killing process\n`)
    proc.kill()
    process.exit(0)
  }, ttlMs)
} else {
  process.stdout.write(`[run-timed] Backend started (pid ${proc.pid}), no TTL (running until stopped)\n`)
}

await proc.exited
