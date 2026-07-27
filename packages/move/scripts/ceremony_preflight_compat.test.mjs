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
