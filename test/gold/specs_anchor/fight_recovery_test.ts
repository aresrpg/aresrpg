// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// bun test — the pure stale-fight recovery contract (sibling of fight_recovery.ts / fight_mouse_helpers.ts).
// Named *_test.ts (NOT *.test.ts) on purpose: the anchor Playwright config has no testMatch override, so its
// default `**/*.@(spec|test).?(c|m)[jt]s?(x)` would collect a `.test.ts` sibling as a browser spec and explode on
// the bun:test import; the underscore form is bun-discoverable and Playwright-invisible (click_verify_test.ts law).
//   run: bun test test/gold/specs_anchor/fight_recovery_test.ts
// @ts-expect-error tsconfig.lint.json (lint-only ts.Program, types:["node"]) has no bun:test declarations — the
// runtime is bun itself; this turns into an "unused directive" tripwire the day @types/bun lands at the root.
import { describe, expect, test } from 'bun:test'

import {
  fight_recovery_verdict,
  owned_live_fight,
  run_fight_recovery,
  type FightRecoveryEffects,
  type FightRecoveryFight,
  type FightRecoveryState,
} from './fight_recovery'

const FIXTURE = '0xfixture'
const OTHER = '0xother'

const state = (fights: readonly FightRecoveryFight[], pending_outcome = false): FightRecoveryState => ({
  character_id: FIXTURE,
  fights,
  pending_outcome,
})
const fight = (fight_id: string, status: string, participants: readonly string[]): FightRecoveryFight => ({
  fight_id,
  status,
  participants: participants.map((character) => ({ character })),
})

// THE ONLY forfeit oracle (seat money-lens rider #3): a tx-door mock that COUNTS its invocations at the door —
// never inferred from log text. run_fight_recovery must invoke it EXACTLY once for an owned-active fight, ZERO
// otherwise (no fight / not-owned / terminal-unclaimed). The count is per fight id (a Map is the sanctioned
// mutable contract) so per-id multiplicity catches a DOUBLE-forfeit that a bare size would hide.
const recording_effects = (): { forfeits: Map<string, number>; effects: FightRecoveryEffects } => {
  const forfeits = new Map<string, number>()
  return { forfeits, effects: { forfeit: (f) => void forfeits.set(f.fight_id, (forfeits.get(f.fight_id) ?? 0) + 1) } }
}

describe('fight_recovery_verdict — the pure three-way recovery classifier', () => {
  test('an OWNED live fight (active) → forfeit_active', () => {
    expect(fight_recovery_verdict(state([fight('f1', 'active', [FIXTURE, OTHER])]))).toBe('forfeit_active')
  })
  test('an OWNED live fight (placement) → forfeit_active', () => {
    expect(fight_recovery_verdict(state([fight('f1', 'placement', [FIXTURE])]))).toBe('forfeit_active')
  })
  test('OWNERSHIP GUARD: a live fight the fixture does NOT participate in is never ours (never forfeit_active)', () => {
    const foreign = state([fight('f9', 'active', [OTHER])])
    expect(owned_live_fight(foreign)).toBeNull()
    expect(fight_recovery_verdict(foreign)).not.toBe('forfeit_active')
  })
  test('a TERMINAL (defeat) fight → claim_result (the engage-loop D767 claim path, not the forfeit door)', () => {
    expect(fight_recovery_verdict(state([fight('f2', 'defeat', [FIXTURE])]))).toBe('claim_result')
  })
  test('an unopened outcome row alone → claim_result', () => {
    expect(fight_recovery_verdict(state([], true))).toBe('claim_result')
  })
  test('IDEMPOTENCE: no fight, no pending outcome → none (no-op)', () => {
    expect(fight_recovery_verdict(state([]))).toBe('none')
  })
})

describe('run_fight_recovery — the tx door fires EXACTLY once for an owned-active fight, ZERO otherwise', () => {
  test('owned-active → EXACTLY ONE forfeit at the tx door, on the owned fight', async () => {
    const { forfeits, effects } = recording_effects()
    const result = await run_fight_recovery(state([fight('f1', 'active', [FIXTURE, OTHER])]), effects)
    expect(forfeits.get('f1')).toBe(1) // exactly one invocation at the tx door, on the owned fight
    expect(forfeits.size).toBe(1) // and no other fight forfeited
    expect(result).toEqual({ verdict: 'forfeit_active', forfeited: 'f1' })
  })
  test('OWNERSHIP GUARD: a foreign live fight fires ZERO forfeits', async () => {
    const { forfeits, effects } = recording_effects()
    const result = await run_fight_recovery(state([fight('f9', 'active', [OTHER])]), effects)
    expect(forfeits.size).toBe(0)
    expect(result.forfeited).toBeNull()
  })
  test('no fight → ZERO forfeits (idempotent no-op)', async () => {
    const { forfeits, effects } = recording_effects()
    await run_fight_recovery(state([]), effects)
    expect(forfeits.size).toBe(0)
  })
  test('a terminal-unclaimed fight → ZERO forfeits (the D767 claim owns it, not the forfeit door)', async () => {
    const { forfeits, effects } = recording_effects()
    await run_fight_recovery(state([fight('f2', 'defeat', [FIXTURE])]), effects)
    expect(forfeits.size).toBe(0)
  })
})
