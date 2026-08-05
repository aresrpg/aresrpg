#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Per-lane + per-key ratchet for scripts/single-home-gate.sh — same contract as
// scripts/arch/sim_constants_verdict.mjs: findings at or below the floor are known debt, anything
// above it is red, and only deletion moves the floor.
import fs from 'node:fs'

import { derive_fences, scan } from './single_home_scan.mjs'

const LANES = [
  'duplicate-export',
  'registry-fact',
  'registry-anchor',
  'registry-surface',
  'registry-importer',
  'store-writers',
]

const key_of = (finding) => `${finding.label} · ${finding.path}`

const counts_of = (findings) => {
  const counts = new Map()
  for (const finding of findings) {
    const key = `${finding.lane} · ${key_of(finding)}`
    const current = counts.get(key) ?? { count: 0, lines: [], detail: finding.detail }
    counts.set(key, { count: current.count + 1, lines: [...current.lines, finding.line], detail: finding.detail })
  }
  return counts
}

const flatten = (baseline) =>
  new Map(
    Object.entries(baseline).flatMap(([lane, keys]) =>
      Object.entries(keys).map(([key, count]) => [`${lane} · ${key}`, count])
    )
  )

const nest = (counts) => {
  const nested = Object.fromEntries(LANES.map((lane) => [lane, {}]))
  for (const [flat, { count }] of [...counts].sort(([left], [right]) => left.localeCompare(right))) {
    const lane = LANES.find((candidate) => flat.startsWith(`${candidate} · `))
    nested[lane][flat.slice(lane.length + 3)] = count
  }
  return `${JSON.stringify(nested, null, 2)}\n`
}

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}
const has = (name) => process.argv.includes(`--${name}`)

const root = argument('root', '.')
const scan_dirs = argument('scan', 'packages,api').split(',')
const registry_path = argument('registry', 'docs/REGISTRY.md')
const baseline_path = argument('baseline', null)
const expect_path = argument('expect', null)
const expect_case = argument('case', null)

// The generated fence, printed as rules (issue #2222). This is what the gate's positive control
// asserts against: plant a row in a copy of the registry, and a rule for it must appear here.
if (has('fences')) {
  const { fenced, unfenceable } = derive_fences({ root, registry_path })
  for (const fence of [...fenced].sort((left, right) => left.symbol.localeCompare(right.symbol)))
    console.log(`fence · ${fence.symbol} · ${fence.home} · ${fence.fact}`)
  for (const row of [...unfenceable].sort((left, right) => left.home.localeCompare(right.home)))
    console.log(`unfenceable · ${row.home} · ${row.fact} · ${row.reason}`)
  process.exit(0)
}

const result = scan({ root, scan_dirs, registry_path })
const actual = counts_of(result.findings)

// Fixture self-test: exact counts, both directions. The red tree must produce EXACTLY the pinned
// findings (a rule that stops matching fails here, not silently on the real tree) and the green tree
// must produce none (a rule that over-matches fails here).
if (expect_path) {
  const expected = flatten(JSON.parse(fs.readFileSync(expect_path, 'utf8'))[expect_case] ?? {})
  const keys = [...new Set([...expected.keys(), ...actual.keys()])].sort()
  const wrong = keys.filter((key) => (actual.get(key)?.count ?? 0) !== (expected.get(key) ?? 0))
  if (wrong.length > 0) {
    console.error(`  SELF-TEST FAILED (${expect_case}) — the scanner no longer measures what it claims:`)
    for (const key of wrong)
      console.error(`    ${key}: found ${actual.get(key)?.count ?? 0}, expected ${expected.get(key) ?? 0}`)
    process.exit(1)
  }
  console.log(
    `  self-test ${expect_case}: ${actual.size} pinned finding key(s) over ${result.files} file(s) — exact match`
  )
  process.exit(0)
}

if (!baseline_path) {
  console.error(
    'usage: single_home_verdict.mjs [--root d] [--scan a,b] --baseline f [--write] | --expect f --case red|green'
  )
  process.exit(2)
}

if (has('write')) {
  fs.writeFileSync(baseline_path, nest(actual))
  const total = [...actual.values()].reduce((sum, row) => sum + row.count, 0)
  console.log(
    `  baseline written: ${baseline_path} (${total} finding(s) over ${result.files} files, ${result.rows} registry rows)`
  )
  process.exit(0)
}

if (!fs.existsSync(baseline_path)) {
  console.error(`SINGLE-HOME GATE FAILED — baseline missing: ${baseline_path}`)
  process.exit(1)
}

const floor = flatten(JSON.parse(fs.readFileSync(baseline_path, 'utf8')))
const keys = [...new Set([...floor.keys(), ...actual.keys()])].sort()
const regressions = keys.filter((key) => (actual.get(key)?.count ?? 0) > (floor.get(key) ?? 0))
const improvements = keys.filter((key) => (actual.get(key)?.count ?? 0) < (floor.get(key) ?? 0))

if (regressions.length > 0) {
  console.error(
    'SINGLE-HOME GATE FAILED — a fact grew a second home (docs/REGISTRY.md, CLAUDE.md "One home per fact"):'
  )
  for (const key of regressions) {
    const finding = actual.get(key)
    console.error(`  ${key}: ${finding?.count ?? 0} > baseline ${floor.get(key) ?? 0}`)
    if (finding) console.error(`    line(s) ${finding.lines.join(', ')} — ${finding.detail}`)
  }
  console.error('Import or derive from the existing home; never raise this floor to absorb a new copy.')
  process.exit(1)
}

const total = [...actual.values()].reduce((sum, row) => sum + row.count, 0)
console.log(
  `  registry fence: ${result.fenced} import-fenced home(s) generated from ${result.rows} registry rows, ${result.unfenceable} anchor(s) unfenceable (prose/chain — see the fence report)`
)
console.log(
  `  ratchet: ${total} finding(s) over ${result.files} files / ${result.rows} registry rows, none above the ${floor.size}-key baseline`
)
if (improvements.length > 0) {
  console.log(`  ${improvements.length} key(s) improved — tighten only:`)
  console.log('    bash scripts/single-home-gate.sh --write-baseline')
}
