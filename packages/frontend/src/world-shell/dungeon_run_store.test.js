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
//
// leg② (issue #241 — "duration renders 0:00 on a normal fight" reopened this): fight_started_at_ms is bind
// bookkeeping OWNED BY THIS STORE — any caller that sets a live `fight_id` WITHOUT going through this store's own
// start/join/resume/poll-adopt doors (dev_synth_fight.js's use_dungeon.setState({ fight_id, ... }) is the one
// confirmed case: it never stamps fight_started_at_ms — see the omission at its own setState call) leaves the
// field null and the card rendered 0:00 with no fallback. open_fight_recap now falls back to
// fight_opened_at(fight_id) — the fight's OWN 'init' entry in trace_tap.js's reducer-door recording, which every
// caller crosses unconditionally (init_dungeon_fight → fight_store.input({type:'init',...}) → tap_trace_input),
// bind-bookkeeping or not. earliest_input_at's own real-code contract is pinned directly in
// packages/fight/src/trace_recorder.test.js (a genuine leaf import, safe to load for real — unlike this store).
import { describe, expect, it } from 'bun:test'
// The REAL trace_tap module (a genuine leaf, same import FightReport.test.jsx already uses) — tap_trace_input
// seeds its module-singleton ring exactly like fight_store's make_input door does, so fight_opened_at below is
// exercised for real, not mirrored. _reset_trace_for_test isolates each test from the others (module-singleton).
import { tap_trace_input, fight_opened_at, _reset_trace_for_test } from '@aresrpg/fight/trace_tap'

import { fight_recap_payload } from './fight_recap.js'

const anchors = { applied_version: -1, view_version: -1, receipt_seq: 0 }

const ME = '0xME'

/** The engine_view fighters Map shape (project.js): players team 0, mobs team 1. */
const fighters = (rows) => new Map(rows.map((f) => [f.id, f]))

const razkin_win = () =>
  fighters([
    { id: 'seat-0', name: 'wanderer', team: 0, level: 12, is_player: true, dead: false, owner: ME },
    { id: 'mob-0', name: 'Razkin', team: 1, level: 8, is_player: false, dead: true },
  ])

/**
 * Mirror of open_fight_recap's local-clock computation (dungeon_run_store.js): a pure function of the store's
 * OWN captured fight_started_at_ms/fight_start_partial (never a chain timestamp — fight.move's spawned_at_ms is
 * consumed transiently for aged_bp, never stored) + "now", falling back to the REAL fight_opened_at(fight_id)
 * (leg②, issue #241) when the store's own bind bookkeeping is empty. `now` is injected so the test is
 * deterministic (no real-clock sleep needed) — the real call site uses Date.now() at both the bind AND the
 * settle side.
 * @param {{ fight_id?: string | null, fight_started_at_ms: number | null, fight_start_partial: boolean }} state
 * @param {number} now
 * @returns {{ duration_ms: number, duration_partial: boolean }}
 */
function recap_duration_of(state, now) {
  const started_at = state.fight_started_at_ms ?? (state.fight_id ? fight_opened_at(state.fight_id) : null)
  return {
    duration_ms: started_at ? now - started_at : 0,
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

describe('recap duration — trace-tap fallback (recap-truth lane leg②, issue #241)', () => {
  it("RED-FIRST: fight_started_at_ms never bound (dev_synth_fight.js shape — a live fight_id set without going through this store's own bind doors), but the fight DID cross the reducer door → duration derives from its recorded init, not 0", () => {
    _reset_trace_for_test()
    const fight_id = '0xleg2-fresh'
    tap_trace_input({ fight_id: null, ...anchors }, { type: 'init', fight_id }, 1_000_000)
    const state = { ...never_bound(), fight_id }
    const { duration_ms, duration_partial } = recap_duration_of(state, 1_000_000 + 30_000)
    const { summary } = fight_recap_payload({
      fighters: razkin_win(),
      my_addr: ME,
      winner: 0,
      duration_ms,
      duration_partial,
    })
    expect(summary.duration_ms).toBe(30_000) // NOT 0 — pre-fix this was a hardcoded 0:00
    expect(summary.duration_partial).toBe(false) // fight_start_partial is still whatever this store's OWN state says
  })

  it("the store's own bind bookkeeping still wins when BOTH exist — trace-tap is a fallback, never a second source of truth", () => {
    _reset_trace_for_test()
    const fight_id = '0xleg2-both'
    tap_trace_input({ fight_id: null, ...anchors }, { type: 'init', fight_id }, 500_000) // the trace's own (different) anchor
    const state = fresh_mint_bind(1_000_000) // the store's OWN bind — later than the trace anchor
    const { duration_ms } = recap_duration_of({ ...state, fight_id }, 1_000_000 + 45_000)
    expect(duration_ms).toBe(45_000) // from fight_started_at_ms (1_000_000), NOT the trace's 500_000
  })

  it('neither source has it (trace ring evicted the init too, or nothing was ever captured) → still an honest 0, never a crash', () => {
    _reset_trace_for_test()
    const state = { ...never_bound(), fight_id: '0xleg2-nothing-captured' }
    expect(recap_duration_of(state, 2_000_000).duration_ms).toBe(0)
  })

  it('a re-init (resume) recorded in the trace supersedes its own earlier attempt — mirrors dump_trace/earliest_input_at scoping', () => {
    _reset_trace_for_test()
    const fight_id = '0xleg2-reinit'
    tap_trace_input({ fight_id: null, ...anchors }, { type: 'init', fight_id }, 100)
    tap_trace_input({ fight_id, ...anchors }, { type: 'tick' }, 200)
    tap_trace_input({ fight_id: null, ...anchors }, { type: 'init', fight_id }, 900) // resume/re-init
    const state = { ...never_bound(), fight_id }
    expect(recap_duration_of(state, 900 + 15_000).duration_ms).toBe(15_000)
  })
})
