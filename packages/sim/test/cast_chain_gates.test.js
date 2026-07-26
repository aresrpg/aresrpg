// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1012 — CASTABILITY IS THE CHAIN'S, AND ONLY THE CHAIN'S.
//
// `packages/move` has no deck, no hand, no draw and no discard: a chain cast is gated by AP, range, LoS,
// casts_per_turn, casts_per_target and cooldown, and by nothing else (cast.move:130-192). The sim used to
// deal a 7-card opening hand off a shuffled deck and discard each cast, so a seat holding more spells than
// the hand size could not cast the undealt ones at all, and no spell could be cast twice in one turn however
// generous its authored `casts_per_turn`. Both are simulator-only rules with no twin. These two cases pin
// their absence: every unlocked spell casts, and a `casts_per_turn: 2` spell casts twice in one turn.
import { describe, test, expect } from 'bun:test'

import { reduce, create_fight_state } from '../src/reduce.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import { find_entity } from '../src/fight_state.js'

const DAMAGE = 4

/** A flat 9x9 arena — every cell walkable, so only the cast rules can refuse anything. */
const flat_arena = (width = 9) => ({
  width,
  height: width,
  radius: (width - 1) / 2,
  center: { x: (width - 1) / 2, y: (width - 1) / 2 },
  cells: new Uint8Array(width * width),
  spawns_a: [{ x: 1, y: 4 }],
  spawns_b: [{ x: 7, y: 4 }],
})

/** One authored damage spell in the AresRPG JSON shape, fed through the real normalizer. */
const spell_json = (name, { cost = 1, casts_per_turn = 255 } = {}) => ({
  name,
  description: `${name} — a ranged strike.`,
  levels: [
    {
      cost,
      range: [1, 8],
      critical_chance: 0,
      area: 0,
      area_type: 'circle',
      casts_per_turn,
      casts_per_target: 255,
      cooldown_turns: 0,
      modifiable_range: false,
      line_of_sight: true,
      linear: false,
      free_cell: false,
      base_effects: [
        {
          type: 'damage',
          min: DAMAGE,
          max: DAMAGE,
          element: 'fire',
          target: 'enemies',
          chance: 100,
        },
      ],
      critical_effects: [],
    },
  ],
})

const make_entity = (id, cell, is_player, spell_ids) => ({
  id,
  name: id,
  cell,
  health: 200,
  health_max: 200,
  ap: 12,
  ap_max: 12,
  mp: 3,
  mp_max: 3,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'senshi',
  level: 200,
  stats: { agility: 0, intelligence: 0, range: 0 },
  effects: [],
  // RETIRED BY THIS CHANGE — the card fields the reducer still deals from today. They exist here only so
  // these two cases fail on the CARD RULES rather than on a missing field; the deletion commit drops them.
  deck: spell_ids,
  hand: [],
  discard: [],
  spell_levels: Object.fromEntries(spell_ids.map(sid => [sid, 1])),
  ap_reserve: 0,
})

/**
 * A started 1v1 fight whose player seat has unlocked `spells` (id -> authored JSON). The mob holds nothing:
 * this suite only ever drives the player's own casts.
 */
const started_fight = spells => {
  const arena = flat_arena()
  const ctx = {
    spell_templates: normalize_spell_templates({ senshi: spells }),
    arena,
  }
  const spell_ids = Object.keys(spells)
  const base = create_fight_state({
    fight_id: 'f1012',
    arena_seed: 4242,
    arena_radius: arena.radius,
    arena,
    team0: [make_entity('p0', { x: 1, y: 4 }, true, spell_ids)],
    team1: [make_entity('m0', { x: 7, y: 4 }, false, [])],
  })
  const { state } = reduce(base, { type: 'start' }, ctx)
  return { state, ctx, spell_ids }
}

const cast = (state, ctx, spell_id) =>
  reduce(
    state,
    { type: 'cast', entity_id: 'p0', spell_id, target: { x: 7, y: 4 } },
    ctx,
  )

describe('#1012 — the sim plays the chain’s cast rules', () => {
  test('a level-200 seat casts EVERY unlocked spell, not the seven a deal happened to pick', () => {
    // Ten unlocked spells — three more than the retired seven-card hand, so an undealt one existed by
    // construction. Each costs 1 AP of the seat's 12, so AP can never be the reason a cast folds here.
    const spells = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [
        `spell_${index}`,
        spell_json(`Spell ${index}`),
      ]),
    )
    const { state, ctx, spell_ids } = started_fight(spells)

    const folded = spell_ids.reduce(
      (acc, spell_id) => {
        const result = cast(acc.state, ctx, spell_id)
        return {
          state: result.state,
          casts: [
            ...acc.casts,
            ...result.events.filter(e => e.type === 'fight_cast'),
          ],
        }
      },
      { state, casts: [] },
    )

    expect(folded.casts.map(e => e.spell_id)).toEqual(spell_ids)
    expect(find_entity(folded.state, 'm0')?.health).toBe(200 - 10 * DAMAGE)
    expect(find_entity(folded.state, 'p0')?.ap).toBe(12 - 10)
  })

  test('a spell authored `casts_per_turn: 2` casts twice in ONE turn', () => {
    const { state, ctx } = started_fight({
      twice: spell_json('Twice', { cost: 2, casts_per_turn: 2 }),
    })

    const first = cast(state, ctx, 'twice')
    const second = cast(first.state, ctx, 'twice')

    expect(first.events.filter(e => e.type === 'fight_cast').length).toBe(1)
    expect(second.events.filter(e => e.type === 'fight_cast').length).toBe(1)
    expect(find_entity(second.state, 'm0')?.health).toBe(200 - 2 * DAMAGE)
    expect(find_entity(second.state, 'p0')?.ap).toBe(12 - 4)

    // The authored cap is still the ONLY limit: a third cast is refused by casts_per_turn, not by a discard.
    const third = cast(second.state, ctx, 'twice')
    expect(third.events.filter(e => e.type === 'fight_cast').length).toBe(0)
    expect(find_entity(third.state, 'm0')?.health).toBe(200 - 2 * DAMAGE)
  })
})
