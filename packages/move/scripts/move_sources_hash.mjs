// MOVE-SOURCES CONTENT HASH — the staleness anchor shared by `release:prepare` (which stamps it into
// release_manifest.json) and the dev-only `/__move_sources_hash` endpoint (packages/frontend/dev/
// move_hash_plugin.ts, which recomputes it LIVE from the working tree). The admin RELEASE page compares the
// two: a mismatch means the Move sources changed AFTER the manifest was compiled, so the bytecode the page
// would publish is STALE — the page warns loudly and refuses to allow publishing.
//
// The hash covers every package's `sources/**/*.move` + its `Move.toml` (the compile inputs), for the SAME
// TICKET_ORDER package set the ceremony publishes. It DELIBERATELY excludes Published.toml / Move.lock / build/
// (publish STATE, rewritten by publishes — not source) so a re-stamp between compiles never false-positives.
// Deterministic: files are sorted by repo-relative path, each folded in as `path\0content\0`, so the digest is
// a pure function of the source bytes (identical on any machine, any run).
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { MOVE_DIR, TICKET_ORDER } from './ceremony_lib.mjs'

/** Recursively list every `*.move` under `dir` (absolute paths), or [] if the dir is absent. */
function list_move_files(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...list_move_files(p))
    else if (entry.isFile() && entry.name.endsWith('.move')) out.push(p)
  }
  return out
}

/** The absolute compile-input file list (every package's sources/**.move + Move.toml), sorted, deterministic. */
export function move_source_files() {
  const files = []
  for (const pkg of TICKET_ORDER) {
    files.push(...list_move_files(path.join(MOVE_DIR, pkg, 'sources')))
    const toml = path.join(MOVE_DIR, pkg, 'Move.toml')
    if (fs.existsSync(toml)) files.push(toml)
  }
  return files.sort()
}

/** sha256 hex of all Move compile inputs — a pure function of the source bytes (path + content per file). */
export function move_sources_hash() {
  const h = createHash('sha256')
  for (const abs of move_source_files()) {
    const rel = path.relative(MOVE_DIR, abs)
    h.update(rel)
    h.update('\0')
    h.update(fs.readFileSync(abs))
    h.update('\0')
  }
  return h.digest('hex')
}
