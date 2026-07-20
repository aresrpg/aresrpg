// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// recap-truth lane leg① — STORE-LEVEL pin for the fight-duration source. dungeon_run_store.js itself pulls the
// whole SDK/auth/i18n/game-store graph (unloadable headless — same class documented atop dungeon_settlement.test.js),
// so this mirrors the store's bind-time field-setting 1:1 (every `set({ fight_started_at_ms, fight_start_partial })`
// call site, dungeon_run_store.js) and feeds the REAL open_fight_recap one-liner + the REAL fight_recap_payload
// (fight_recap.js — a genuine leaf, zero heavy deps, safe to import) through it. Before this lane, the store held
// NO fight_started_at_ms field at all: a get().fight_started_at_ms read came back `undefined`, and the old 2-arg
// open_fight_recap(winner, xp) never threaded a duration_ms source through at all — the card rendered no duration
// (fight_recap_payload's own `duration_ms = 0` default). This file pins the FIXED contract: bind → settle → a
// POSITIVE duration_ms reaches the recap payload, honestly floored/flagged when the bind was a late observation.
import { describe, expect, it } from 'bun:test'

import { fight_recap_payload } from './fight_recap.js'

const ME = '0xME'

/** The engine_view fighters Map shape (project.js): players team 0, mobs team 1. */
const fighters = (rows) => new Map(rows.map((f) => [f.id, f]))

const razkin_win = () =>
  fighters([
    { id: 'seat-0', name: 'wanderer', team: 0, level: 12, is_player: true, dead: false, owner: ME },
    { id: 'mob-0', name: 'Razkin', team: 1, level: 8, is_player: false, dead: true },
  ])

/**
 * Mirror of open_fight_recap's ONE local-clock computation (dungeon_run_store.js): a pure function of the
 * store's OWN captured fight_started_at_ms/fight_start_partial (never a chain timestamp — fight.move's
 * spawned_at_ms is consumed transiently for aged_bp, never stored) + "now". `now` is injected so the test is
 * deterministic (no real-clock sleep needed) — the real call site uses Date.now() at both the bind AND the
 * settle side.
 * @param {{ fight_started_at_ms: number | null, fight_start_partial: boolean }} state
 * @param {number} now
 * @returns {{ duration_ms: number, duration_partial: boolean }}
 */
function recap_duration_of(state, now) {
  return {
    duration_ms: state.fight_started_at_ms ? now - state.fight_started_at_ms : 0,
    duration_partial: state.fight_start_partial,
  }
}

// Mirrors of the store's own bind-time set() payloads (dungeon_run_store.js) — one per real call site.
const fresh_mint_bind = (bind_now) => ({ fight_started_at_ms: bind_now, fight_start_partial: false }) // engage click (start_when_ready)
const fresh_join_bind = (bind_now) => ({ fight_started_at_ms: bind_now, fight_start_partial: false }) // join_shared_dungeon
const resume_bind = (bind_now, has_live_fight) => ({
  fight_started_at_ms: has_live_fight ? bind_now : null,
  fight_start_partial: !!has_live_fight,
}) // resume_dungeon
const poll_adopt_bind = (bind_now) => ({ fight_started_at_ms: bind_now, fight_start_partial: true }) // co-op poll-ADOPT
const never_bound = () => ({ fight_started_at_ms: null, fight_start_partial: false }) // pre-lane shape: the field never existed

describe('recap duration — store-level bind → settle contract (recap-truth lane leg①)', () => {
  it('RED-FIRST: bind (fresh engage) → settle 45s later → the recap payload carries a POSITIVE duration_ms (pre-lane: no field existed, get().fight_started_at_ms was undefined)', () => {
    const bind_at = 1_000_000
    const state = fresh_mint_bind(bind_at)
    const { duration_ms, duration_partial } = recap_duration_of(state, bind_at + 45_000)
    const { summary } = fight_recap_payload({
      fighters: razkin_win(),
      my_addr: ME,
      winner: 0,
      duration_ms,
      duration_partial,
    })
    expect(summary.duration_ms).toBe(45_000)
    expect(summary.duration_partial).toBe(false) // MY OWN gesture — exact, never a floor
  })

  it('a fresh JOIN gesture is equally exact (not just mint) — same turn-zero contract', () => {
    const bind_at = 2_000_000
    const state = fresh_join_bind(bind_at)
    const { duration_ms, duration_partial } = recap_duration_of(state, bind_at + 12_000)
    expect(duration_ms).toBe(12_000)
    expect(duration_partial).toBe(false)
  })

  it('never bound (no engage/join/resume/adopt ever captured a clock — the pre-lane shape) → an honest 0, never a crash/NaN', () => {
    const state = never_bound()
    const { duration_ms } = recap_duration_of(state, 1_045_000)
    const { summary } = fight_recap_payload({ fighters: razkin_win(), my_addr: ME, winner: 0, duration_ms })
    expect(duration_ms).toBe(0)
    expect(summary.duration_ms).toBe(0) // the card renders no duration rather than a fake one
  })

  it('resume WITHOUT a live fight (roaming, no fight to adopt) captures nothing — the NEXT fresh engage will', () => {
    const state = resume_bind(1_000_000, false)
    expect(state.fight_started_at_ms).toBe(null)
    expect(recap_duration_of(state, 1_500_000).duration_ms).toBe(0)
  })

  it('resume WITH an already-live fight (late local observation) captures a FLOOR, flagged partial', () => {
    const bind_at = 1_000_000
    const state = resume_bind(bind_at, true)
    const { duration_ms, duration_partial } = recap_duration_of(state, bind_at + 10_000)
    const { summary } = fight_recap_payload({
      fighters: razkin_win(),
      my_addr: ME,
      winner: 0,
      duration_ms,
      duration_partial,
    })
    expect(summary.duration_ms).toBe(10_000) // a FLOOR — turns before this client observed it are invisible
    expect(summary.duration_partial).toBe(true) // the card renders "~0:10", never false precision
  })

  it('poll-adopt (co-op discovers an already-live teammate fight) is ALSO a floor, flagged partial', () => {
    const bind_at = 1_000_000
    const state = poll_adopt_bind(bind_at)
    const { duration_ms, duration_partial } = recap_duration_of(state, bind_at + 5_000)
    expect(duration_ms).toBe(5_000)
    expect(duration_partial).toBe(true)
  })

  it('a defeat (abandon mid-fight) threads the SAME bind through open_fight_recap(get, 1, 0) — duration is outcome-agnostic', () => {
    const bind_at = 3_000_000
    const state = fresh_mint_bind(bind_at)
    const { duration_ms, duration_partial } = recap_duration_of(state, bind_at + 20_000)
    const { summary, won } = fight_recap_payload({
      fighters: razkin_win(),
      my_addr: ME,
      winner: 1,
      xp: 0,
      duration_ms,
      duration_partial,
    })
    expect(won).toBe(false)
    expect(summary.duration_ms).toBe(20_000)
    expect(summary.duration_partial).toBe(false)
  })
})
