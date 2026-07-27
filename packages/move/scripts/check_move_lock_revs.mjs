// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// check_move_lock_revs.mjs — the framework-rev rule, mechanically (#1284).
//
// packages/move/Move.toml:14-24 has carried this rule as PROSE since the FeatureNotYetSupported
// incident: "Move.lock has ONE sui-framework + ONE move-stdlib rev (no duals). STANDING RULE: NO
// floating revs — pins only." Both halves were broken anyway, undetected, because nothing read the
// lock. A rule that lives in a comment is drift with a delay timer; this is its graduation.
//
// Two assertions, both pure functions of files in the repo — no chain, no CLI, no network:
//   1. SINGLE REV — inside one environment of one Move.lock, every `sui-framework` entry resolves to
//      the same git rev, and likewise every `move-stdlib`. A dual-rev graph is what testnet-128's
//      upgrade path rejected (FeatureNotYetSupported); the `Sui`/`Sui_1` pair in the lock is exactly
//      that condition, and it is invisible in the manifest because it enters through a dependency's
//      OWN transitive edge (Kiosk's), not through ours.
//   2. NO FLOATING REVS — a git dependency in a Move.toml pins a 40-hex commit, never a branch name.
//      A floating `rev = "testnet"` is what let the second framework lineage in: the branch moved,
//      the re-resolution pulled a different framework, and the lock grew a second rev.
//
// HOW THE RULE IS SATISFIED (measured 2026-07-27, `sui 1.76.0-6effb4523834`). The dual was never a
// lock-editing problem, which is why hand-collapsing it always came back:
//   · `override = true` does NOT reach a dependency's own edge — the `Sui`/`Sui_1` pair IS that
//     failure. Kiosk resolves its framework to the build CLI's IMPLICIT rev regardless.
//   · So the graph is single-rev if and only if OUR pin is that same rev. Scratch-built both ways:
//     pin = 6effb4523834 (the CLI's own) → one rev per environment, with Kiosk pinned as-is;
//     pin = d50b7888 (Kiosk's own manifest pin) → two revs, every time.
//   · A hand-collapsed lock under a divergent pin is cosmetic: the next `sui move build` re-expands
//     it. The fix is real only when a second full build leaves every lock BYTE-IDENTICAL, which is
//     the state this gate now protects.
// Consequence, recorded in packages/move/Move.toml and in checks.yml's sui pin: CI's installed sui
// and the ceremony operator's sui must be the same build, and re-pinning one means re-pinning every
// manifest in the same commit. Both environments must be re-resolved when they do
// (`sui move build` resolves only the ACTIVE one — `--build-env mainnet` for the other).
//
// Usage: node check_move_lock_revs.mjs [--root <dir>]   (default: packages/move)
//        bun run check:move-locks
// Exit 0 = clean, 1 = a violation (printed as `<file> <env> <framework>: <rev> vs <rev>` rows).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FRAMEWORK_SUBDIRS = {
  'crates/sui-framework/packages/sui-framework': 'sui-framework',
  'crates/sui-framework/packages/move-stdlib': 'move-stdlib',
}
const SHA_RE = /^[0-9a-f]{40}$/

// `[pinned.<env>.<name>]` followed by `source = { git = "…", subdir = "…", rev = "…" }`.
// Only git sources carry a rev; `{ local = … }` and `{ root = true }` entries are skipped by shape.
export function parse_lock_framework_revs(content) {
  const rows = []
  let env = null
  let name = null
  for (const line of content.split('\n')) {
    const header = line.match(/^\[pinned\.([^.\]]+)\.([^\]]+)\]/)
    if (header) {
      ;[, env, name] = header
      continue
    }
    if (!env || !line.startsWith('source =')) continue
    const subdir = line.match(/subdir = "([^"]+)"/)
    const rev = line.match(/rev = "([^"]+)"/)
    if (!subdir || !rev) continue
    const framework = FRAMEWORK_SUBDIRS[subdir[1]]
    if (framework) rows.push({ env, name, framework, rev: rev[1] })
  }
  return rows
}

// Pure. → one violation row per (env, framework) that resolves to more than one rev.
export function dual_rev_violations(rows) {
  const seen = new Map()
  for (const row of rows) {
    const key = `${row.env}/${row.framework}`
    if (!seen.has(key)) seen.set(key, new Map())
    const revs = seen.get(key)
    if (!revs.has(row.rev)) revs.set(row.rev, [])
    revs.get(row.rev).push(row.name)
  }
  return [...seen]
    .filter(([, revs]) => revs.size > 1)
    .map(([key, revs]) => ({
      key,
      revs: [...revs].map(([rev, names]) => ({ rev, names })),
    }))
}

// Pure. → one row per git dependency whose `rev` is not a 40-hex commit.
export function floating_rev_violations(manifest) {
  const rows = []
  let dep = null
  let is_git = false
  for (const line of manifest.split('\n')) {
    const header = line.match(/^\[dependencies\.([^\]]+)\]/)
    if (header) {
      ;[, dep] = header
      is_git = false
      continue
    }
    if (line.startsWith('[') && !header) {
      dep = null
      is_git = false
      continue
    }
    if (!dep) continue
    if (/^git\s*=/.test(line)) is_git = true
    const rev = line.match(/^rev\s*=\s*"([^"]+)"/)
    if (rev && is_git && !SHA_RE.test(rev[1])) rows.push({ dep, rev: rev[1] })
  }
  return rows
}

function move_files(root, filename) {
  const found = []
  const direct = path.join(root, filename)
  if (fs.existsSync(direct)) found.push(direct)
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue
    const nested = path.join(root, entry.name, filename)
    if (fs.existsSync(nested)) found.push(nested)
  }
  return found.sort()
}

export function main(root) {
  const failures = []

  for (const file of move_files(root, 'Move.lock')) {
    const rows = parse_lock_framework_revs(fs.readFileSync(file, 'utf8'))
    for (const violation of dual_rev_violations(rows)) {
      const detail = violation.revs
        .map(({ rev, names }) => `${rev.slice(0, 8)} (${names.join(', ')})`)
        .join(' vs ')
      failures.push(`${file}  ${violation.key}: ${detail}`)
    }
  }

  for (const file of move_files(root, 'Move.toml'))
    for (const { dep, rev } of floating_rev_violations(
      fs.readFileSync(file, 'utf8')
    ))
      failures.push(
        `${file}  [dependencies.${dep}] rev = "${rev}" is not a pin`
      )

  if (!failures.length) {
    console.log(
      'MOVE LOCK REV GATE PASSED. one sui-framework + one move-stdlib rev per environment, every git dep pinned.'
    )
    return 0
  }
  console.log('MOVE LOCK REV GATE FAILED.')
  for (const line of failures) console.log(`  ${line}`)
  console.log(
    '  A dual framework rev is the FeatureNotYetSupported condition (packages/move/Move.toml:14-24); a floating rev is how it gets back in.'
  )
  console.log(
    '  Fix: pin every git dependency to a commit, and collapse the lock to the single framework rev the manifests pin.'
  )
  return 1
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const index = process.argv.indexOf('--root')
  const root =
    index === -1
      ? path.resolve(fileURLToPath(import.meta.url), '../..')
      : path.resolve(process.argv[index + 1])
  process.exitCode = main(root)
}
