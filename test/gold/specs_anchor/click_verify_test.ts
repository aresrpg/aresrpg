// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// bun test — the pure click_decision contract (sibling of click_verify.ts / fight_mouse_helpers.ts).
// Named *_test.ts (NOT *.test.ts) on purpose: the anchor Playwright config has no testMatch override, so its
// default `**/*.@(spec|test).?(c|m)[jt]s?(x)` would collect a `.test.ts` sibling as a browser spec and explode
// on the bun:test import; the underscore form is bun-discoverable and Playwright-invisible.
//   run: bun test test/gold/specs_anchor/click_verify_test.ts
// @ts-expect-error tsconfig.lint.json (lint-only ts.Program, types:["node"]) has no bun:test declarations — the
// runtime is bun itself; this turns into an "unused directive" tripwire the day @types/bun lands at the root.
import { describe, expect, test } from 'bun:test'

import { CLICK_POLICY, click_decision, type ClickPolicy } from './click_verify'

// Tight bounds so exhaustion rows stay readable; semantics identical to the live CLICK_POLICY.
const policy: ClickPolicy = { wrong_cell_retriable: false, max_corrections: 3, max_attempts: 3, max_drift_px: 3 }
const intended = { x: 3, y: 6 }
const wrong = { x: 3, y: 1 } // the 2026-07-17 probe_liveness_solo live failure: draft registered 3:1 instead of 3,6

describe('click_decision — aim phase (pre-press, before any effect can register)', () => {
  test('presses only when the pointer pixel DECODES to the intended cell and the projection is still', () => {
    expect(click_decision(intended, { kind: 'aim', decoded: intended, drift_px: 0, corrections: 0 }, policy)).toBe(
      'press'
    )
    expect(click_decision(intended, { kind: 'aim', decoded: intended, drift_px: 3, corrections: 2 }, policy)).toBe(
      'press'
    )
  })

  test('re-aims when the pixel decodes to a NEIGHBOR cell (the settle-jitter drift case) — never presses', () => {
    expect(click_decision(intended, { kind: 'aim', decoded: wrong, drift_px: 0, corrections: 0 }, policy)).toBe(
      're_aim'
    )
  })

  test('re-aims when the pixel decodes off-board/void (null)', () => {
    expect(click_decision(intended, { kind: 'aim', decoded: null, drift_px: 0, corrections: 1 }, policy)).toBe('re_aim')
  })

  test('re-aims while the board is still MOVING (drift beyond tolerance), even on a matching decode', () => {
    expect(click_decision(intended, { kind: 'aim', decoded: intended, drift_px: 9, corrections: 0 }, policy)).toBe(
      're_aim'
    )
    expect(click_decision(intended, { kind: 'aim', decoded: intended, drift_px: null, corrections: 0 }, policy)).toBe(
      're_aim'
    )
  })

  test('fails the gesture (never a blind press) once corrections exhaust without alignment', () => {
    expect(click_decision(intended, { kind: 'aim', decoded: wrong, drift_px: 0, corrections: 3 }, policy)).toBe(
      'fail_never_aligned'
    )
  })
})

describe('click_decision — press phase (post-gesture registration verdict)', () => {
  test('done when the effect registered on the intended cell', () => {
    expect(click_decision(intended, { kind: 'press', pressed: true, registered: intended, attempts: 1 }, policy)).toBe(
      'done'
    )
  })

  test('a DEAD click (pressed, nothing registered) retries within budget, then fails dead', () => {
    expect(click_decision(intended, { kind: 'press', pressed: true, registered: null, attempts: 1 }, policy)).toBe(
      'retry'
    )
    expect(click_decision(intended, { kind: 'press', pressed: true, registered: null, attempts: 3 }, policy)).toBe(
      'fail_dead_click'
    )
  })

  test('a never-pressed gesture (aim never aligned) is FREE to retry — nothing registered by construction', () => {
    expect(click_decision(intended, { kind: 'press', pressed: false, registered: null, attempts: 1 }, policy)).toBe(
      'retry'
    )
    expect(click_decision(intended, { kind: 'press', pressed: false, registered: null, attempts: 3 }, policy)).toBe(
      'fail_never_aligned'
    )
  })

  test('THE LAW: a WRONG-cell registration is FINAL for effectful drafts — never blind-retried, budget or not', () => {
    expect(click_decision(intended, { kind: 'press', pressed: true, registered: wrong, attempts: 1 }, policy)).toBe(
      'fail_wrong_cell'
    )
  })

  test('an idempotent local pick (placement, wrong_cell_retriable) may re-click a wrong registration, bounded', () => {
    const placement = { ...policy, wrong_cell_retriable: true, max_attempts: 4 }
    expect(click_decision(intended, { kind: 'press', pressed: true, registered: wrong, attempts: 1 }, placement)).toBe(
      'retry'
    )
    expect(click_decision(intended, { kind: 'press', pressed: true, registered: wrong, attempts: 4 }, placement)).toBe(
      'fail_wrong_cell'
    )
  })
})

describe('CLICK_POLICY (the live default)', () => {
  test('effect clicks are non-retriable on a wrong-cell registration and allow ≥2 attempts for dead clicks', () => {
    expect(CLICK_POLICY.wrong_cell_retriable).toBe(false)
    expect(CLICK_POLICY.max_attempts).toBeGreaterThanOrEqual(2)
    expect(CLICK_POLICY.max_corrections).toBeGreaterThanOrEqual(1)
  })
})
