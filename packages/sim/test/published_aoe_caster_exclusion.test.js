// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1747 — THE DISCRIMINATOR, now the seal. Gobadoc damaged himself with his own AoE after two rows closed
// the defect as fixed, so this file separated the three candidate culprits by driving the REAL cast door
// with the REAL published data instead of an authored shape.
//
// The subject is `fixtures/published_devastating_slam.json` — the row captured verbatim off the published
// content blob, NOT a hand-built spell. It reaches the reducer the way the simulator page reaches it: the
// field mapping below is `mob_spell_level` from `packages/frontend/src/simulator/content.js:206-215`, whose
// effect adapter (`chain_effect`, :201) spreads the authored effect verbatim — so `target_filter` travels
// from the CDN blob into the reducer untouched and the simulator introduces no second fold of its own.
//
// WHAT IT PINNED: neither the sim core nor the resolver was at fault. The DATA was — corpus 20260804a
// published `target_filter: 0` (TF_NONE) for this row while the chain carried 1 (TF_NOT_TEAM), and the same
// 0 covered ALL 1030 of that blob's mob-spell effects: the signature of an emitter that never wrote the
// field, not of 1030 authoring decisions. The world fight path (chain-fed) was correct; the simulator page
// (blob-fed) was not — the blob is a THIRD reader the #1809 sim+Move twin never covered.
//
// WHAT IT PINS NOW: corpus 20260806a republishes the field. The last test read the same fixture RED and
// reads it green, and the product-truth test drives the published row unmodified — the caster is spared
// because the DATA says so, not because a test overrode it. Re-capture the fixture on any republish and
// this file re-measures the emitter for free.

import { describe, expect, test } from 'bun:test'

import { normalize_chain_spell_corpus } from '../src/chain_spell_corpus.js'
import { process_spell_cast } from '../src/fight_spells.js'
import { find_entity } from '../src/fight_state.js'
import { create_fight_state } from '../src/reduce.js'
import { TF_NONE, TF_NOT_TEAM } from '../src/spell_effect.js'
import { get_aoe_cells } from '../src/spell_targeting.js'

import { CAST_CTX, MATRIX_ARENA } from './spell_effect_conformance_matrix.js'
import FIXTURE from './fixtures/published_devastating_slam.json' with { type: 'json' }

const GRID_W = 20
const decode = cell => ({ x: cell % GRID_W, y: Math.floor(cell / GRID_W) })

const fighter = (id, cell, is_player) => ({
  id,
  name: id,
  cell: decode(cell),
  health: 500,
  health_max: 500,
  ap: 99,
  ap_max: 99,
  mp: 20,
  mp_max: 20,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'published-slam',
  level: 38,
  stats: {},
  effects: [],
  spell_levels: {},
  ap_reserve: 0,
})

// The boss and its ally hold team1; the lone player is the only fighter an enemies-only line may legally hit.
const slam_state = () => ({
  ...create_fight_state({
    fight_id: 'published-slam',
    arena_seed: 1,
    arena_radius: 4,
    arena: MATRIX_ARENA,
    team0: [fighter('player', FIXTURE.enemy_cell, true)],
    team1: [
      fighter('gobadoc', FIXTURE.caster_cell, false),
      fighter('ally', FIXTURE.ally_cell, false),
    ],
  }),
  started: true,
  turn_order: ['gobadoc', 'ally', 'player'],
  turn_number: 1,
})

/**
 * The published row → the sim template map, through the simulator page's own field mapping and the one
 * chain-corpus normalizer. `override` mutates NOTHING in the fixture; it builds a sibling row so a control
 * can vary exactly one field.
 */
const template_of = (override = {}) =>
  normalize_chain_spell_corpus([
    {
      id: 'devastating_slam',
      name: 'devastating_slam',
      levels: [
        {
          ap_cost: FIXTURE.published_spell.ap,
          range_min: FIXTURE.published_spell.rmin,
          range_max: FIXTURE.published_spell.rmax,
          cooldown_turns: FIXTURE.published_spell.cd,
          crit_rate: FIXTURE.published_spell.crit,
          line_of_sight: FIXTURE.published_spell.los !== false,
          effects: FIXTURE.published_spell.effects.map(effect => ({
            ...effect,
            ...override,
          })),
          crit_effects: FIXTURE.published_spell.crit_effects,
        },
      ],
    },
  ]).get('devastating_slam')

const cast = spell => {
  const state = slam_state()
  const before = Object.fromEntries(
    [...state.team0, ...state.team1].map(entity => [entity.id, entity.health]),
  )
  const result = process_spell_cast(
    state,
    'gobadoc',
    spell,
    1,
    decode(FIXTURE.target_cell),
    CAST_CTX,
  )
  expect(result.success, 'the published cast is legal from its own cell').toBe(
    true,
  )
  return { before, result }
}

describe('#1747 — the published Devastating Slam against its own caster', () => {
  test('control — the published circle really does swallow the caster and its ally', () => {
    const [effect] = FIXTURE.published_spell.effects
    const cells = get_aoe_cells(
      { area_shape: effect.area_shape, area_size: effect.area_size },
      decode(FIXTURE.target_cell),
      decode(FIXTURE.caster_cell),
    ).map(cell => cell.y * GRID_W + cell.x)
    expect(cells).toEqual(FIXTURE.zone_cells)
    expect(cells).toContain(FIXTURE.caster_cell)
    expect(cells).toContain(FIXTURE.ally_cell)
  })

  test('THE PRODUCT TRUTH — the published row, unmodified, spares its own caster and ally', () => {
    const { before, result } = cast(template_of())
    expect(find_entity(result.state, 'player').health).toBeLessThan(
      before.player,
    )
    expect(
      find_entity(result.state, 'gobadoc').health,
      'the caster keeps every point of health',
    ).toBe(before.gobadoc)
    expect(find_entity(result.state, 'ally').health).toBe(before.ally)
  })

  test('the resolver is FAITHFUL — fed TF_NONE it hits everyone in the circle', () => {
    const { before, result } = cast(template_of({ target_filter: TF_NONE }))
    // Not a bug in this layer: `effect_hits(0, ...)` sets no exclusion bit, so an unfiltered zone is
    // authored to hit its own caster. This is the mechanism the field report observed, and it is exactly
    // what the uncured blob fed the simulator page — kept as the control the product truth is measured against.
    expect(find_entity(result.state, 'player').health).toBeLessThan(
      before.player,
    )
    expect(
      find_entity(result.state, 'gobadoc').health,
      'the caster bleeds — the reported symptom, resolved faithfully from a TF_NONE row',
    ).toBeLessThan(before.gobadoc)
    expect(find_entity(result.state, 'ally').health).toBeLessThan(before.ally)
  })

  test('the published row carries an enemies-only target_filter', () => {
    const [effect] = FIXTURE.published_spell.effects
    expect(
      effect.target_filter,
      `corpus ${FIXTURE.corpus_version} publishes target_filter ${effect.target_filter} ` +
        `for "${FIXTURE.published_spell.name}"; a boss melee zone must be TF_NOT_TEAM ` +
        `(${TF_NOT_TEAM}). Fix is content-side: republish, then re-capture the fixture.`,
    ).toBe(TF_NOT_TEAM)
  })
})
