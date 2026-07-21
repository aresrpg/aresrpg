// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WAVE A — the ALGEBRA PROPERTIES (BLANKPAGE_RECONCILIATION §⑤ classes 1/2/6 + SEAT_DERIVATION §4 T-B), the
// written specs this wave implements (not my own semantics). They exercise the reducer through the ONE store door
// and assert the commutative-fold guarantees: monotonic-idempotence, retirement-permanence, fold-catch-up, and
// the T-B bar (receipt idempotence · stale-snapshot no-op · death permanence · provider refusal). Wired into
// `bun test packages/fight` so the reachability tooth reaches them.

import { describe, expect, test } from 'bun:test'

import { state_hash } from './inputs.js'
import { apply_retirement, committed_state } from './fold.js'
import { create_fight_store } from './store.js'
import { engine_view } from './project.js'
import { encode } from './los.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const ev = (kind, json) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...json } })

/** A fight OBJECT with one seat + one mob at the given hp/cell; turn_ptr picks who is active (0=me, 1=mob). */
const fight_object = ({
  mob_hp = 20,
  mob_cell = encode(5, 4),
  my_hp = 50,
  my_cell = encode(2, 2),
  turn_ptr = 0,
} = {}) => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      hp: my_hp,
      max_hp: 50,
      cell: my_cell,
      ready: true,
    },
  ],
  mobs: [{ template: '0xabc', hp: mob_hp, max_hp: 20, cell: mob_cell, ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr,
  turn_deadline_ms: 90_000,
})

const boot = (opts) => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } } })
  store.getState().input({ type: 'snapshot', fight: fight_object(opts), version: 5 }, 1_000)
  return store
}
const drain = (store, now) => {
  for (const t of [...store.getState().wave]) store.getState().input({ type: 'presented', seq: t.seq }, now)
}
const mob0 = (store) => engine_view(store.getState()).fighters.get('mob-0')

// ── CLASS 1 — MONOTONIC-IDEMPOTENCE ──────────────────────────────────────────────────────────────────────────
describe('§⑤.1 monotonic-idempotence', () => {
  test('a snapshot at v ≤ canonical_version is a no-op (reduce(S, snapshot(v)) === S)', () => {
    const store = boot()
    store.getState().input(
      {
        type: 'receipt',
        fight_id: FIGHT,
        version: 6,
        receipt: { events: [ev('MobMoved', { idx: 0, to_cell: encode(6, 4) })] },
      },
      2_000
    )
    drain(store, 2_100)
    const before = state_hash(store.getState())
    // every stale/equal-version object read is inert — below-floor (v3, v5) AND equal-version (v6), any content.
    store.getState().input({ type: 'snapshot', fight: fight_object({ mob_cell: encode(1, 1) }), version: 3 }, 2_200)
    store.getState().input({ type: 'snapshot', fight: fight_object({ mob_cell: encode(9, 9) }), version: 5 }, 2_300)
    store.getState().input({ type: 'snapshot', fight: fight_object({ mob_cell: encode(1, 1) }), version: 6 }, 2_400)
    expect(state_hash(store.getState()), 'no field moved below its floor — the stale/equal reads are inert').toBe(
      before
    )
  })

  test('delivery order cannot alter the terminal state (commutative fold under floors)', () => {
    const started = { events: [ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 5 })] }
    const hit = { events: [ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 9, remaining_hp: 30 })] }
    const stale = fight_object({ mob_cell: encode(1, 1) }) // a below-floor snapshot, must stay inert in any order
    const drive = (steps) => {
      const store = create_fight_store()
      store.getState().input({
        type: 'init',
        fight_id: FIGHT,
        my_key: 'p0',
        ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
      })
      store.getState().input({ type: 'snapshot', fight: fight_object(), version: 5 }, 1_000)
      for (const step of steps) store.getState().input(step, 2_000)
      return state_hash(store.getState())
    }
    const A = drive([
      { type: 'receipt', fight_id: FIGHT, version: 7, receipt: hit },
      { type: 'receipt', fight_id: FIGHT, version: 6, receipt: started },
      { type: 'snapshot', fight: stale, version: 4 },
    ])
    const B = drive([
      { type: 'snapshot', fight: stale, version: 4 },
      { type: 'receipt', fight_id: FIGHT, version: 6, receipt: started },
      { type: 'receipt', fight_id: FIGHT, version: 7, receipt: hit },
    ])
    expect(A).toBe(B)
  })
})

// ── CLASS 2 — RETIREMENT-PERMANENCE ──────────────────────────────────────────────────────────────────────────
describe('§⑤.2 retirement-permanence', () => {
  test('death@vD held ⇒ no snapshot sequence (vD-1 / vD / vD+3, positive hp) + stale foreign event resurrects it', () => {
    const store = boot()
    store.getState().input(
      {
        type: 'receipt',
        fight_id: FIGHT,
        version: 6,
        receipt: { events: [ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 20, remaining_hp: 0 })] },
      },
      2_000
    )
    drain(store, 2_100)
    expect(mob0(store).committed_dead).toBe(true)
    // hammer it with every resurrection vector: a stale read below the floor, an equal-version read, a genuinely
    // NEWER read carrying the mob ALIVE at full hp, and a stale foreign move event — none may bring it back.
    store.getState().input({ type: 'snapshot', fight: fight_object({ mob_hp: 20 }), version: 5 }, 2_200)
    store.getState().input({ type: 'snapshot', fight: fight_object({ mob_hp: 20 }), version: 6 }, 2_300)
    store.getState().input({ type: 'snapshot', fight: fight_object({ mob_hp: 20 }), version: 9 }, 2_400) // vD+3, positive hp
    store.getState().input(
      {
        type: 'poll',
        fight_id: FIGHT,
        version: 4,
        receipt: { events: [ev('MobMoved', { idx: 0, to_cell: encode(7, 4) })] },
      },
      2_500
    )
    expect(mob0(store).committed_dead, 'a floored death is permanent against every stale/newer/foreign input').toBe(
      true
    )
    expect(mob0(store).committed_alive).toBe(false)
  })

  test('trap: detonate@vD then re-lay@vL>vD has zero cross-talk (independent records)', () => {
    const store = boot()
    const TRAP_A = encode(9, 5)
    const TRAP_B = encode(3, 8)
    store.getState().input(
      {
        type: 'predicted',
        basis_version: 6,
        intent_id: 'trapA',
        actions: [{ kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: TRAP_A, ap_cost: 2 }],
        beats: [{ kind: 'cast', at: 0, duration: 100, payload: {} }],
        place_traps: [TRAP_A],
      },
      1_100
    )
    // detonate A: a committed fighter lands on it (vD = 7).
    store.getState().input(
      {
        type: 'receipt',
        fight_id: FIGHT,
        version: 7,
        receipt: { events: [ev('MobMoved', { idx: 0, to_cell: TRAP_A })] },
      },
      1_200
    )
    drain(store, 1_300)
    expect(engine_view(store.getState()).my_traps, 'A detonated → gone').toEqual([])
    // re-lay B at vL>vD on a different cell — a NEW record; the old detonation must not touch it.
    store.getState().input(
      {
        type: 'predicted',
        basis_version: 8,
        intent_id: 'trapB',
        actions: [{ kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: TRAP_B, ap_cost: 2 }],
        beats: [{ kind: 'cast', at: 0, duration: 100, payload: {} }],
        place_traps: [TRAP_B],
      },
      1_400
    )
    expect(engine_view(store.getState()).my_traps, 'B is live; A stays gone — zero cross-talk').toEqual([TRAP_B])
  })
})

// ── apply_retirement — L-I2 FRESH-MAP-BY-CONSTRUCTION (codeql boundary-mutation 90b4dd91) ─────────────────────
// The clamp returns a FRESH map (the caller's `fighters` is never written), and the two documented no-ops —
// nothing retired, and every retired key already dead — return the SAME reference (the identity downstream ===
// checks in recompute/committed_state lean on). Direct-function rows: nothing else asserts these contracts.
describe('apply_retirement — fresh-map-by-construction + identity no-op', () => {
  const fighters = { m0: { key: 'm0', alive: true, hp: 12 }, p0: { key: 'p0', alive: true, hp: 30 } }
  test('nothing retired ({}) returns the SAME reference (identity no-op)', () => {
    expect(apply_retirement(fighters, {})).toBe(fighters)
  })
  test('every retired key already dead returns the SAME reference (identity no-op)', () => {
    const dead = { m0: { key: 'm0', alive: false, hp: 0 }, p0: { key: 'p0', alive: true, hp: 30 } }
    expect(apply_retirement(dead, { m0: 6 })).toBe(dead)
  })
  test('a retired-but-alive fighter clamps to 0/dead in a FRESH map (caller untouched)', () => {
    const out = apply_retirement(fighters, { m0: 6 })
    expect(out).not.toBe(fighters) // fresh object by construction — no boundary mutation of the parameter
    expect(out.m0).toEqual({ key: 'm0', alive: false, hp: 0 })
    expect(fighters.m0).toEqual({ key: 'm0', alive: true, hp: 12 }) // the caller's value stays intact
    expect(out.p0).toBe(fighters.p0) // an untouched fighter keeps identity (shallow copy)
    // null/undefined hp passes through untouched — only positive hp clamps to 0
    const null_hp = { m0: { key: 'm0', alive: true, hp: null } }
    expect(apply_retirement(null_hp, { m0: 6 }).m0).toEqual({ key: 'm0', alive: false, hp: null })
  })
})

// ── CLASS 6 — FOLD-CATCH-UP ──────────────────────────────────────────────────────────────────────────────────
describe('§⑤.6 fold-catch-up', () => {
  test('a top-version-only read reconstructs the same terminal board as replaying all K turns (no resurrection)', () => {
    // Path A — replay all K turns: mob moves (v6), is hit to 5 (v7), dies (v8).
    const replay = create_fight_store()
    replay
      .getState()
      .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } } })
    replay.getState().input({ type: 'snapshot', fight: fight_object(), version: 5 }, 1_000)
    replay.getState().input(
      {
        type: 'receipt',
        fight_id: FIGHT,
        version: 6,
        receipt: { events: [ev('MobMoved', { idx: 0, to_cell: encode(6, 4) })] },
      },
      1_100
    )
    replay.getState().input(
      {
        type: 'receipt',
        fight_id: FIGHT,
        version: 7,
        receipt: { events: [ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 15, remaining_hp: 5 })] },
      },
      1_200
    )
    replay.getState().input(
      {
        type: 'receipt',
        fight_id: FIGHT,
        version: 8,
        receipt: { events: [ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 5, remaining_hp: 0 })] },
      },
      1_300
    )
    for (const t of [...replay.getState().wave]) replay.getState().input({ type: 'presented', seq: t.seq }, 1_400)

    // Path B — CATCH-UP through the ONE door (M2b): a client that bootstrapped at v5 catches the terminal up from
    // the journal/receipt (the mob's move + killing hit), never a re-adopted top-version object read.
    const folded = create_fight_store()
    folded
      .getState()
      .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } } })
    folded.getState().input({ type: 'snapshot', fight: fight_object(), version: 5 }, 1_000)
    folded.getState().input(
      {
        type: 'receipt',
        version: 8,
        receipt: {
          events: [
            ev('MobMoved', { idx: 0, to_cell: encode(6, 4) }),
            ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 20, remaining_hp: 0 }),
          ],
        },
      },
      1_100
    )
    // an out-of-order INTERMEDIATE stale OBJECT read (mob alive, v7) is now an inert checkpoint — it must NOT
    // resurrect the dead mob (no flicker); canonical death is the receipt-folded floor, structurally.
    folded
      .getState()
      .input({ type: 'snapshot', fight: fight_object({ mob_hp: 5, mob_cell: encode(6, 4) }), version: 7 }, 1_150)

    const term = (store) => {
      const m = committed_state(store.getState()).fighters.m0
      return { cell: m.cell, alive: m.alive, hp: m.hp }
    }
    expect(term(folded), 'top-version fold == full replay terminal').toEqual(term(replay))
    expect(term(folded).alive).toBe(false)
  })
})

// ── SEAT §4 T-B ──────────────────────────────────────────────────────────────────────────────────────────────
describe('§4 T-B — receipt idempotence · stale no-op · death permanence · provider refusal', () => {
  test('receipt idempotence: a re-delivered receipt does not change committed state', () => {
    const store = boot()
    const r = {
      type: 'receipt',
      fight_id: FIGHT,
      version: 6,
      receipt: { events: [ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 5, remaining_hp: 15 })] },
    }
    store.getState().input(r, 2_000)
    drain(store, 2_100)
    const once = state_hash(store.getState())
    store.getState().input(r, 2_200) // exact re-delivery (reconnect catch-up)
    expect(state_hash(store.getState()), 'the same (version,event_idx) keys fold idempotently').toBe(once)
  })

  test('provider refusal: a local push while NOT my turn is refused + logged, state unchanged', () => {
    const store = boot({ turn_ptr: 1 }) // the MOB is active → provider is idle_wait, not local_turn
    expect(store.getState().provider).toBe('idle_wait')
    const before = state_hash(store.getState())
    store
      .getState()
      .input({ type: 'intent', intent: { kind: 'cast', target_cell: encode(5, 4), damaging: true } }, 2_000)
    expect(store.getState().refused, 'a mismatched-provenance local push is a logged non-event').toMatchObject({
      type: 'intent',
      reason: 'provider',
    })
    expect(state_hash(store.getState()), 'the refused push never touched fight state').toBe(before)
  })
})
