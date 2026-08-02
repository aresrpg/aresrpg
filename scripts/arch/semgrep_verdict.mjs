#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// scripts/arch/semgrep_verdict.mjs — turns raw semgrep JSON into the arch-gate verdict.
// Invoked by scripts/semgrep-gate.sh, never directly by CI.
//
//   --expect <expected.json> <red|green> <semgrep.json>   fixture self-test (exact counts)
//   --baseline <baseline.json> <semgrep.json>             real-tree ratchet (new findings = red)
//   --write-baseline <baseline.json> <run1.json> <run2.json> <run3.json>   regenerate the floor
//     (#2016 — a floor is written from the MAX of ≥3 runs of the same scan; a single-pass write is
//      refused. Comparison stays single-pass: it can only ever be wrong in the safe direction.)
//
// THE JOIN (docs/CODE_LAW.md L-P4 · arch-laundered-store-write): semgrep OSS cannot relate two
// code sites in one rule, so laundered_extract.yml emits `x-arch-writer-def` (helper $F contains a
// direct external store write) and `x-arch-async-ref` ($F driven from an async context) and this
// script intersects the names. Extraction rows are never findings; the join result is.
// Names ride in the rule MESSAGE ('x-writer-def:$F') because semgrep OSS redacts extra.metavars
// without login. Scheduler builtins self-match in the call form — denylisted below.
import fs from 'node:fs'

import { merge_stable_scan, stability_line } from './scan_stability.mjs'

const LAUNDERED_RULE = 'arch-laundered-store-write'
const BUILTIN_NAMES = new Set([
  'setTimeout',
  'setInterval',
  'queueMicrotask',
  'requestAnimationFrame',
  'requestIdleCallback',
])
const LAUNDERED_MESSAGE =
  'L-P4 — helper `{name}` performs a direct external store write (def: {defs}) and is driven from ' +
  'an async context here. This is the cross-function form of the v1.12.28 crash class: async ' +
  'results re-enter through the reducer door — dispatch `input(msg, now)` (or the store action ' +
  'that wraps the write) and let the ONE reducer fold it. See CLAUDE.md ONE-PIPELINE.'

const rule_of = (check_id) => check_id.split('.').pop()

/** Normalize a semgrep result path: fixture scans are keyed relative to the red/green root. */
const normalize_path = (path) => path.replace(/^.*fixtures\/(red|green)\//, '')

const parse_findings = (semgrep_json) =>
  semgrep_json.results.map((result) => {
    const rule = rule_of(result.check_id)
    const message = result.extra?.message ?? ''
    const name = rule.startsWith('x-arch-') ? (message.split(':')[1] ?? '') : ''
    return {
      rule,
      path: normalize_path(result.path),
      raw_path: result.path,
      line: result.start.line,
      name,
      message,
    }
  })

const file_cache = new Map()
const file_text = (path) => {
  if (!file_cache.has(path)) {
    try {
      file_cache.set(path, fs.readFileSync(path, 'utf8'))
    } catch {
      file_cache.set(path, '')
    }
  }
  return file_cache.get(path)
}

const module_basename = (path) =>
  path
    .split('/')
    .pop()
    .replace(/\.[a-z]+$/, '')

/** The join: async-driven names ∩ direct-writer names → laundered findings at the async site.
 *  Provenance filter (kills same-name collisions like a local `finish` shadowing another file's
 *  writer): a def qualifies only when it lives in the REF's own file, or the ref file names the
 *  def module's basename (covers static AND dynamic `import('…/module.js')` specifiers alike). */
const join_laundered = (findings) => {
  const writer_defs = findings
    .filter((f) => f.rule === 'x-arch-writer-def' && f.name)
    .reduce((by_name, f) => {
      const defs = by_name.get(f.name) ?? []
      return new Map(by_name).set(f.name, [...defs, f])
    }, new Map())
  return findings
    .filter((f) => f.rule === 'x-arch-async-ref' && !BUILTIN_NAMES.has(f.name) && writer_defs.has(f.name))
    .flatMap((ref) => {
      const qualified = writer_defs
        .get(ref.name)
        .filter((def) => def.path === ref.path || file_text(ref.raw_path).includes(module_basename(def.path)))
      if (qualified.length === 0) return []
      const defs = qualified.map((def) => `${def.path}:${def.line}`).join(' ')
      return [
        {
          rule: LAUNDERED_RULE,
          path: ref.path,
          line: ref.line,
          name: ref.name,
          message: LAUNDERED_MESSAGE.replace('{name}', ref.name).replace('{defs}', defs),
        },
      ]
    })
}

/** Effective findings = the direct arch-* rules + the joined laundered rule (x-arch-* rows drop out). */
const effective_findings = (findings) => [
  ...findings.filter((f) => f.rule.startsWith('arch-')),
  ...join_laundered(findings),
]

const count_by = (findings, key_of) =>
  findings.reduce((counts, f) => {
    const key = key_of(f)
    return new Map(counts).set(key, (counts.get(key) ?? 0) + 1)
  }, new Map())

const read_json = (path) => JSON.parse(fs.readFileSync(path, 'utf8'))

// ── --expect: fixture self-test ───────────────────────────────────────────────────────────────
const run_expect = (expected_path, side, semgrep_path) => {
  const expected = read_json(expected_path)[side]
  if (!expected) {
    console.error(`semgrep-gate self-test: no '${side}' section in ${expected_path}`)
    return 2
  }
  const findings = parse_findings(read_json(semgrep_path))
  const relevant = side === 'red' ? [...findings, ...join_laundered(findings)] : effective_findings(findings)
  const actual = count_by(relevant, (f) => `${f.path} · ${f.rule}`)
  const wanted = new Map(
    Object.entries(expected).flatMap(([path, rules]) =>
      Object.entries(rules).map(([rule, n]) => [`${path} · ${rule}`, n])
    )
  )
  const keys = [...new Set([...actual.keys(), ...wanted.keys()])].sort()
  const mismatches = keys
    .map((key) => ({ key, want: wanted.get(key) ?? 0, got: actual.get(key) ?? 0 }))
    .filter(({ want, got }) => want !== got)
  if (mismatches.length > 0) {
    console.error(`semgrep-gate SELF-TEST FAILED (${side} fixtures) — the rules no longer match their pinned behavior:`)
    for (const { key, want, got } of mismatches) console.error(`  ${key}: expected ${want}, got ${got}`)
    return 1
  }
  console.log(`  self-test ${side}: ${relevant.length} finding(s), all as pinned`)
  return 0
}

// ── --baseline: the ratchet ───────────────────────────────────────────────────────────────────
const baseline_counts = (baseline) =>
  new Map(
    Object.entries(baseline).flatMap(([rule, by_path]) =>
      Object.entries(by_path).map(([path, n]) => [`${rule} · ${path}`, n])
    )
  )

const run_baseline = (baseline_path, semgrep_path) => {
  const baseline = fs.existsSync(baseline_path) ? read_json(baseline_path) : {}
  const found = effective_findings(parse_findings(read_json(semgrep_path)))
  const actual = count_by(found, (f) => `${f.rule} · ${f.path}`)
  const floor = baseline_counts(baseline)
  const keys = [...new Set([...actual.keys(), ...floor.keys()])].sort()
  const regressions = keys.filter((key) => (actual.get(key) ?? 0) > (floor.get(key) ?? 0))
  const improvements = keys.filter((key) => (actual.get(key) ?? 0) < (floor.get(key) ?? 0))
  if (regressions.length > 0) {
    console.error('ARCH GATE (semgrep) FAILED — findings above the ratchet floor:')
    const shown_rules = new Set()
    for (const key of regressions) {
      const [rule, path] = key.split(' · ')
      console.error(`  ${key}: ${actual.get(key) ?? 0} > baseline ${floor.get(key) ?? 0}`)
      for (const f of found.filter((x) => x.rule === rule && x.path === path))
        console.error(`    ${f.path}:${f.line}${f.name ? ` · ${f.name}` : ''}`)
      if (!shown_rules.has(rule)) {
        shown_rules.add(rule)
        const sample = found.find((x) => x.rule === rule)
        if (sample) console.error(`    law: ${sample.message.replace(/\s+/g, ' ').slice(0, 400)}`)
      }
    }
    console.error('Fix the new finding (docs/CODE_LAW.md), or — for a deliberately accepted debt —')
    console.error('regenerate the floor: bash scripts/semgrep-gate.sh --write-baseline')
    return 1
  }
  const total = [...actual.values()].reduce((a, b) => a + b, 0)
  console.log(`  ratchet: ${total} finding(s), none above the floor (${floor.size} baselined file·rule pairs)`)
  if (improvements.length > 0) {
    console.log(`  ${improvements.length} file·rule pair(s) improved below the floor — tighten it:`)
    console.log('    bash scripts/semgrep-gate.sh --write-baseline')
  }
  return 0
}

const run_write_baseline = (baseline_path, scan_paths) => {
  const stability = merge_stable_scan(scan_paths)
  if (!stability.ok) {
    console.error(stability.error)
    return 2
  }
  console.log(stability_line(stability))
  const found = effective_findings(parse_findings(stability.scan))
  const by_rule = {}
  for (const f of found.sort((a, b) => a.rule.localeCompare(b.rule) || a.path.localeCompare(b.path))) {
    by_rule[f.rule] = by_rule[f.rule] ?? {}
    by_rule[f.rule][f.path] = (by_rule[f.rule][f.path] ?? 0) + 1
  }
  fs.writeFileSync(baseline_path, `${JSON.stringify(by_rule, null, 2)}\n`)
  console.log(`  baseline written: ${baseline_path} (${found.length} finding(s))`)
  return 0
}

const [mode, ...args] = process.argv.slice(2)
const runners = {
  '--expect': () => run_expect(args[0], args[1], args[2]),
  '--baseline': () => run_baseline(args[0], args[1]),
  '--write-baseline': () => run_write_baseline(args[0], args.slice(1)),
}
const runner = runners[mode]
if (!runner) {
  console.error('usage: semgrep_verdict.mjs --expect <expected.json> <red|green> <semgrep.json>')
  console.error('       semgrep_verdict.mjs --baseline <baseline.json> <semgrep.json>')
  console.error('       semgrep_verdict.mjs --write-baseline <baseline.json> <run1.json> <run2.json> <run3.json>')
  process.exit(2)
}
process.exit(runner())
