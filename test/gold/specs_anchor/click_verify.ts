// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PURE click-verification contract for the gold fight mouse helpers (fight_mouse_helpers.ts) — zero Playwright,
// zero I/O, unit-tested by click_verify_test.ts. ONE decision function owns every verify/retry verdict of a
// board-cell click so the law lives in one testable home:
//
//   AIM phase (pre-press): the pointer sits on a pixel; the board picker's OWN decode of that pixel
//   (board_picking cell_at_ray — the IDENTICAL pick pointerup runs) plus the freshest projection drift decide
//   press / re-aim / abort. A press is only ever fired at a pixel that DECODES to the intended cell while the
//   projection is still — mis-decoded presses are how a draft REGISTERS on a neighbor cell, and a registered
//   effect is unretriable by law, so the class must die BEFORE the press.
//
//   PRESS phase (post-gesture): what the effect oracle registered decides done / retry / final-fail.
//   · dead click (pressed, nothing registered) → bounded re-gesture (nothing burned);
//   · never-pressed gesture (aim never aligned) → bounded re-gesture (free by construction);
//   · WRONG-cell registration → FINAL for effectful drafts (D254 move-path extension / AP burn — the
//     tx-retry-burn law's harness twin: a registered effect is NEVER blind-retried), unless the effect is an
//     idempotent local pick (placement, D66 — re-picking moves the pick, nothing burns) where a bounded
//     re-click is lawful.

export type Cell = { readonly x: number; readonly y: number }

export type ClickPolicy = {
  /** true ONLY for idempotent local picks (placement) — effectful drafts (move/cast) stay false forever. */
  readonly wrong_cell_retriable: boolean
  /** re-aim budget per gesture (each ≈ a human move + settle beat, so this also bounds camera-settle chase time). */
  readonly max_corrections: number
  /** full-gesture budget per effect click. */
  readonly max_attempts: number
  /** pointer-vs-fresh-projection stillness tolerance, px (board still moving beyond this = never press). */
  readonly max_drift_px: number
}

/** The live default: effect clicks (move draft / cast aim). Placement overrides via spread at its call site. */
export const CLICK_POLICY: ClickPolicy = Object.freeze({
  wrong_cell_retriable: false,
  max_corrections: 8,
  max_attempts: 3,
  max_drift_px: 3,
})

export type AimEvidence = {
  readonly kind: 'aim'
  /** the board picker's decode of the pixel the pointer sits on (null = off-board / void / no board). */
  readonly decoded: Cell | null
  /** distance between the pointer and the intended cell's FRESH projection (null = projection lost). */
  readonly drift_px: number | null
  /** re-aims already spent this gesture. */
  readonly corrections: number
}

export type PressEvidence = {
  readonly kind: 'press'
  /** false = the gesture aborted before any press (aim never aligned) — no effect can exist. */
  readonly pressed: boolean
  /** the cell the effect oracle registered onto (null = nothing registered before the deadline). */
  readonly registered: Cell | null
  /** full gestures spent so far, this one included (1-based). */
  readonly attempts: number
}

export type ClickEvidence = AimEvidence | PressEvidence

export type ClickAction =
  'press' | 're_aim' | 'retry' | 'done' | 'fail_never_aligned' | 'fail_dead_click' | 'fail_wrong_cell'

const same_cell = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y

/** The ONE pure verdict: (intended cell, evidence, policy) → next action. Total over both phases. */
export function click_decision(intended: Cell, evidence: ClickEvidence, policy: ClickPolicy): ClickAction {
  if (evidence.kind === 'aim') {
    const aligned = evidence.decoded != null && same_cell(evidence.decoded, intended)
    const still = evidence.drift_px != null && evidence.drift_px <= policy.max_drift_px
    if (aligned && still) return 'press'
    return evidence.corrections < policy.max_corrections ? 're_aim' : 'fail_never_aligned'
  }
  if (!evidence.pressed) return evidence.attempts < policy.max_attempts ? 'retry' : 'fail_never_aligned'
  if (!evidence.registered) return evidence.attempts < policy.max_attempts ? 'retry' : 'fail_dead_click'
  if (same_cell(evidence.registered, intended)) return 'done'
  return policy.wrong_cell_retriable && evidence.attempts < policy.max_attempts ? 'retry' : 'fail_wrong_cell'
}
