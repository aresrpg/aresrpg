// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2099 — THE HANDOVER CLOCK LEARNS CHAIN TIME.
//
// `turn_handover_at` returns a CHAIN timestamp (`deadline − turn_ms`, stamped by turns.move `resolve_from` off
// the Sui Clock). Since #1808 the fold compares it to a raw client `Date.now()` and that comparison gates the
// ENTIRE input layer — so a client whose clock is skewed against the chain silently loses exactly its skew from
// every turn, behind a bare Waiting state, with no copy left to explain it.
//
// THE OBSERVED PAIR: a live journal page carries `chain_now_ms` (the indexer's latest checkpoint timestamp,
// packages/rpc/api/views.js `handle_fight_events`). Folded against that message's own arrival instant it yields
// `chain_now ≈ Date.now() + offset` — an INPUT through the one reducer door, never a module global, re-observed
// (rolling max) on every page.
//
// Both error terms in a sample (indexer lag, network latency) are non-negative, so a sample is always a LOWER
// bound on the true offset and the rolling max converges from BELOW: the handover can only ever fire late, never
// early. That is deliberate — over-correcting would hand the turn over while the chain is still resolving mobs,
// which is exactly the bug #1808 fixed.

import { beforeEach, describe, expect, test } from 'bun:test'

import { fight_store } from '../src/store.js'
import { fold_chain_offset } from '../src/draft_budget.js'
import { normalize_journal_page } from '../src/journal_normalize.js'

const ME = '0xme'
const FIGHT = '0xf1'
const TURN_MS = 45_000
const MOB_RESOLVE_MS = 3_000 // turns.move MOB_TURN_EXTRA_MS: `deadline = now + turn_ms + 3s × resolved mobs`
const MOBS = 4 // mobs the chain replayed before landing my turn — and the roster really holds four (see below)

// THE CHAIN's own clock. Every chain fact below is stamped in THIS frame; the client's frame is `local()`.
const CHAIN_T0 = 1_700_000_000_000
// The chain instant my turn genuinely becomes mine — `deadline − turn_ms`, the widened mob-resolution budget spent.
const CHAIN_HANDOVER = CHAIN_T0 + MOBS * MOB_RESOLVE_MS

/** The client's wall clock at chain instant `chain`, for a client skewed by `skew` ms (+ = ahead of the chain). */
const local_at = (chain, skew) => chain + skew

/**
 * Seed a live turn of mine that the chain opened at CHAIN_T0 having replayed `MOBS` mobs, observed by a client
 * whose clock is off by `skew`. The roster genuinely holds MOBS mobs and the queue interleaves them: a fixture
 * whose `mobs_replayed` outruns its own roster is not a fight the chain can produce (see the note in
 * turn_handover.test.js — it seeds 4 replayed mobs against a 1-mob roster).
 */
const seed_turn = (skew) => {
  const store = fight_store
  store.getState().input({ type: 'init', fight_id: null })
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: ME, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input(
    {
      type: 'snapshot',
      version: 1,
      fight: {
        id: FIGHT,
        status: 1,
        width: 20,
        height: 19,
        participants: [
          {
            owner: '0xaaa',
            character: ME,
            class: 'senshi',
            team: 0,
            ap: 6,
            mp: 3,
            base_ap: 6,
            base_mp: 3,
            hp: 50,
            max_hp: 50,
            cell: 100,
            ready: false,
          },
        ],
        mobs: Array.from({ length: MOBS }, (_, i) => ({
          template: '0xabc',
          hp: 30,
          max_hp: 30,
          cell: 105 + i,
          ap: 4,
          mp: 3,
          level: 1,
        })),
        queue: [{ is_mob: false, idx: 0 }, ...Array.from({ length: MOBS }, (_, i) => ({ is_mob: true, idx: i }))],
        turn_ptr: 0,
        turn_ms: TURN_MS,
        turn_deadline_ms: CHAIN_T0 + TURN_MS + MOBS * MOB_RESOLVE_MS,
        turn_entropy: 0,
        turn_ordinal: 0,
        placement_deadline_ms: 0,
        start_cells_a: [],
        start_cells_b: [],
        invisibility_statuses: [],
      },
    },
    local_at(CHAIN_T0, skew)
  )
  return store
}

/** Deliver a live journal page stamped with the server's checkpoint clock, observed at its true local arrival. */
const observe_chain_clock = (store, { chain_now_ms, skew, latency_ms = 0 }) =>
  store.getState().input(
    {
      type: 'journal',
      fight_id: FIGHT,
      // The REAL wire shape: exactly what `/v1/fights/{id}/events` serves for a live page, through the one
      // normalizer both transports (walker + SSE) share.
      batch: normalize_journal_page({ fight: FIGHT, events: [], journal_head: 0, chain_now_ms }, { fight_id: FIGHT }),
    },
    local_at(chain_now_ms, skew) + latency_ms
  )

beforeEach(() => fight_store.getState().input({ type: 'init', fight_id: null }))

describe('#2099 — the handover fires at the chain-true instant, whatever the client clock says', () => {
  // The two skew directions, plus the zero-skew control. `skew` is the client's error: + = the client's clock
  // runs AHEAD of the chain (it would hand the turn over early), − = BEHIND (it withholds the turn — the
  // reported symptom: the delta is lost every turn behind a bare Waiting state).
  for (const [name, skew] of [
    ['+8s — the client clock runs AHEAD of the chain', 8_000],
    ['−8s — the client clock runs BEHIND the chain', -8_000],
    ['zero skew — the control: nothing moves', 0],
  ]) {
    test(name, () => {
      const store = seed_turn(skew)
      expect(store.getState().turn_playable, 'seeded mid mob-resolution — never playable yet').toBe(false)

      // A live page lands well before the handover, carrying the chain's own clock. This is the ONLY new fact.
      observe_chain_clock(store, { chain_now_ms: CHAIN_T0 + MOB_RESOLVE_MS, skew })
      expect(store.getState().chain_offset_ms, 'the observed pair resolves the client’s error exactly').toBe(0 - skew)

      // THE CHAIN-TRUE MOMENT, expressed on the client's own skewed clock.
      const fires_at = local_at(CHAIN_HANDOVER, skew)

      store.getState().input({ type: 'tick' }, fires_at - 1)
      expect(store.getState().turn_playable, 'one ms before the chain’s own instant is still not my turn').toBe(false)

      store.getState().input({ type: 'tick' }, fires_at)
      expect(store.getState().turn_playable, 'the chain handed it over — hand it over here too').toBe(true)
      expect(store.getState().turn_started_at, 'the anchor stamps in the client’s frame, unshifted').toBe(fires_at)
    })
  }

  test('the skew is what moves the handover: uncorrected, it fires exactly `skew` off the chain-true moment', () => {
    // The bug, stated as arithmetic. With no offset folded (no page has carried `chain_now_ms`), the fold
    // compares a chain instant to a raw client clock, so the handover lands at local `CHAIN_HANDOVER` while the
    // chain-true local moment is `CHAIN_HANDOVER + skew` — a miss of exactly the skew, every turn.
    const skew = -8_000
    const store = seed_turn(skew)
    expect(store.getState().chain_offset_ms, 'nothing observed ⇒ no correction, today’s exact behaviour').toBe(null)

    store.getState().input({ type: 'tick' }, CHAIN_HANDOVER)
    expect(store.getState().turn_playable, 'the uncorrected clock fires on the CHAIN number, not the local one').toBe(
      true
    )
    // THE LOST DELTA, measured: the chain-true moment on this client's clock is `CHAIN_HANDOVER + skew`, and the
    // uncorrected fold withheld the turn until local `CHAIN_HANDOVER` — 8 extra seconds of Waiting, every turn.
    expect(store.getState().turn_started_at - local_at(CHAIN_HANDOVER, skew)).toBe(-skew)
  })
})

describe('#2099 — the offset estimator only ever converges from below', () => {
  test('rolling MAX over observations; a lower-latency sample refines it, a slower one never drags it back', () => {
    // Sample = offset − (indexer lag + network latency): both non-negative, so every sample UNDER-states the
    // offset and the best (largest) one is the closest to truth.
    const laggy = fold_chain_offset(null, 1_000_000, 1_005_000) // 5s of lag/latency ⇒ −5000
    expect(laggy).toBe(-5_000)
    const fresh = fold_chain_offset(laggy, 1_010_000, 1_010_200) // 200ms ⇒ −200, much closer to the truth
    expect(fresh).toBe(-200)
    expect(fold_chain_offset(fresh, 1_020_000, 1_026_000), 'a slow page never un-learns a fast one').toBe(-200)
  })

  test('an unobserved clock stays null — an old server, or a cached immutable page, corrects nothing', () => {
    expect(fold_chain_offset(null, undefined, 1_000_000)).toBe(null)
    expect(fold_chain_offset(null, null, 1_000_000)).toBe(null)
    expect(fold_chain_offset(null, 0, 1_000_000)).toBe(null)
    expect(fold_chain_offset(-200, 'nonsense', 1_000_000), 'garbage never displaces a real observation').toBe(-200)
    expect(fold_chain_offset(-200, 1_000_000, Number.NaN)).toBe(-200)
  })

  test('the normalizer carries the server clock through, and its absence as an honest null', () => {
    const page = { fight: FIGHT, events: [], journal_head: 3, chain_now_ms: 1_700_000_000_000 }
    expect(normalize_journal_page(page, { fight_id: FIGHT }).chain_now_ms).toBe(1_700_000_000_000)
    expect(normalize_journal_page({ fight: FIGHT, events: [], journal_head: 3 }).chain_now_ms).toBe(null)
  })
})
