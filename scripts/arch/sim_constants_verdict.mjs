#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Per-rule + per-file count ratchet for scripts/sim-constants-gate.sh.
import fs from 'node:fs'

const rule_of = (check_id) => check_id.split('.').pop()
const read_json = (path) => JSON.parse(fs.readFileSync(path, 'utf8'))
const normalize_fixture_path = (result_path) =>
  result_path.replace(/^.*fixtures\/sim_constants\/(?:red|green)\//, '')
const counts_of = (semgrep) => {
  const counts = new Map()
  for (const result of semgrep.results.filter((row) => rule_of(row.check_id).startsWith('sim-protocol-'))) {
    const key = `${rule_of(result.check_id)} · ${normalize_fixture_path(result.path)}`
    const current = counts.get(key) ?? { count: 0, lines: [] }
    counts.set(key, { count: current.count + 1, lines: [...current.lines, result.start.line] })
  }
  return counts
}
const expected_counts = (expected) =>
  new Map(
    Object.entries(expected).flatMap(([fixture_path, rules]) =>
      Object.entries(rules).map(([rule, count]) => [`${rule} · ${fixture_path}`, count])
    )
  )
const baseline_counts = (baseline) =>
  new Map(
    Object.entries(baseline).flatMap(([rule, by_path]) =>
      Object.entries(by_path).map(([path, count]) => [`${rule} · ${path}`, count])
    )
  )
const baseline_json = (actual) => {
  const baseline = {}
  for (const [key, { count }] of [...actual].sort(([left], [right]) => left.localeCompare(right))) {
    const [rule, path] = key.split(' · ')
    baseline[rule] = baseline[rule] ?? {}
    baseline[rule][path] = count
  }
  return `${JSON.stringify(baseline, null, 2)}\n`
}

const [mode, baseline_path, side_or_semgrep_path, fixture_semgrep_path] = process.argv.slice(2)
if (
  !['--baseline', '--write-baseline', '--expect'].includes(mode) ||
  !baseline_path ||
  !side_or_semgrep_path ||
  (mode === '--expect' && !fixture_semgrep_path)
) {
  console.error(
    'usage: sim_constants_verdict.mjs <--baseline|--write-baseline> <baseline.json> <semgrep.json> | --expect <expected.json> <red|green> <semgrep.json>'
  )
  process.exit(2)
}
const semgrep_path = fixture_semgrep_path ?? side_or_semgrep_path
if (!fs.existsSync(baseline_path)) {
  console.error(`SIM PROTOCOL CONSTANTS GATE FAILED — baseline missing: ${baseline_path}`)
  process.exit(1)
}

if (mode === '--expect') {
  const side = side_or_semgrep_path
  const expected = read_json(baseline_path)[side]
  if (!expected) {
    console.error(`sim constants self-test: no '${side}' section in ${baseline_path}`)
    process.exit(2)
  }
  const actual = counts_of(read_json(semgrep_path))
  const wanted = expected_counts(expected)
  const keys = [...new Set([...actual.keys(), ...wanted.keys()])].sort()
  const mismatches = keys.filter((key) => (actual.get(key)?.count ?? 0) !== (wanted.get(key) ?? 0))
  if (mismatches.length > 0) {
    console.error(
      `SIM PROTOCOL CONSTANTS SELF-TEST FAILED (${side} fixture) — the matcher no longer fires on its pinned home:`
    )
    for (const key of mismatches)
      console.error(`  ${key}: expected ${wanted.get(key) ?? 0}, got ${actual.get(key)?.count ?? 0}`)
    process.exit(1)
  }
  const total = [...actual.values()].reduce((sum, row) => sum + row.count, 0)
  console.log(`  self-test ${side}: ${total} finding(s), exactly as pinned`)
  process.exit(0)
}

const floor = baseline_counts(read_json(baseline_path))
const actual = counts_of(read_json(semgrep_path))
const keys = [...new Set([...floor.keys(), ...actual.keys()])].sort()
const regressions = keys.filter((key) => (actual.get(key)?.count ?? 0) > (floor.get(key) ?? 0))
const improvements = keys.filter((key) => (actual.get(key)?.count ?? 0) < (floor.get(key) ?? 0))

if (regressions.length > 0) {
  console.error('SIM PROTOCOL CONSTANTS GATE FAILED — re-declarations above the ratchet baseline:')
  for (const key of regressions) {
    const finding = actual.get(key)
    console.error(`  ${key}: ${finding?.count ?? 0} > baseline ${floor.get(key) ?? 0}`)
    if (finding) console.error(`    line(s): ${finding.lines.join(', ')}`)
  }
  console.error('Import the protocol constant from @aresrpg/sim; never raise the #1603 baseline.')
  process.exit(1)
}

if (mode === '--write-baseline') {
  fs.writeFileSync(baseline_path, baseline_json(actual))
  const total = [...actual.values()].reduce((sum, row) => sum + row.count, 0)
  console.log(`  baseline tightened: ${baseline_path} (${total} finding(s))`)
  process.exit(0)
}

const total = [...actual.values()].reduce((sum, row) => sum + row.count, 0)
const rows = [...floor.values()].reduce((sum, count) => sum + count, 0)
console.log(`  ratchet: ${total} finding(s), none above the ${rows}-row baseline`)
if (improvements.length > 0) {
  console.log(`  ${improvements.length} file·rule pair(s) improved — tighten only:`)
  console.log('    bash scripts/sim-constants-gate.sh --write-baseline')
}
