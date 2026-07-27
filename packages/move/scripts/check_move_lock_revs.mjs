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

// ── Structural parsing ──────────────────────────────────────────────────────────────────────────
// The first version of this gate matched lines with `startsWith`, and a reviewer slipped a real dual
// past it with nothing more exotic than INDENTATION: an indented `[pinned.testnet.Sui_1]` table and
// its indented `source` row were both invisible, so a two-revision lock produced one row and no
// violation — a false green on exactly the condition this file exists to catch. A gate that reads a
// format by eye is a gate with a blind spot, so the lock and the manifests are parsed as TOML
// structure: tables are trimmed and matched whole, comments are stripped outside strings, and every
// key is read from its table rather than from the file's line order.
export function parse_toml_tables(content) {
  const tables = []
  let current = { header: null, keys: {} }
  tables.push(current)
  for (const raw of content.split('\n')) {
    const line = strip_comment(raw).trim()
    if (!line) continue
    const header = line.match(/^\[([^\]]+)\]$/)
    if (header) {
      current = { header: header[1].trim(), keys: {} }
      tables.push(current)
      continue
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/)
    if (kv) current.keys[kv[1]] = kv[2].trim()
  }
  return tables.filter((t) => t.header !== null || Object.keys(t.keys).length)
}

// `#` inside a quoted string is data, not a comment — strip only unquoted ones.
function strip_comment(line) {
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted
    else if (line[i] === '#' && !quoted) return line.slice(0, i)
  }
  return line
}

const inline_value = (inline, key) =>
  inline?.match(new RegExp(`${key}\\s*=\\s*"([^"]*)"`))?.[1] ?? null

// → [{ env, name, framework, rev }] for framework entries only (git sources under the sui repo).
export function parse_lock_framework_revs(content) {
  const rows = []
  for (const table of parse_toml_tables(content)) {
    const header = table.header?.match(/^pinned\.([^.]+)\.(.+)$/)
    if (!header) continue
    const [, env, name] = header
    const subdir = inline_value(table.keys.source, 'subdir')
    const rev = inline_value(table.keys.source, 'rev')
    const framework = subdir ? FRAMEWORK_SUBDIRS[subdir] : null
    if (framework && rev) rows.push({ env, name, framework, rev })
  }
  return rows
}

// → { env: { name: rev } } for EVERY pinned git dependency, framework or not (Kiosk included).
export function parse_lock_git_pins(content) {
  const pins = {}
  for (const table of parse_toml_tables(content)) {
    const header = table.header?.match(/^pinned\.([^.]+)\.(.+)$/)
    if (!header) continue
    const [, env, name] = header
    const rev = inline_value(table.keys.source, 'rev')
    if (!rev) continue
    pins[env] ??= {}
    pins[env][name] = rev
  }
  return pins
}

// → { environments: [...], git_deps: { Sui: rev, MoveStdlib: rev, Kiosk: rev, … } }
export function parse_manifest(content) {
  const environments = []
  const git_deps = {}
  for (const table of parse_toml_tables(content)) {
    if (table.header === 'environments')
      environments.push(...Object.keys(table.keys))
    const dep = table.header?.match(/^dependencies\.(.+)$/)
    if (dep && table.keys.git) git_deps[dep[1]] = unquote(table.keys.rev)
  }
  return { environments, git_deps }
}

const unquote = (v) => (v ?? '').replace(/^"|"$/g, '')

// The toolchain commit every framework pin must match, read from the ONE place CI pins the binary
// (`SUI_VERSION: sui <semver>-<commit>` in checks.yml). One home: bumping CI's sui without
// re-pinning the manifests — the drift that produced the dual — fails this gate instead of a
// ceremony.
export function expected_cli_commit(checks_yml) {
  return (
    checks_yml.match(/SUI_VERSION:\s*sui\s+\S+-([0-9a-f]{8,})/)?.[1] ?? null
  )
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

// Pure. The EXACT matrix, not merely "at most one rev": for every environment the manifest declares,
// the lock must actually pin BOTH frameworks, at the SAME rev, equal to the manifest's own pin —
// and every other git dependency (Kiosk) must match its manifest rev too. "At most one" was
// satisfied by an empty lock, by a missing mainnet environment, by Sui and MoveStdlib at different
// single revisions, and by any arbitrary rev at all; each of those is a violation here.
export function matrix_violations({ manifest, rows, pins, expected_commit }) {
  const out = []
  const declared = manifest.environments.length
    ? manifest.environments
    : Object.keys(pins)
  const manifest_framework =
    manifest.git_deps.Sui ?? manifest.git_deps.MoveStdlib

  if (
    manifest_framework &&
    expected_commit &&
    !manifest_framework.startsWith(expected_commit)
  )
    out.push(
      `manifest pins the framework at ${manifest_framework.slice(0, 12)} but CI installs ${expected_commit} — re-pin every manifest when the CLI moves`
    )

  for (const [dep, rev] of Object.entries(manifest.git_deps))
    if (!/^[0-9a-f]{40}$/.test(rev ?? ''))
      out.push(`[dependencies.${dep}] rev = "${rev}" is not a pin`)

  for (const env of declared) {
    const env_pins = pins[env]
    if (!env_pins) {
      out.push(
        `environment "${env}" is declared but has no pinned entries in the lock`
      )
      continue
    }
    for (const framework of ['Sui', 'MoveStdlib']) {
      const wanted = manifest.git_deps[framework]
      const found = rows.filter(
        (r) => r.env === env && r.framework === FRAMEWORK_NAMES[framework]
      )
      if (!found.length) {
        out.push(`${env}: no ${framework} entry in the lock`)
        continue
      }
      if (wanted && found.some((r) => r.rev !== wanted))
        out.push(
          `${env}/${framework}: lock has ${[...new Set(found.map((r) => r.rev.slice(0, 8)))].join(', ')} but the manifest pins ${wanted.slice(0, 8)}`
        )
    }
    for (const [dep, rev] of Object.entries(manifest.git_deps)) {
      if (dep === 'Sui' || dep === 'MoveStdlib') continue
      const found = env_pins[dep]
      if (!found)
        out.push(
          `${env}: manifest depends on ${dep} but the lock pins no such entry`
        )
      else if (found !== rev)
        out.push(
          `${env}/${dep}: lock pins ${found.slice(0, 8)} but the manifest pins ${rev.slice(0, 8)}`
        )
    }
  }
  return out
}

const FRAMEWORK_NAMES = { Sui: 'sui-framework', MoveStdlib: 'move-stdlib' }

// Pure. → one row per git dependency whose `rev` is not a 40-hex commit.
export function floating_rev_violations(manifest) {
  return Object.entries(parse_manifest(manifest).git_deps)
    .filter(([, rev]) => !/^[0-9a-f]{40}$/.test(rev ?? ''))
    .map(([dep, rev]) => ({ dep, rev }))
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
  const checks_yml_path = path.resolve(
    root,
    '../../.github/workflows/checks.yml'
  )
  const expected_commit = fs.existsSync(checks_yml_path)
    ? expected_cli_commit(fs.readFileSync(checks_yml_path, 'utf8'))
    : null
  if (!expected_commit)
    failures.push(
      `could not read SUI_VERSION's commit from ${checks_yml_path} — the toolchain pin is the reference every manifest is checked against`
    )

  for (const lock_path of move_files(root, 'Move.lock')) {
    const pkg_dir = path.dirname(lock_path)
    const manifest_path = path.join(pkg_dir, 'Move.toml')
    const label = path.relative(root, lock_path) || 'Move.lock'
    if (!fs.existsSync(manifest_path)) {
      failures.push(`${label}: a lock with no Move.toml beside it`)
      continue
    }
    const lock = fs.readFileSync(lock_path, 'utf8')
    const rows = parse_lock_framework_revs(lock)
    const pins = parse_lock_git_pins(lock)
    const manifest = parse_manifest(fs.readFileSync(manifest_path, 'utf8'))

    for (const violation of dual_rev_violations(rows)) {
      const detail = violation.revs
        .map(({ rev, names }) => `${rev.slice(0, 8)} (${names.join(', ')})`)
        .join(' vs ')
      failures.push(`${label}  ${violation.key}: ${detail}`)
    }
    for (const row of matrix_violations({
      manifest,
      rows,
      pins,
      expected_commit,
    }))
      failures.push(`${label}  ${row}`)
  }

  if (!failures.length) {
    console.log(
      `MOVE LOCK REV GATE PASSED. every environment pins one framework lineage at the CI toolchain's commit (${expected_commit}), and every git dependency matches its manifest.`
    )
    return 0
  }
  console.log('MOVE LOCK REV GATE FAILED.')
  for (const line of failures) console.log(`  ${line}`)
  console.log(
    '  A dual framework rev is the FeatureNotYetSupported condition (packages/move/Move.toml); a pin that diverges from the build CLI is how it gets back in.'
  )
  console.log(
    '  Fix: pin every manifest to the CI toolchain commit, then rebuild BOTH environments (`sui move build` resolves only the active one; `--build-env mainnet` for the other).'
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
