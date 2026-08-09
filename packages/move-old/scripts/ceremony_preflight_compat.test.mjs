// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The republish window's mode rules, unit-tested. The CLI halves of this gate (compat verdict, size
// measurement) need a fullnode, an identity and a local build; the mode decision does not — it is a
// pure function of the marker's presence and the CI context, which is exactly the half that must
// never be wrong. The load-bearing row is the master-bound refusal: the window may not be promoted.
import { expect, test } from 'bun:test'

import {
  ci_context,
  classify_warnings,
  fatal_warnings,
  is_gas_boundary,
  is_unknown_filter_chatter,
  republish_window_verdict,
  run_compatibility_probe,
  significant_tail,
  size_verdict,
  strip_ansi,
} from './ceremony_preflight_compat.mjs'

const pr = (base_ref) => ({
  marker_present: true,
  ci: true,
  event: 'pull_request',
  base_ref,
  ref_name: null,
})
const push = (ref_name) => ({
  marker_present: true,
  ci: true,
  event: 'push',
  base_ref: null,
  ref_name,
})

test('no marker keeps the compat teeth, in every context', () => {
  for (const context of [pr('edge'), pr('master'), push('edge'), push('master')])
    expect(republish_window_verdict({ ...context, marker_present: false }).mode).toBe('compat')
})

test('the marker opens size-only mode on edge and on PRs into edge', () => {
  expect(republish_window_verdict(pr('edge')).mode).toBe('size-only')
  expect(republish_window_verdict(push('edge')).mode).toBe('size-only')
})

test('the marker is REFUSED on every master-bound run — the window is never promoted', () => {
  for (const context of [pr('master'), push('master')]) {
    const verdict = republish_window_verdict(context)
    expect(verdict.mode).toBe('refused')
    expect(verdict.reason).toContain('may never be promoted')
  }
})

test('an unrecognised CI event carrying the marker is refused, not guessed', () => {
  expect(
    republish_window_verdict({
      marker_present: true,
      ci: true,
      event: 'schedule',
      base_ref: null,
      ref_name: null,
    }).mode
  ).toBe('refused')
})

test('outside CI the marker is honoured — that is the ceremony operator running it locally', () => {
  expect(
    republish_window_verdict({
      marker_present: true,
      ci: false,
      event: null,
      base_ref: null,
      ref_name: null,
    }).mode
  ).toBe('size-only')
})

test('ci_context reads the GitHub context, and reports absence as absence', () => {
  expect(
    ci_context({
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_BASE_REF: 'edge',
      GITHUB_REF_NAME: '1284/merge',
    })
  ).toEqual({
    ci: true,
    event: 'pull_request',
    base_ref: 'edge',
    ref_name: '1284/merge',
  })
  expect(ci_context({})).toEqual({
    ci: false,
    event: null,
    base_ref: null,
    ref_name: null,
  })
})

test('a partial GitHub context is REFUSED — unsetting one variable is not a local run', () => {
  const base = {
    marker_present: true,
    ci: false,
    event: null,
    base_ref: null,
    ref_name: null,
  }
  expect(
    republish_window_verdict({
      ...base,
      event: 'pull_request',
      base_ref: 'master',
    }).mode
  ).toBe('refused')
  expect(republish_window_verdict({ ...base, ref_name: 'master' }).mode).toBe('refused')
  expect(republish_window_verdict(base).mode).toBe('size-only')
})

test('a CI pull_request with no base ref is refused rather than guessed', () => {
  expect(
    republish_window_verdict({
      marker_present: true,
      ci: true,
      event: 'pull_request',
      base_ref: null,
      ref_name: null,
    }).mode
  ).toBe('refused')
})

// ── The size leg's verdict (#1581) ──────────────────────────────────────────────────────────────
// The measurement itself needs a toolchain and a build; the DECISION over a measured number does
// not, and the decision is the half that reached edge broken — `aresrpg` sat 47 bytes over the
// chain ceiling on edge because nothing evaluated this on a pull request at all.

test('a package inside both its budget and the ceiling passes, and reports both margins', () => {
  const v = size_verdict({ name: 'aresrpg', size: 101_000, budget: 101_770 })
  expect(v.ok).toBe(true)
  expect(v.status).toBe('ok')
  expect(v.ceiling_headroom).toBe(1400)
  expect(v.budget_headroom).toBe(770)
  // the numbers are printed on SUCCESS too — headroom is visible in every Move PR, not only a red one
  expect(v.line).toContain('101000 / 102400')
  expect(v.line).toContain('1400 under')
  expect(v.line).toContain('budget 101770 (770 under)')
})

test('over BUDGET fails while still under the ceiling — the cliff moved earlier', () => {
  const v = size_verdict({ name: 'aresrpg', size: 102_000, budget: 101_770 })
  expect(v.ok).toBe(false)
  expect(v.status).toBe('over-budget')
  expect(v.ceiling_headroom).toBe(400) // still shippable — and still refused
  expect(v.line).toContain('budget 101770 (230 OVER)')
})

test('over the CHAIN CEILING is its own status, never merely over policy', () => {
  // the exact breach #1581 was filed for: edge measured 102447 against the 102400 ceiling
  const v = size_verdict({ name: 'aresrpg', size: 102_447, budget: 101_770 })
  expect(v.ok).toBe(false)
  expect(v.status).toBe('over-ceiling')
  expect(v.ceiling_headroom).toBe(-47)
  expect(v.line).toContain('47 OVER')
})

test('a package with no budget row is still held to the chain ceiling', () => {
  expect(size_verdict({ name: 'foundation', size: 40_000 }).status).toBe('ok')
  expect(size_verdict({ name: 'foundation', size: 102_401 }).status).toBe('over-ceiling')
})

// #1847's exact death: the first upgrade build exits before compatibility verification because a
// warning was escalated. The probe must rerun with warnings deflected, materialise the compatibility
// list whether it is empty or not, AND preserve the warning death as its own blocking result.
test('a warning-escalation death cannot hide either compatibility verdict', () => {
  const warning_death = Object.assign(new Error('warnings are errors'), {
    status: 1,
    stdout: '',
    stderr:
      "error[E09008]: unused function\nThis warning can be suppressed with '#[allow(unused_function)]'\nFailed to build Move modules: Compilation error.",
  })
  const fixtures = [
    {
      retry: Object.assign(new Error('incompatible'), {
        status: 1,
        stdout:
          'error[Compatibility E01001]: a public function is missing\nerror[Compatibility E01002]: a public struct changed',
        stderr: '',
      }),
      expected: ['E01001 a public function is missing', 'E01002 a public struct changed'],
    },
    { retry: 'AAECAwQ=', expected: [] },
  ]

  for (const fixture of fixtures) {
    const calls = []
    const run = (file, args) => {
      calls.push([file, ...args])
      const result = calls.length === 1 ? warning_death : fixture.retry
      if (result instanceof Error) throw result
      return result
    }
    const result = run_compatibility_probe(['client', 'upgrade', '--warnings-are-errors', 'fixture'], run)

    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain('--silence-warnings')
    expect([...result.errors.keys()]).toEqual(fixture.expected)
    expect(result.warning_failure).toContain('This warning can be suppressed')
  }
})

// #2207, measured on edge against the pinned CLI (sui 1.76.0-6effb4523834): Sui writes DIAGNOSTICS to
// stdout and BUILD PROGRESS to stderr, and the probe concatenates the two in that order — so the real
// message is always followed by chatter, and a blind `.slice(-5)` reports the chatter. The live run
// died on `Cannot find gas coin for signer address ...` and the gate printed
// "exit 1 — INCLUDING DEPENDENCY Sui | ... | BUILDING aresrpg": a verdict masked by noise.
const BUILD_NOISE = [
  '[NOTE] Dependencies on Sui, MoveStdlib, Bridge, DeepBook, and SuiSystem are automatically added',
  '[Note]: Dependency sources are no longer verified automatically during publication and upgrade.',
  'INCLUDING DEPENDENCY Kiosk',
  'INCLUDING DEPENDENCY MoveStdlib',
  'INCLUDING DEPENDENCY Sui',
  'INCLUDING DEPENDENCY aresrpg_fight',
  'INCLUDING DEPENDENCY aresrpg_foundation',
  'INCLUDING DEPENDENCY aresrpg_spells',
  'BUILDING aresrpg',
].join('\n')

test('build chatter never masks the diagnostic it trails', () => {
  const gas_death =
    'Cannot find gas coin for signer address 0x087aa862 with amount sufficient for the required gas budget'
  const tail = significant_tail(`${gas_death}\n${BUILD_NOISE}`)

  expect(tail).toContain('Cannot find gas coin')
  expect(tail).not.toContain('INCLUDING DEPENDENCY')
  expect(tail).not.toContain('BUILDING aresrpg')
})

// Chatter-only output still has to say SOMETHING — a tail that filters itself empty would trade one
// silent verdict for another.
test('an all-chatter output still reports its raw tail rather than nothing', () => {
  expect(significant_tail(BUILD_NOISE)).toContain('BUILDING aresrpg')
})

// The #1847 fixture put the warning on stderr with an EMPTY stdout, so its tail happened to land on
// the warning. Production is the other way round: the warning is a stdout diagnostic and the build
// notes trail it. Under that ordering the warning's own evidence must still survive into the report.
test('a warning escalation keeps its evidence under production stream ordering', () => {
  const warning_death = Object.assign(new Error('warnings are errors'), {
    status: 1,
    stdout:
      "error[E09008]: unused function\nThis warning can be suppressed with '#[allow(unused_function)]'\nFailed to build Move modules: Compilation error.\n",
    stderr: `${BUILD_NOISE}\n`,
  })
  const calls = []
  const run = (file, args) => {
    calls.push([file, ...args])
    if (calls.length === 1) throw warning_death
    return 'AAECAwQ='
  }

  const result = run_compatibility_probe(['client', 'upgrade', 'fixture'], run)

  expect(calls).toHaveLength(2)
  expect(result.warning_failure).toContain('This warning can be suppressed')
  expect(result.warning_failure).not.toContain('INCLUDING DEPENDENCY')
})

// ── The two measured host terminals (#2194, sui 1.76.0-6effb4523834, 2026-08-05) ───────────────────
// Captured from a live aresrpg probe: the CLI COLORIZES, so escapes land BETWEEN `]` and `:` in every
// diagnostic header — 96 of them in one run. A parser anchored on `]: ` reads colorized output as
// EMPTY, which is why these fixtures keep their escapes instead of arriving pre-stripped.
const ESC = '\u001b['
const COLORIZED_W09001 =
  `${ESC}0m${ESC}1m${ESC}38;5;11mwarning[W09001]${ESC}0m${ESC}1m: unused alias${ESC}0m\n` +
  '   │ use sui::{dynamic_field as df, event};\n' +
  "   = This warning can be suppressed with '#[allow(unused_use)]'\n"
const UNKNOWN_FILTER =
  'warning[W10007]: issue with attribute value\n' +
  '   ┌─ sources/shop.move:234:14\n' +
  '234 │ #[allow(lint(self_transfer))]\n' +
  "   │              ^^^^^^^^^^^^^ Unknown diagnostic filter 'lint(self_transfer)'\n"
const GAS_DEATH =
  'Cannot find gas coin for signer address 0x087aa862 with amount sufficient for the required gas budget 468118340.'

test('a colorized diagnostic header is still parsed — the gate never reads colour as silence', () => {
  // The blindness this pins: anchored on `]: `, RAW colorized output matches nothing at all.
  expect(COLORIZED_W09001.match(/warning\[(W\d{5})\]: /)).toBeNull()
  expect(strip_ansi(COLORIZED_W09001)).toContain('warning[W09001]: unused alias')
  expect(classify_warnings(COLORIZED_W09001)).toEqual([{ code: 'W09001', title: 'unused alias', forgiven: false }])
})

test('W10007 unknown-filter is forgiven; every other warning class stays fatal', () => {
  expect(is_unknown_filter_chatter(UNKNOWN_FILTER)).toBe(true)
  expect(fatal_warnings(UNKNOWN_FILTER)).toEqual([])

  // Forgiveness is per-BLOCK: a W09001 riding alongside the pair is still fatal. This is the live
  // negative control — forgiving the chatter must never forgive its neighbour.
  const both = `${UNKNOWN_FILTER}\n${COLORIZED_W09001}`
  expect(is_unknown_filter_chatter(both)).toBe(false)
  expect(fatal_warnings(both).map((w) => w.code)).toEqual(['W09001'])
})

test('a W10007 that is NOT an unknown filter stays fatal — the carve-out is not a code pass', () => {
  const other_w10007 = 'warning[W10007]: issue with attribute value\n   │ something else entirely\n'
  expect(fatal_warnings(other_w10007).map((w) => w.code)).toEqual(['W10007'])
  expect(is_unknown_filter_chatter(other_w10007)).toBe(false)
})

test('the gas boundary is recognised through colour, and only for its own error class', () => {
  expect(is_gas_boundary(`${ESC}0m${GAS_DEATH}${ESC}0m`)).toBe(true)
  expect(is_gas_boundary('Failed to build Move modules: Compilation error.')).toBe(false)
})

test('an output with no warnings at all is not chatter — absence is never a carve-out', () => {
  expect(is_unknown_filter_chatter(GAS_DEATH)).toBe(false)
  expect(classify_warnings('')).toEqual([])
})

test('the probe strips colour at the capture seam, so E-codes survive a colorizing CLI', () => {
  const colorized_incompat = Object.assign(new Error('incompatible'), {
    status: 1,
    stdout: `${ESC}0m${ESC}1merror[Compatibility E01001]${ESC}0m${ESC}1m: a public function is missing${ESC}0m`,
    stderr: '',
  })
  const result = run_compatibility_probe(['client', 'upgrade', 'fixture'], () => {
    throw colorized_incompat
  })
  expect([...result.errors.keys()]).toEqual(['E01001 a public function is missing'])
})
