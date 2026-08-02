// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The republish window's mode rules, unit-tested. The CLI halves of this gate (compat verdict, size
// measurement) need a fullnode, an identity and a local build; the mode decision does not — it is a
// pure function of the marker's presence and the CI context, which is exactly the half that must
// never be wrong. The load-bearing row is the master-bound refusal: the window may not be promoted.
import { expect, test } from 'bun:test'

import {
  ci_context,
  republish_window_verdict,
  run_compatibility_probe,
  size_verdict,
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
  for (const context of [
    pr('edge'),
    pr('master'),
    push('edge'),
    push('master'),
  ])
    expect(
      republish_window_verdict({ ...context, marker_present: false }).mode
    ).toBe('compat')
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
  expect(republish_window_verdict({ ...base, ref_name: 'master' }).mode).toBe(
    'refused'
  )
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
  expect(size_verdict({ name: 'foundation', size: 102_401 }).status).toBe(
    'over-ceiling'
  )
})

// #1847's exact death: the first upgrade build exits before compatibility verification because a
// warning was escalated. The probe must rerun with warnings deflected, materialise the compatibility
// list whether it is empty or not, AND preserve the warning death as its own blocking result.
test('a warning-escalation death cannot hide either compatibility verdict', () => {
  const warning_death = Object.assign(
    new Error('warnings are errors'),
    {
      status: 1,
      stdout: '',
      stderr:
        "error[E09008]: unused function\nThis warning can be suppressed with '#[allow(unused_function)]'\nFailed to build Move modules: Compilation error.",
    }
  )
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
    const result = run_compatibility_probe(
      ['client', 'upgrade', '--warnings-are-errors', 'fixture'],
      run
    )

    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain('--silence-warnings')
    expect([...result.errors.keys()]).toEqual(fixture.expected)
    expect(result.warning_failure).toContain('This warning can be suppressed')
  }
})
