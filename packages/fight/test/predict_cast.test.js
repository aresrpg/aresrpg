// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { normalize_chain_spell_corpus } from '../../sim/src/chain_spell_corpus.js'
import * as SE from '../../sim/src/spell_effect.js'
import {
  CORPUS,
  ENEMY_CELL,
  MATRIX_ARENA,
  SPELLS_CORPUS_AVAILABLE,
  fresh_state,
  run_matrix,
  single_effect_spell,
} from '../../sim/test/spell_effect_conformance_matrix.js'
import { find_entity } from '../../sim/src/fight_state.js'
import {
  CHAIN_PENDING,
  CHAIN_PENDING_ENGINE_VERSION,
  chain_critical,
  evolve_caster_cell,
  evolve_flush_casts,
  predict_cast,
  predict_sim_cast,
  weapon_spell_template,
} from '../src/predict_cast.js'
import { bfsPathCost, encode } from '../src/los.js'
import { create_fight_store, display_state, presented_state } from '../src/store.js'
import { apply_action, empty_state } from '../src/inputs.js'
import { base_from_view } from '../src/fold.js'
import { engine_view, move_wash } from '../src/project.js'
import { STATUS_ACTIVE } from '../src/board_state.js'
import { retarget_cast } from '../src/txs.js'
import { strike_flush_illegal } from '../src/turn_commit.js'

// The ceremony manifest is TRACKED in this repo (packages/move/scripts/out/ceremony_manifest.json — the
// stamped engine lineage, see the RITUAL comment in predict_cast.js), so it is imported unconditionally:
// a lost/renamed manifest reds the B7 boundary suite instead of silently skipping it (#746).
const CEREMONY_MANIFEST = (await import('../../move/scripts/out/ceremony_manifest.json', { with: { type: 'json' } }))
  .default

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
  turn_entropy: 100_000,
  turn_ordinal: 1,
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

    // RECONCILE (M2b · ONE INGRESS): the authoritative confirmation lands through the RECEIPT door — its Cast + the
    // teleport Displaced retire the prediction BY CLAIM (M6, same landing cell), so the presented cell never regresses
    // and the optimistic intents leave the log. A trailing object read would be an inert checkpoint, never the source.
    store.getState().input({ type: 'presented', seq: leg.seq }, NOW + 100)
    store.getState().input(
      {
        type: 'receipt',
        version: 7,
        receipt: {
          events: [
            {
              type: '0x0::fight_events::Cast',
              parsedJson: { fight: FIGHT, caster_is_mob: false, caster_idx: 0, target_cell: DEST },
            },
            {
              type: '0x0::fight_events::Displaced',
              parsedJson: { fight: FIGHT, target_is_mob: false, target_idx: 0, to_cell: DEST, kind: SE.K_TELEPORT },
            },
          ],
        },
      },
      NOW + 500
    )
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

  test('raw folded +range status makes a max+1 cast legal in prediction, but never extends fixed range', () => {
    const store = started_store()
    const view = engine_view(store.getState())
    const fighters = new Map(view.fighters)
    fighters.set(CHAR, {
      ...fighters.get(CHAR),
      effects: [
        {
          kind: SE.K_ALTER_STAT,
          stat: SE.STAT_RANGE,
          value: 1,
          flags: 0,
          remaining_turns: 2,
        },
      ],
    })
    const raw = single_effect_spell(
      'range_probe',
      { kind: SE.K_DAMAGE, value: 7, element: 2, target_filter: SE.TF_NOT_TEAM },
      1,
      false
    )
    const spell = (modifiable_range) => ({
      ...raw,
      levels: raw.levels.map((level) => ({ ...level, range: [1, 1], modifiable_range })),
    })
    const predict = (modifiable_range) =>
      predict_cast({
        view: { ...view, fighters },
        caster_id: CHAR,
        spell: spell(modifiable_range),
        target_cell: encode(4, 4), // distance 2: exactly max+1
        critical: false,
        stats_of: () => ({ range: 0 }),
        resolve_ref: (id) =>
          id === CHAR ? { is_mob: false, idx: 0 } : id === 'mob-0' ? { is_mob: true, idx: 0 } : null,
      })
    expect(predict(true).result.success).toBe(true)
    expect(predict(false).result.success).toBe(false)
  })

  test('a predicted self +range row enters the status home and legalizes the next same-turn cast', () => {
    const store = started_store()
    const resolve_ref = (id) =>
      id === CHAR ? { is_mob: false, idx: 0 } : id === 'mob-0' ? { is_mob: true, idx: 0 } : null
    const buff = single_effect_spell(
      'range_self',
      {
        kind: SE.K_ALTER_STAT,
        // AUTHORED ON THE WIRE (#904): kind 9 stores its delta CENTERED at 32768, so `+1 range` is 32769 and
        // FLAG_NEGATIVE is never the sign. The normalize door strips the centering; the status home below keeps
        // the decoded signed delta (+1), the same shape `fight_status_snapshot.js` hands the real chain rows.
        value: 32_769,
        stat: SE.STAT_RANGE,
        flags: 0,
        turns: 3,
        chance: 100,
        target_filter: SE.TF_ONLY_CASTER,
      },
      1,
      false
    )
    const predicted_buff = predict_cast({
      view: engine_view(store.getState()),
      caster_id: CHAR,
      spell: buff,
      target_cell: START,
      critical: false,
      resolve_ref,
    })
    store.getState().input({
      type: 'predicted',
      intent_id: 'range-buff:0',
      basis_version: 6,
      actions: predicted_buff.actions,
      beats: predicted_buff.beats,
    })
    expect(engine_view(store.getState()).fighters.get(CHAR).effects).toContainEqual(
      expect.objectContaining({
        kind: SE.K_ALTER_STAT,
        stat: SE.STAT_RANGE,
        value: 1,
        remaining_turns: 3,
      })
    )

    const raw = single_effect_spell(
      'range_followup',
      { kind: SE.K_DAMAGE, value: 7, element: 2, target_filter: SE.TF_NOT_TEAM },
      1,
      false
    )
    const followup = {
      ...raw,
      levels: raw.levels.map((level) => ({ ...level, range: [1, 1], modifiable_range: true })),
    }
    expect(
      predict_cast({
        view: engine_view(store.getState()),
        caster_id: CHAR,
        spell: followup,
        target_cell: encode(4, 4), // distance 2: authored max plus the just-predicted +1 row
        critical: false,
        resolve_ref,
      }).result.success
    ).toBe(true)
  })

  // The mirror of the row above, and the sign inversion #904 exposed on this door: a CENTERED debuff (value below
  // 32768, flags absent) must land in the status home as a NEGATIVE delta. A magnitude + FLAG_NEGATIVE row read
  // back as a BUFF — `sim_effects_of` derives the sign from the value alone, exactly as the chain fold does.
  test('a predicted self -range row enters the status home signed and illegalizes a max-distance cast', () => {
    const store = started_store()
    const resolve_ref = (id) =>
      id === CHAR ? { is_mob: false, idx: 0 } : id === 'mob-0' ? { is_mob: true, idx: 0 } : null
    const debuff = single_effect_spell(
      'range_drain',
      {
        kind: SE.K_ALTER_STAT,
        value: 32_767, // centered −1 range
        stat: SE.STAT_RANGE,
        flags: 0, // the unflagged dialect: the value alone carries the sign
        turns: 3,
        chance: 100,
        target_filter: SE.TF_ONLY_CASTER,
      },
      1,
      false
    )
    const predicted_debuff = predict_cast({
      view: engine_view(store.getState()),
      caster_id: CHAR,
      spell: debuff,
      target_cell: START,
      critical: false,
      resolve_ref,
    })
    store.getState().input({
      type: 'predicted',
      intent_id: 'range-debuff:0',
      basis_version: 6,
      actions: predicted_debuff.actions,
      beats: predicted_debuff.beats,
    })
    expect(engine_view(store.getState()).fighters.get(CHAR).effects).toContainEqual(
      expect.objectContaining({
        kind: SE.K_ALTER_STAT,
        stat: SE.STAT_RANGE,
        value: -1,
        remaining_turns: 3,
      })
    )

    const raw = single_effect_spell(
      'range_followup',
      { kind: SE.K_DAMAGE, value: 7, element: 2, target_filter: SE.TF_NOT_TEAM },
      1,
      false
    )
    const followup = {
      ...raw,
      levels: raw.levels.map((level) => ({ ...level, range: [1, 2], modifiable_range: true })),
    }
    expect(
      predict_cast({
        view: engine_view(store.getState()),
        caster_id: CHAR,
        spell: followup,
        target_cell: encode(4, 4), // distance 2: the authored max, minus the just-predicted -1 row
        critical: false,
        resolve_ref,
      }).result.success
    ).toBe(false)
  })

  test('prediction seeds immutable gear range from the fighter when a caller supplies no stats adapter', () => {
    const view = engine_view(started_store().getState())
    const fighters = new Map(view.fighters)
    fighters.set(CHAR, { ...fighters.get(CHAR), base_range: 1 })
    const raw = single_effect_spell(
      'gear_range_probe',
      { kind: SE.K_DAMAGE, value: 7, element: 2, target_filter: SE.TF_NOT_TEAM },
      1,
      false
    )
    const spell = {
      ...raw,
      levels: raw.levels.map((level) => ({ ...level, range: [1, 1], modifiable_range: true })),
    }
    expect(
      predict_cast({
        view: { ...view, fighters },
        caster_id: CHAR,
        spell,
        target_cell: encode(4, 4),
        critical: false,
        resolve_ref: (id) =>
          id === CHAR ? { is_mob: false, idx: 0 } : id === 'mob-0' ? { is_mob: true, idx: 0 } : null,
      }).result.success
    ).toBe(true)
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

  // MISSING-ARTIFACT: needs a REAL authored spell row (senshi_warcleave). seed/mainnet/spells never enters
  // this repo (CLAUDE.md, "The content boundary") so CORPUS degrades to [] — see the gate's one home,
  // packages/sim/test/spell_effect_conformance_matrix.js. Permanent by design, verified real in #746.
  test.skipIf(!SPELLS_CORPUS_AVAILABLE)(
    'public crit selection swaps the whole authored branch; an unknown branch stays cast-only',
    () => {
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
    }
  )

  test('chain_critical mirrors the public turn-seed slot threshold', () => {
    const clock = {
      world_seed: 123456789,
      spawn_id: 42,
      turn_entropy: 3141592653,
      turn_ordinal: 7,
      seat: 0,
    }
    // slot 0 rolls 1089 (below the rate-4 threshold 2500), slot 2 rolls 5988 (above it) — the slot IS an input.
    expect(chain_critical({ ...clock, slot: 0 }, 4, 0)).toBe(true)
    expect(chain_critical({ ...clock, slot: 2 }, 4, 0)).toBe(false)
  })

  test('a known-critical turn-seed slot marks the drafted damage beat as critical', () => {
    const critical = chain_critical(
      {
        world_seed: 123456789,
        spawn_id: 42,
        turn_entropy: 3141592653,
        turn_ordinal: 7,
        seat: 0,
        slot: 0,
      },
      4,
      0
    )
    const prediction = predict_sim_cast({
      state: fresh_state(),
      caster_id: 'p0',
      spell: weapon_spell_template({ ap_cost: 3, damage: 5, crit_damage: 9, crit_rate: 4, reach: 3 }),
      target: ENEMY_CELL,
      arena: MATRIX_ARENA,
      critical,
    })
    const damage = prediction.beats.find((beat) => beat.kind === 'damage')

    expect(critical).toBe(true) // fixture slot 0 roll 1089 is below the rate-4 threshold 2500
    expect(damage.payload).toMatchObject({ damage: 9, is_critical: true })
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

  test('RED-FIRST #398: a move then cast validates from the post-move caster cell', () => {
    const move_destination = enc(6, 5)
    const evolved = evolve_flush_casts({
      view: view(),
      committed,
      caster_id: 'p0',
      actions: [
        { kind: 0, target: move_destination },
        { kind: 1, spell: dmg_spell, target: enc(7, 5) },
      ],
    })

    // The contract executes this exact interleaving. The cast snapshot is therefore rooted at the cell written by
    // the preceding move, not the committed turn-start cell and not a casts-before-moves regrouping.
    expect(evolved).toHaveLength(1)
    expect(evolved[0]?.caster_cell).toBe(move_destination)
  })

  test('#398: a deterministically tackled move then cast validates from the cell where the move was denied', () => {
    const evolved = evolve_flush_casts({
      view: view(),
      committed,
      caster_id: 'p0',
      actions: [
        { kind: 0, target: enc(6, 5), landed: false },
        { kind: 1, spell: dmg_spell, target: enc(7, 5) },
      ],
    })

    // act_move still ships to commit the tackle forfeit, but it writes no destination cell. A following cast reads
    // the unchanged live caster cell, never the denied target.
    expect(evolved).toHaveLength(1)
    expect(evolved[0]?.caster_cell).toBe(committed.fighters.p0.cell)
  })

  test('#398: a move crossing a known lethal trap anchors the later cast at the trap stop', () => {
    const trap_cell = enc(6, 5)
    const mob_cell = enc(9, 5)
    const base_view = view()
    const trapped_view = {
      ...base_view,
      fighters: new Map(base_view.fighters).set('mob-0', { ...base_view.fighters.get('mob-0'), cell: dec(mob_cell) }),
      my_traps: [trap_cell],
      my_trap_payloads: {
        [trap_cell]: [{ type: 'DAMAGE', element: 'FIRE', min: 999, max: 999 }],
      },
    }
    const trapped_committed = {
      fighters: { ...committed.fighters, m0: { ...committed.fighters.m0, cell: mob_cell } },
    }
    const evolved = evolve_flush_casts({
      view: trapped_view,
      committed: trapped_committed,
      caster_id: 'p0',
      actions: [
        { kind: 0, target: enc(7, 5), landed: true },
        { kind: 1, spell: dmg_spell, target: mob_cell },
      ],
    })

    expect(evolved).toHaveLength(1)
    expect(evolved[0]?.caster_cell).toBe(trap_cell)
    expect(evolved[0]?.occupied.get(trap_cell)).toMatchObject({ kind: 'player', idx: 0, alive: false })
  })

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

describe('#321 evolve_flush_casts — the per-cast CASTER anchor (a caster-relocating cast among the drafted casts moved the footprint origin for every cast that follows it; a static pre-loop anchor dropped a valid stationary target as "no longer valid")', () => {
  const W = 20
  const enc = (x, y) => y * W + x
  const dec = (c) => ({ x: c % W, y: Math.floor(c / W) })
  const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
  const tp_spell = single_effect_spell(
    'tp321',
    { kind: SE.K_TELEPORT, value: 3, target_filter: SE.TF_ONLY_CASTER },
    3,
    true
  )
  const dmg_spell = single_effect_spell(
    'dmg321',
    { kind: SE.K_DAMAGE, value: 10, element: 2, target_filter: SE.TF_NOT_TEAM },
    3,
    false
  )
  const push_spell = single_effect_spell(
    'push321',
    { kind: SE.K_PUSH, value: 5, target_filter: SE.TF_NOT_TEAM },
    3,
    false
  )
  const view = (mob_cell) => ({
    fight_id: '0x321',
    arena: { width: W, height: 19, cells: new Uint8Array(W * 19) },
    fighters: new Map([
      [
        'p0',
        {
          id: 'p0',
          cell: dec(enc(2, 4)),
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
          cell: dec(mob_cell),
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

  test('RED-FIRST: [teleport, cast-on-adjacent-stationary-target] — cast 2 anchors from the LANDING cell, in range; the stale sequence-start cell a single anchor would have reused was NOT', () => {
    // caster at (2,4); the teleport jumps 9 cells east (single_effect_spell's own range_max — legally in its own
    // reach) to (11,4); a stationary mob sits 1 cell further at (12,4) — it never moves.
    const mob_cell = enc(12, 4)
    const committed = {
      fighters: { p0: { cell: enc(2, 4), hp: 120, alive: true }, m0: { cell: mob_cell, hp: 200, alive: true } },
    }
    const evolved = evolve_flush_casts({
      view: view(mob_cell),
      committed,
      caster_id: 'p0',
      caster_seed_cell: committed.fighters.p0.cell, // the flush's own pre-loop `anchor` (cast_first: the committed cell)
      casts: [
        { spell: tp_spell, target: enc(11, 4) }, // cast 0 — self-teleport, 9 cells east (its own range_max)
        { spell: dmg_spell, target: mob_cell }, // cast 1 — the stationary mob, adjacent to the LANDING cell
      ],
    })
    // Before #321, evolve_flush_casts returned no caster_cell at all — every cast in a multi-cast draft anchored
    // on ONE static pre-loop cell regardless of what a prior cast in the SAME draft did to the caster.
    expect(evolved[0].caster_cell).toBe(enc(2, 4)) // cast 0 — nothing yet to evolve past
    expect(evolved[1].caster_cell).toBe(enc(11, 4)) // cast 1 — evolved through cast 0's OWN teleport
    // THE BUG, pinned as a reachability delta (same style as #300's 3-vs-1 MP pin): the mob sits 1 cell from the
    // evolved anchor (well within ANY real spell's range) but 10 cells from the STALE pre-teleport anchor a
    // single-anchor flush reuses for every cast — OUT of dmg_spell's own range_max (9) — a footprint drawn from
    // that stale corner of the board excludes this stationary, unmoved, perfectly-legal target and drops the cast
    // as "no longer valid" (#321's report).
    expect(manhattan(dec(evolved[1].caster_cell), dec(mob_cell))).toBe(1)
    expect(manhattan(dec(evolved[0].caster_cell), dec(mob_cell))).toBe(10)
    expect(manhattan(dec(evolved[0].caster_cell), dec(mob_cell))).toBeGreaterThan(dmg_spell.levels[0].range[1])
    expect(manhattan(dec(evolved[1].caster_cell), dec(mob_cell))).toBeLessThanOrEqual(dmg_spell.levels[0].range[1])
  })

  test('a non-relocating cast ahead of it leaves the per-cast anchor unchanged — matches the single pre-#321 anchor exactly', () => {
    const mob_cell = enc(9, 4)
    const committed = {
      fighters: { p0: { cell: enc(2, 4), hp: 120, alive: true }, m0: { cell: mob_cell, hp: 200, alive: true } },
    }
    const evolved = evolve_flush_casts({
      view: view(mob_cell),
      committed,
      caster_id: 'p0',
      caster_seed_cell: committed.fighters.p0.cell,
      casts: [
        { spell: dmg_spell, target: mob_cell },
        { spell: dmg_spell, target: mob_cell },
      ],
    })
    expect(evolved[0].caster_cell).toBe(enc(2, 4))
    expect(evolved[1].caster_cell).toBe(enc(2, 4)) // no relocation anywhere in the draft → identical to the old static anchor
  })

  test('STEP 3 no-teleport probe — an intra-draft PUSH (no teleport anywhere) never relocates the CASTER: retarget_cast and strike_flush_illegal both stay clean for the pushed targets own follow-up cast', () => {
    // caster (5,5) never moves this turn; mob starts at (7,5), cast 0 pushes it 5 cells to its slide landing
    // (12,5) — the SAME push fixture as the ⑭ describe above; cast 1 (drafted at the OPTIMISTIC post-push cell,
    // exactly what the player clicked) targets it there.
    const mob_start = enc(7, 5)
    const landing = enc(12, 5)
    const committed = {
      fighters: { p0: { cell: enc(5, 5), hp: 120, alive: true }, m0: { cell: mob_start, hp: 200, alive: true } },
    }
    const evolved = evolve_flush_casts({
      view: view(mob_start),
      committed,
      caster_id: 'p0',
      caster_seed_cell: committed.fighters.p0.cell,
      casts: [
        { spell: push_spell, target: mob_start },
        { spell: dmg_spell, target: landing },
      ],
    })
    // the caster's OWN anchor never moves — a push relocates the TARGET, never the caster.
    expect(evolved[0].caster_cell).toBe(enc(5, 5))
    expect(evolved[1].caster_cell).toBe(enc(5, 5))
    // the SAME flush-time decision chain DungeonBoard.jsx composes: the eye-state poll hasn't caught up to this
    // turn's own not-yet-committed push, so the target fighter's committed cell resolves unchanged (a void-cast-
    // shaped input — the exact case cast_retarget_leg_0a.test.js locks) — retarget_cast is a clean no-op…
    const reaches = (cell) => manhattan(dec(evolved[1].caster_cell), dec(cell)) <= 9 // single_effect_spell's own range_max
    const retargeted = retarget_cast({ target_cell: landing, committed_cell: null, reaches })
    expect(retargeted).toEqual({ target: landing })
    // …and strike_flush_illegal sees the landing cell IN the (correctly caster-anchored) footprint — never dropped.
    const tgt = evolved[1].occupied.get(landing)
    expect(tgt).toMatchObject({ kind: 'mob', alive: true })
    const illegal = strike_flush_illegal({
      in_footprint: reaches(landing),
      is_weapon: false,
      free_cell: false,
      occupied_alive: !!tgt?.alive,
    })
    expect(illegal).toBe(false) // VERDICT: the no-teleport, push-adjacent class does NOT reproduce #321's drop
  })
})

describe('#300 evolve_caster_cell — the movement-draft anchor after a drafted caster-relocating cast', () => {
  const W = 20
  const enc = (x, y) => y * W + x
  const dec = (c) => ({ x: c % W, y: Math.floor(c / W) })
  const tp_spell = single_effect_spell(
    'tp',
    { kind: SE.K_TELEPORT, value: 3, target_filter: SE.TF_ONLY_CASTER },
    3,
    true
  )
  const dmg_spell = single_effect_spell(
    'dmg',
    { kind: SE.K_DAMAGE, value: 10, element: 2, target_filter: SE.TF_NOT_TEAM },
    3,
    false
  )
  const view = () => ({
    fight_id: '0xanchor',
    arena: { width: W, height: 19, cells: new Uint8Array(W * 19) },
    fighters: new Map([
      [
        'p0',
        {
          id: 'p0',
          cell: dec(enc(2, 4)),
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
          cell: dec(enc(9, 9)),
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
  // committed = the CHAIN base: the caster still sits at its PRE-teleport cell (2,4), my drafted teleport EXCLUDED —
  // exactly what the movement draft reads as `me.committed.cell`, and exactly why it was stale.
  const committed = {
    fighters: { p0: { cell: enc(2, 4), hp: 120, alive: true }, m0: { cell: enc(9, 9), hp: 200, alive: true } },
  }

  test('a drafted TELEPORT relocates the anchor to the landing cell (never the pre-teleport committed cell)', () => {
    const anchor = evolve_caster_cell({
      view: view(),
      committed,
      caster_id: 'p0',
      casts: [{ spell: tp_spell, target: enc(4, 4) }],
    })
    expect(anchor).toBe(enc(4, 4)) // the caster ADOPTS the landing cell — the cell the chain charges the next move from (cast_first)
    // THE REPORTED BUG, pinned as a cost delta: a 1-cell move to (4,5) costs 1 MP from the evolved anchor…
    expect(bfsPathCost(anchor, enc(4, 5), new Set(), 20)).toBe(1)
    // …but 3 MP from the raw committed cell — the exact overcount #300 reported (walking 1 cell charged 3).
    expect(bfsPathCost(committed.fighters.p0.cell, enc(4, 5), new Set(), 20)).toBe(3)
  })

  test('a non-relocating cast (or no drafted cast) keeps the anchor at the committed cell', () => {
    expect(
      evolve_caster_cell({ view: view(), committed, caster_id: 'p0', casts: [{ spell: dmg_spell, target: enc(9, 9) }] })
    ).toBe(enc(2, 4))
    expect(evolve_caster_cell({ view: view(), committed, caster_id: 'p0', casts: [] })).toBe(enc(2, 4))
  })
})

// MISSING-ARTIFACT: every test here reads REAL corpus rows (seed/mainnet/spells) against the stamped
// engine lineage — the corpus is content-pipeline output, absent by design in this public repo (CLAUDE.md,
// "The content boundary"). The ceremony manifest it also reads
// (packages/move/scripts/out/ceremony_manifest.json) is TRACKED here, so it is no longer part of the gate:
// the corpus is the only thing that can actually be missing (#746).
describe.skipIf(!SPELLS_CORPUS_AVAILABLE)('B7 deployed-chain exclusion boundary', () => {
  test('the exact ruled set is stamped to the currently deployed engine lineage', () => {
    expect([...CHAIN_PENDING].sort((a, b) => a - b)).toEqual(B7_KINDS)
    // A from-scratch republish stamps no `.latest` (only an in-place upgrade repoints it) — same
    // `entry.latest ?? entry.pkg` fallback stamp_all.mjs's package_row uses for this exact manifest shape.
    expect(CHAIN_PENDING_ENGINE_VERSION).toBe(CEREMONY_MANIFEST.engine.latest ?? CEREMONY_MANIFEST.engine.pkg)
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
