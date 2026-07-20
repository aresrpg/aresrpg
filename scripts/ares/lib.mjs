// Shared kernel for the `ares` CLI (scripts/ares.mjs dispatcher + scripts/ares/* subcommand
// modules): repo-root resolution, repo-root .env defaults, and the one error/one-line home.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

export const repo_root = path.resolve(path.dirname(file_url_to_path(import.meta.url)), '../..')
// Load repo-root .env defaults; Bun/node otherwise bind env loading to the caller's working directory.
try {
  for (const line of fs.readFileSync(path.join(repo_root, '.env'), 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (!match) continue
    const [, key, value] = match
    if (process.env[key] === undefined) process.env[key] = value
  }
} catch {
  // no repo-root .env — env comes from the caller's shell
}

export const one_line = (value) => String(value).replace(/\s+/g, ' ').trim()

export function error_reason(error) {
  const code = error?.cause?.code ?? error?.code
  if (code) return String(code)
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout'
  return one_line(error?.message ?? error ?? 'unknown error')
}
