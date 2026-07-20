// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import CEREMONY_MANIFEST from '../../move/scripts/out/ceremony_manifest.json' with { type: 'json' }
import { normalize_chain_spell_corpus } from '../../sim/src/chain_spell_corpus.js'
import * as SE from '../../sim/src/spell_effect.js'
import {
  CORPUS,
  ENEMY_CELL,
  MATRIX_ARENA,
  fresh_state,
  run_matrix,
  single_effect_spell,
} from '../../sim/test/spell_effect_conformance_matrix.js'
import { find_entity } from '../../sim/src/fight_state.js'

import {
  CHAIN_PENDING,
  CHAIN_PENDING_ENGINE_VERSION,
  chain_critical,
  evolve_flush_casts,
  predict_sim_cast,
} from './predict_cast.js'
import { encode } from './los.js'
import { create_fight_store, display_state, presented_state } from './store.js'
import { apply_action, empty_state } from './inputs.js'
import { base_from_view } from './fold.js'
import { engine_view, move_wash } from './project.js'
import { STATUS_ACTIVE } from './board_state.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const START = encode(2, 4)
const DEST = encode(6, 6)
const NOW = 10_000
const B7_KINDS = [10, 15, 16, 17, 22, 25, 26, 29]

const fight_object = (caster_cell) => ({
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
      ap: 99,
      mp: 20,
      base_ap: 99,
      base_mp: 20,
      hp: 120,
      max_hp: 200,
      cell: caster_cell,
    },
  ],
  mobs: [{ hp: 200, max_hp: 200, ap: 99, mp: 20, cell: encode(4, 4) }],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 100_000,
  last_action_ms: 0,
})

const started_store = () => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
  store.getState().input({ type: 'snapshot', fight: fight_object(START), version: 5 }, NOW)
  return store
}

const predict_effect = (raw, target = ENEMY_CELL) => {
  const normalized = single_effect_spell(`probe_${raw.kind}`, raw, 3, raw.kind === SE.K_TELEPORT)
  const spell =
    raw.chance == null || raw.chance === 100
      ? normalized
      : {
          ...normalized,
          levels: normalized.levels.map((level) => ({
            ...level,
            base_effects: level.base_effects.map((effect) => ({ ...effect, chance: raw.chance })),
          })),
        }
  return predict_sim_cast({
    state: fresh_state(),
    caster_id: 'p0',
    spell,
    spell_level: 1,
    target,
    arena: MATRIX_ARENA,
  })
}

describe('sim-backed own-cast prediction', () => {
  // DESIGN CORRECTION 2026-07-18 19:37: the local sim never needs the chain for teleport effects; a teleport is
  // INSTANT by design (the trajectory law "teleports exactly one jump") — it presents the caster at the landing
  // cell THIS frame in EVERY projection, with NO walk window and NO slide. The predicted Displaced carries the
  // TELEPORT mechanics code (14 — field-identical to the chain's Displaced.kind) so the fold skips the window and
  // the render blinks instead of lerping (the SLIDE-BACK class). Push/pull keep their window (they slide).
  test('teleport paints Cast + an INSTANT self-jump — no walk window, effect_kind tagged', () => {
    const prediction = predict_effect(
      { kind: SE.K_TELEPORT, value: 0, target_filter: SE.TF_ONLY_CASTER, chance: 100 },
      { x: 6, y: 6 }
    )
    expect(prediction instanceof Promise).toBe(false)
    expect(prediction.actions).toEqual([
      { kind: 'cast', target_cell: DEST, damaging: false, ap_cost: 3 },
      { kind: 'Displaced', target_is_mob: false, target_idx: 0, to_cell: DEST, effect_kind: SE.K_TELEPORT },
    ])
    // The render beat is INSTANT: empty path, zero duration, effect_kind carried (a blink, never a lerp).
    const displacement = prediction.beats.find((beat) => beat.kind === 'displacement')
    expect(displacement.duration).toBe(0)
    expect(displacement.payload.path).toEqual([])
    expect(displacement.payload.effect_kind).toBe(SE.K_TELEPORT)

    const store = started_store()
    store.getState().input({
      type: 'predicted',
      intent_id: 'cast:0',
      basis_version: 6,
      actions: prediction.actions,
      beats: prediction.beats,
    })
    expect(store.getState().fighters.p0.cell).toBe(DEST)
    expect(store.getState().fighters.p0.ap).toBe(96)
    // TELEPORT PRESENTATION LANE — the teleport sequences after the vfx, with its own vfx at the target too:
    // a third beat, GATED behind the blink (which is itself gated behind
    // the cast beat's full duration), anchored at the landing cell.
    const wave_beats = store.getState().wave.flatMap((turn) => turn.beats)
    expect(wave_beats.map((beat) => beat.kind)).toEqual(['cast', 'displacement', 'teleport_arrival'])
    const [cast_beat, displacement_beat, arrival_beat] = wave_beats
    expect(displacement_beat.at).toBe(cast_beat.duration) // never before the origin vfx's full duration
    expect(arrival_beat.at).toBeGreaterThanOrEqual(displacement_beat.at + displacement_beat.duration)
    expect(arrival_beat.duration).toBeGreaterThan(0)
    expect(arrival_beat.payload.cell).toEqual(displacement.payload.to) // same landing cell as the blink

    // The caster jumps to the destination THIS FRAME in DISPLAY too — a teleport never holds at the origin (the
    // walk-window is for slides only). The local wave carries NO window: nothing to hold, nothing to wait on.
    expect(display_state(store.getState()).fighters.p0.cell).toBe(DEST)
    expect(presented_state(store.getState()).fighters.p0.cell).toBe(DEST)
    const leg = store.getState().wave.find((t) => t.is_local)
    expect(leg.from_idx == null).toBe(true)

    // RECONCILE: the authoritative read lands the caster at the SAME cell → idempotent match, intents purge, the
    // presented cell never regresses (the reconcile law: same-position discard).
    store.getState().input({ type: 'presented', seq: leg.seq }, NOW + 100)
    store.getState().input({ type: 'snapshot', fight: fight_object(DEST), version: 7 }, NOW + 500)
    expect(store.getState().fighters.p0.cell).toBe(DEST)
    expect(display_state(store.getState()).fighters.p0.cell).toBe(DEST)
    expect(Object.values(store.getState().entries).some((entry) => entry.source === 'intent')).toBe(false)
  })

  test('a deterministic damage effect comes from the sim result and paints one absolute Hit', () => {
    const prediction = predict_effect({
      kind: SE.K_DAMAGE,
      value: 7,
      element: 2,
      target_filter: SE.TF_NOT_TEAM,
      chance: 100,
    })
    expect(prediction.result.success).toBe(true)
    expect(prediction.actions).toEqual([
      { kind: 'cast', target_cell: encode(4, 4), damaging: true, ap_cost: 3 },
      { kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 193 },
    ])
    expect(prediction.beats.some((beat) => beat.kind === 'damage' && beat.payload.damage === 7)).toBe(true)
  })

  test('an unresolved chance branch paints only Cast and waits for the receipt', () => {
    const prediction = predict_effect({
      kind: SE.K_DAMAGE,
      value: 7,
      element: 2,
      target_filter: SE.TF_NOT_TEAM,
      chance: 50,
    })
    expect(prediction.unresolved).toContain('chance')
    expect(prediction.actions).toEqual([{ kind: 'cast', target_cell: encode(4, 4), damaging: false, ap_cost: 3 }])
    expect(prediction.beats.map((beat) => beat.kind)).toEqual(['cast'])
  })

  test('public crit selection swaps the whole authored branch; an unknown branch stays cast-only', () => {
    const raw = CORPUS.find((spell) => spell.id === 'senshi_warcleave')
    const spell = normalize_chain_spell_corpus([raw]).get(raw.id)
    const cast = (critical) =>
      predict_sim_cast({
        state: fresh_state(),
        caster_id: 'p0',
        spell,
        target: ENEMY_CELL,
        arena: MATRIX_ARENA,
        critical,
      })
    const base = cast(false)
    const critical = cast(true)
    const unknown = cast(null)

    expect(base.actions.find((action) => action.kind === 'Hit')?.remaining_hp).toBe(193)
    expect(critical.actions.find((action) => action.kind === 'Hit')?.remaining_hp).toBe(191)
    expect(critical.result.is_critical).toBe(true)
    expect(unknown.unresolved).toContain('critical')
    expect(unknown.actions.map((action) => action.kind)).toEqual(['cast'])
  })

  test('chain_critical mirrors the public turn-seed slot threshold', () => {
    const clock = {
      world_seed: 123456789,
      spawn_id: 42,
      turn_deadline_ms: 1752192000000,
      seat: 0,
    }
    expect(chain_critical({ ...clock, slot: 0 }, 4, 0)).toBe(false)
    expect(chain_critical({ ...clock, slot: 2 }, 4, 0)).toBe(true)
  })
})

describe('⑭ evolve_flush_casts — each cast validated against the chain-evolved sequence, not the optimistic end-state', () => {
  const W = 20
  const enc = (x, y) => y * W + x
  const dec = (c) => ({ x: c % W, y: Math.floor(c / W) })
  const push_spell = single_effect_spell('push', { kind: SE.K_PUSH, value: 5, target_filter: SE.TF_NOT_TEAM }, 3, false)
  const dmg_spell = single_effect_spell(
    'dmg',
    { kind: SE.K_DAMAGE, value: 10, element: 2, target_filter: SE.TF_NOT_TEAM },
    3,
    false
  )
  const view = () => ({
    fight_id: '0xflush',
    arena: { width: W, height: 19, cells: new Uint8Array(W * 19) },
    fighters: new Map([
      [
        'p0',
        {
          id: 'p0',
          cell: dec(enc(5, 5)),
          team: 0,
          health: 120,
          health_max: 200,
          ap: 99,
          ap_max: 99,
          mp: 20,
          mp_max: 20,
          is_player: true,
        },
      ],
      [
        'mob-0',
        {
          id: 'mob-0',
          cell: dec(enc(7, 5)),
          team: 1,
          health: 200,
          health_max: 200,
          ap: 99,
          ap_max: 99,
          mp: 20,
          mp_max: 20,
          is_player: false,
        },
      ],
    ]),
    turn_order: ['p0', 'mob-0'],
    turn_number: 1,
  })
  // committed = the CHAIN base (thin p{seat}/m{idx} keys); the mob sits at its pre-push cell, my optimistic
  // drafts EXCLUDED — the exact state the chain evolves each drafted action against (D99 order).
  const committed = {
    fighters: { p0: { cell: enc(5, 5), hp: 120, alive: true }, m0: { cell: enc(7, 5), hp: 200, alive: true } },
  }

  test('a push then a cast at the landing cell: the 2nd cast sees the mob at its EVOLVED (displaced) cell', () => {
    const evolved = evolve_flush_casts({
      view: view(),
      committed,
      caster_id: 'p0',
      casts: [
        { spell: push_spell, target: enc(7, 5) },
        { spell: dmg_spell, target: enc(12, 5) },
      ],
    })
    // cast 0 (the push) is validated against the COMMITTED board — the mob is still at 7,5, never its own
    // not-yet-applied push — the trap-behind-the-mob failure class: pushed onto it, turn committed without the spell.
    expect(evolved[0].occupied.get(enc(7, 5))).toMatchObject({ kind: 'mob', idx: 0, alive: true })
    expect(evolved[0].occupied.get(enc(12, 5))).toBeUndefined()
    // cast 1 sees the push ALREADY applied: the mob vacated 7,5 and now sits at its full-slide landing 12,5.
    expect(evolved[1].occupied.get(enc(7, 5))).toBeUndefined()
    expect(evolved[1].occupied.get(enc(12, 5))).toMatchObject({ kind: 'mob', idx: 0, alive: true })
  })
})

describe('B7 deployed-chain exclusion boundary', () => {
  test('the exact ruled set is stamped to the currently deployed engine lineage', () => {
    expect([...CHAIN_PENDING].sort((a, b) => a - b)).toEqual(B7_KINDS)
    expect(CHAIN_PENDING_ENGINE_VERSION).toBe(CEREMONY_MANIFEST.engine.latest)
  })

  test('every excluded kind paints Cast but no predicted effect outcome', () => {
    for (const kind of B7_KINDS) {
      const raw = CORPUS.flatMap((spell) => [
        ...(spell.levels?.[0]?.effects ?? []),
        ...(spell.levels?.[0]?.crit_effects ?? []),
      ]).find((effect) => effect.kind === kind)
      expect(raw, `corpus has no witness for kind ${kind}`).toBeTruthy()
      const prediction = predict_effect(raw)
      expect(
        prediction.actions.map((action) => action.kind),
        `kind ${kind}`
      ).toEqual(['cast'])
      expect(prediction.result.effects, `kind ${kind}`).toEqual([])
      expect(
        prediction.beats.map((beat) => beat.kind),
        `kind ${kind}`
      ).toEqual(['cast'])
    }
  })

  test('the reused full-corpus conformance matrix convicts exactly the B7 rows and no shipped kind', () => {
    const sim_matrix = run_matrix()
    const matrix = run_matrix(
      (state, caster_id, spell, spell_level, target) =>
        predict_sim_cast({ state, caster_id, spell, spell_level, target, arena: MATRIX_ARENA }).result,
      normalize_chain_spell_corpus
    )
    const expected_slots = CORPUS.reduce(
      (count, spell) =>
        count +
        [...(spell.levels?.[0]?.effects ?? []), ...(spell.levels?.[0]?.crit_effects ?? [])].filter((effect) =>
          CHAIN_PENDING.has(effect.kind)
        ).length,
      0
    )
    expect(matrix.convictions.filter((row) => !CHAIN_PENDING.has(row.kind))).toEqual(
      sim_matrix.convictions.filter((row) => !CHAIN_PENDING.has(row.kind))
    )
    expect(matrix.convictions).toHaveLength(expected_slots)
    expect([...new Set(matrix.convictions.map((row) => row.kind))].sort((a, b) => a - b)).toEqual(B7_KINDS)
  })
})

// ── ⑤a/⑤b MP GRANT — an invisibility MP grant wasn't rendering on the hud nor on
// the mp blob. give_points raises a pool (Vanish +1 MP) and is CHAIN-SILENT (cast.move:997 → participant.move
// give_points mutates the pool, emits NO event), so the durable truth rides the snapshot while the OPTIMISTIC
// grant must fold NOW. The drain-only diff dropped the increase; the symmetric Granted arm closes both doors. ──
describe('⑤a/⑤b own-cast MP grant folds to both owner surfaces (HUD number + MP blob)', () => {
  const grant_spell = () =>
    single_effect_spell(
      'vanish_mp',
      { kind: SE.K_GIVE_POINTS, value: 1, stat: SE.POINT_MP, target_filter: SE.TF_ONLY_CASTER },
      3,
      false
    )

  test('PREDICTION door — predict_sim_cast projects the +MP as a Granted action (was dropped: drain-only diff)', () => {
    const state = fresh_state()
    const before = find_entity(state, 'p0')
    const pred = predict_sim_cast({
      state,
      caster_id: 'p0',
      spell: grant_spell(),
      spell_level: 1,
      target: { x: 2, y: 4 }, // CASTER_CELL — a TF_ONLY_CASTER effect resolves onto the caster
      arena: MATRIX_ARENA,
    })
    expect(find_entity(pred.result.state, 'p0').mp).toBe(before.mp + 1) // sim ground truth: the pool rose
    const grant = pred.actions.find((a) => a.kind === 'Granted' && Number(a.point_kind) === 1)
    expect(grant).toBeTruthy()
    expect(grant.granted).toBe(1)
    expect(pred.actions.some((a) => a.kind === 'Drain')).toBe(false) // a grant is never a drain
  })

  test('FOLD arm — apply_action Granted raises the overlay pool, symmetric to Drain (the receipt-side twin)', () => {
    const seeded = apply_action(empty_state('f'), {
      kind: 'TurnStarted',
      is_mob: false,
      idx: 0,
      deadline_ms: 1,
      ap: 6,
      mp: 3,
    })
    expect(apply_action(seeded, { kind: 'Granted', target_idx: 0, point_kind: 1, granted: 1 }).fighters.p0.mp).toBe(4)
    expect(apply_action(seeded, { kind: 'Granted', target_idx: 0, point_kind: 0, granted: 2 }).fighters.p0.ap).toBe(8)
    // overlay-absent → no invented number; reconciles through the snapshot row (exactly the Drain arm's guard)
    const bare = apply_action(empty_state('f'), { kind: 'Granted', target_idx: 0, point_kind: 1, granted: 1 })
    expect(bare.fighters.p0?.mp ?? null).toBe(null)
  })

  test('OWNER SURFACES — a folded grant lifts engine_view.mp (HUD number) AND move_wash reach (the MP blob)', () => {
    const store = started_store()
    const view0 = engine_view(store.getState())
    const me0 = view0.fighters.get(view0.my_entity_id)
    const reach0 = move_wash(store.getState(), {}).reach.length
    store.getState().input(
      {
        type: 'intent',
        intent: { kind: 'Granted', target_idx: 0, point_kind: 1, granted: 1 },
        version: 6,
        event_idx: 0,
      },
      NOW
    )
    const view1 = engine_view(store.getState())
    expect(view1.fighters.get(view1.my_entity_id).mp).toBe(me0.mp + 1) // ⑤a the HUD number
    expect(move_wash(store.getState(), {}).reach.length).toBeGreaterThan(reach0) // ⑤b the blob reach grew
  })

  test('DURABLE door — give_points is chain-silent, so base_from_view carries the already-granted snapshot mp', () => {
    // No Drain-twin grant event exists on chain (cast.move:997 give_points emits nothing); the Fight object read
    // carries the bumped participant.mp. base_from_view projects it verbatim → the committed fold reflects the
    // grant the instant the snapshot lands (the receipt door), independent of the optimistic Granted overlay.
    const view = {
      id: 'f',
      status: STATUS_ACTIVE,
      escrow: [{ seat: 0, cell: 10, hp: 100, alive: true, ap: 6, mp: 4, base_ap: 6, base_mp: 3 }],
      mobs: [],
      turn_queue: [{ is_mob: false, idx: 0 }],
      turn_ptr: 0,
    }
    expect(base_from_view(view, 'f').fighters.p0.mp).toBe(4) // base_mp is 3; the +1 give_points grant rides mp=4
  })
})
