// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MY_GLYPHS — the fold-state home for the caster's OWN placed glyphs (the orange ground zone that STAYS).
// Mirrors my_traps_fold.js structurally, but the glyph LIFECYCLE differs (sim/fight_traps.js is the truth):
// a glyph is PERSISTENT — check_glyphs ticks anyone standing on it at TURN_START and NEVER removes it; it dies
// only by EXPIRY (decay_glyphs decrements turns_remaining, drops at 0). So `gone` = expiry, not detonation:
// a fighter standing on a glyph does NOT clear it (only an explicit trap entry consumes the trap twin).

import { describe, expect, test } from 'bun:test'

import { single_effect_spell } from '../../sim/test/spell_effect_conformance_matrix.js'
import * as SE from '../../sim/src/spell_effect.js'
import { create_fight_store } from '../src/store.js'
import { engine_view } from '../src/project.js'
import { predict_cast } from '../src/predict_cast.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const W = 20
const enc = (x, y) => y * W + x
const ME = enc(5, 5)
const MOB = enc(7, 5)
const G1 = enc(9, 5) // a 3-cell glyph zone (an area effect covering the zone, not a single point)
const G2 = enc(10, 5)
const G3 = enc(9, 6)
const OFF = enc(3, 3)

const ev = (kind, fields) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })

const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: W,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 9,
      mp: 3,
      base_ap: 9,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: ME,
    },
  ],
  mobs: [{ template: '0xabc', hp: 200, max_hp: 200, cell: MOB, ap: 4, mp: 3, level: 1 }],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
}

const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

// place a glyph covering a 3-cell zone for `turns` turns (the predicted-cast fold entry — predict_cast.placed_glyphs).
const place_glyph = (store, turns = 2) =>
  store.getState().input(
    {
      type: 'predicted',
      basis_version: 6,
      intent_id: 'glyph1',
      actions: [{ kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: G1, ap_cost: 3 }],
      beats: [{ kind: 'cast', at: 0, duration: 100, payload: {} }],
      place_glyphs: [{ cells: [G1, G2, G3], turns }],
    },
    1_100
  )

// bump my_turn_no (one round): a mob receipt presents a non-local wave; draining it re-raises the playable edge.
const advance_one_turn = (store, base_ms) => {
  store
    .getState()
    .input(
      { type: 'receipt', version: base_ms, receipt: { events: [ev('MobMoved', { idx: 0, to_cell: OFF })] } },
      base_ms
    )
  for (const turn of store.getState().wave) store.getState().input({ type: 'presented', seq: turn.seq }, base_ms + 10)
}

describe('my_glyphs — the fold-state home for the persistent orange zone', () => {
  test('a predicted glyph-cast populates engine_view.my_glyphs with its FULL zone', () => {
    const store = boot()
    place_glyph(store, 2)
    // the whole AoE is exposed (deduped, order-independent) — the render paints every cell of the zone.
    expect([...engine_view(store.getState()).my_glyphs].sort((a, b) => a - b)).toEqual(
      [G1, G3, G2].sort((a, b) => a - b)
    )
  })

  test('it STAYS while a fighter stands on it (persistent — no detonation twin) and across the placing turn', () => {
    const store = boot()
    place_glyph(store, 2)
    // a receipt walks the mob ONTO a glyph cell — a TRAP would spring gone; a glyph must stay (check_glyphs never removes).
    store
      .getState()
      .input({ type: 'receipt', version: 7, receipt: { events: [ev('MobMoved', { idx: 0, to_cell: G1 })] } }, 1_200)
    for (const turn of store.getState().wave) store.getState().input({ type: 'presented', seq: turn.seq }, 1_300)
    expect([...engine_view(store.getState()).my_glyphs].sort((a, b) => a - b)).toEqual(
      [G1, G2, G3].sort((a, b) => a - b)
    )
  })

  test('it EXPIRES after `turns` turn-advances (decay_glyphs semantics), then is gone forever', () => {
    const store = boot()
    place_glyph(store, 2) // survives the placing turn + one more
    advance_one_turn(store, 1_200) // turns_remaining 2 → 1 (still lit)
    expect(engine_view(store.getState()).my_glyphs.length).toBe(3)
    advance_one_turn(store, 1_400) // 1 → 0 → expired
    expect(engine_view(store.getState()).my_glyphs).toEqual([])
  })

  test('drop_glyphs takes an uncommitted glyph back (flush-drop / turn-boundary rollback)', () => {
    const store = boot()
    place_glyph(store, 2)
    expect(engine_view(store.getState()).my_glyphs.length).toBe(3)
    store.getState().input({ type: 'drop_glyphs', cells: [G1] }, 1_200) // any shared cell drops the whole record
    expect(engine_view(store.getState()).my_glyphs).toEqual([])
  })

  test('clears on fight init', () => {
    const store = boot()
    place_glyph(store, 2)
    store
      .getState()
      .input({ type: 'init', fight_id: '0xf2', my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
    expect(store.getState().my_glyphs).toEqual([])
  })
})

// THE sim→fold PARITY VECTOR: a REAL glyph cast run through the sim (predict_cast) → its placed_glyphs folded into
// the store (exactly as DungeonBoard forwards) → the projection shows the glyph's FULL zone. RED at HEAD: predict_cast
// emitted no placed_glyphs and engine_view had no my_glyphs, so a placed glyph was invisible to the client fold.
const resolve_ref = (id) =>
  id === CHAR
    ? { is_mob: false, idx: 0 }
    : /^mob-(\d+)$/.test(String(id))
      ? { is_mob: true, idx: Number(String(id).slice(4)) }
      : null

describe('sim→fold parity — a glyph cast in the sim surfaces in the client projection with its zone', () => {
  test('predict_cast.placed_glyphs → store fold → engine_view.my_glyphs paints the whole AoE', () => {
    const store = boot()
    const target = enc(6, 6) // a free cell near the caster
    // a circle-radius-1 glyph (5 cells) lasting 3 turns — the corpus glyph shape (place_glyph → K_PLACE_GLYPH).
    const glyph_spell = single_effect_spell(
      'glyph',
      { kind: SE.K_PLACE_GLYPH, area_shape: SE.SHAPE_CIRCLE, area_size: 1, turns: 3, target_filter: SE.TF_NONE },
      3,
      true
    )
    const pred = predict_cast({
      view: engine_view(store.getState()),
      caster_id: CHAR,
      spell: glyph_spell,
      target_cell: target,
      resolve_ref,
    })
    // predict_cast emits { cells:number[], turns } per placed glyph — the exact shape DungeonBoard forwards.
    expect(pred.placed_glyphs.length).toBe(1)
    expect(pred.placed_glyphs[0].turns).toBe(3)
    const zone = [...pred.placed_glyphs[0].cells].sort((a, b) => a - b)
    expect(zone).toEqual([enc(6, 6), enc(5, 6), enc(7, 6), enc(6, 5), enc(6, 7)].sort((a, b) => a - b))
    // fold it exactly as DungeonBoard does → the projection surfaces the whole zone.
    store.getState().input(
      {
        type: 'predicted',
        basis_version: 6,
        intent_id: 'glyphcast',
        actions: pred.actions,
        beats: pred.beats,
        place_glyphs: pred.placed_glyphs,
      },
      1_100
    )
    expect([...engine_view(store.getState()).my_glyphs].sort((a, b) => a - b)).toEqual(zone)
  })
})
