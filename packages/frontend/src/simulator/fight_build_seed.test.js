// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight_build_seed.test.js — RED-FIRST for #1065: the build a player assembles must be the build the fight
// fights. Two halves, one fixture:
//
//   ① THE GEAR FOLD. A worn template's contribution is read out of the corpus row by the CATALOG's own
//      (Move `item_stats`) field names, but a corpus row keys its stats by the /v1 decode home's UI names —
//      and the two spellings diverge on exactly six fields (`critical`→`criticalHit`, `raw_damage`→
//      `rawDamage`, the four resistances). Those six therefore folded to ZERO on every simulated seat while
//      the identically-spelled ones (vitality/strength/…) and the aliased AP/MP pair landed — the split the
//      live report narrowed to ("gear AP/MP IS applied, the damage stats are not").
//   ② THE DAMAGE MATH. The same seat, driven through the page's own START door and the real sim chain, must
//      deal what the chain formula says for the CHOSEN spell level with those composed stats — flat gear
//      damage included. Half a stat block reaching the entity is a wrong number on every hit.
//
// Nothing here is shaped by the code under test: the item is a captured `/v1/encyclopedia` row decoded by the
// production corpus door, the spells are captured corpus wire, and the damage oracle is @aresrpg/sim's own
// `calculate_raw_damage` — the chain-parity formula, fed stats derived from the fixture rather than from the
// fold being tested.

import { describe, expect, test } from 'bun:test'
import { encode } from '@aresrpg/fight/los'
import {
  commands_from_staged,
  create_sim_chain,
  current_actor,
  pending_mob_turn,
  submit_commands,
} from '@aresrpg/fight/sim_chain'
import { calculate_raw_damage } from '@aresrpg/sim/spell_calculator'

import { set_spell_corpus_for_test } from '../game/data/spell_corpus.js'
import encyclopedia_fixture from '../rpc/fixtures/encyclopedia.json'
import { item_corpus_from_v1 } from '../pages/encyclopedia/item_corpus'

import { board_of } from './board'
import { BASE_AP, BASE_MP, build_seat } from './content.js'
import { build_start_args } from './fight_start.js'
import { EMPTY_STAT_ALLOC, INITIAL_SIMULATOR_STATE, normalize_character } from './reducer'
import ITEM_WIRE from './item_corpus_wire.fixture.json'
import SPELL_WIRE from './spell_corpus_wire.fixture.json'

const SEED = 0xc81f3a92
const BOARD = board_of(SEED, 0)
const CLOCK = { now_ms: 1_700_000_000_000 }
const CORPUS = SPELL_WIRE.rows
const WARCLEAVE = CORPUS.find((row) => row.id === 'senshi_warcleave')

/**
 * The captured amulet, through the PRODUCTION corpus door — the same rows `useItemCorpus` hands the page.
 * Its identity is paired with a template id from the captured live `/v1` response; everything the fold reads
 * is the captured item wire.
 */
const [LIVING_ID] = encyclopedia_fixture.items.map(({ template_id }) => template_id)
const [AMULET] = item_corpus_from_v1([{ ...ITEM_WIRE.row, template_id: LIVING_ID }])

/**
 * The amulet's MAX-ROLL contribution, read straight off the fixture's own biased wire (value − 32768) rather
 * than off the fold under test. `equip_item` resolves the ceiling of every authored range, so the max half is
 * what a simulated seat wears.
 */
const gear = (chain_field) => Number(ITEM_WIRE.row.stats[chain_field][1]) - 32_768

const INVESTED = { ...EMPTY_STAT_ALLOC, vitality: 120, strength: 45 }

/** The level-101 Senshi the fixture describes: invested points plus the one captured amulet. */
const character = () =>
  normalize_character({
    id: 'sim_c1',
    name: 'KAELIS',
    class_id: 'senshi',
    male: true,
    // 101 is Warcleave's own `min_char_level` for level 6 — the chain gate the builder's dropdown mirrors.
    level: 101,
    stat_alloc: INVESTED,
    spell_levels: { warcleave: 6 },
    loadout: { amulet: AMULET.id },
  })

/** A spell-less mob: it walks in and never casts, so every hp point it loses came from the player's cast. */
const MOB = {
  id: '0xmob_gronk',
  name: 'Gronk',
  element: 'earth',
  role: 'trash',
  minLevel: 10,
  maxLevel: 20,
  base_hp: 4000,
  ap: 6,
  mp: 3,
}

const chebyshev = (left, right) => Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y))

/** The page's real START door, fed both captured corpora through the seams every fight surface reads. */
const start_args = () => {
  set_spell_corpus_for_test(CORPUS)
  return build_start_args({
    state: {
      ...INITIAL_SIMULATOR_STATE,
      seed: SEED,
      roster: [character()],
      focus_id: 'sim_c1',
      placements: { [BOARD.start_cells_a[0]]: 'sim_c1' },
      mob_picks: { [BOARD.start_cells_b[0]]: { template_id: MOB.id, level: 12 } },
    },
    board: BOARD,
    item_by_id: new Map([[AMULET.id, AMULET]]),
    mob_by_id: new Map([[MOB.id, MOB]]),
    mob_spells_of: () => [],
  })
}

/** Walk the seat into Warcleave's reach and commit ONE cast, staged exactly as the production board stages it. */
const walk_in_and_cast = () => {
  const built = start_args()
  const opened = create_sim_chain({ ...built.args, fight_id: 'sim:1065:1' })
  const drive = (state) => {
    if (state.rounds > 60) return { ...state, exhausted: true }
    const mob_turn = pending_mob_turn(state.chain)
    if (mob_turn) {
      const stepped = submit_commands(state.chain, [{ type: 'ai_turn', entity_id: mob_turn }], CLOCK)
      if (stepped.chain.sim_state === state.chain.sim_state) return { ...state, exhausted: true }
      return drive({ ...state, chain: stepped.chain, rounds: state.rounds + 1 })
    }
    const actor = current_actor(state.chain)
    if (!actor) return { ...state, exhausted: true }
    const [me] = state.chain.sim_state.team0
    const [mob] = state.chain.sim_state.team1
    if (chebyshev(me.cell, mob.cell) <= 2) {
      const staged = [
        {
          kind: 1,
          spell_template_id: WARCLEAVE.object_id,
          spell_key: 'warcleave',
          target: encode(mob.cell.x, mob.cell.y),
        },
      ]
      const cast = submit_commands(state.chain, commands_from_staged(staged, actor), CLOCK)
      return { ...state, chain: cast.chain, cast, target_hp_before: mob.health }
    }
    const walk = Array.from({ length: me.mp }).reduce(
      (acc) => {
        if (chebyshev(acc.cell, mob.cell) <= 1) return acc
        const next = {
          x: acc.cell.x + Math.sign(mob.cell.x - acc.cell.x),
          y: acc.cell.y + Math.sign(mob.cell.y - acc.cell.y),
        }
        return { cell: next, path: [...acc.path, next] }
      },
      { cell: me.cell, path: [] }
    )
    const stepped = submit_commands(
      state.chain,
      commands_from_staged(
        walk.path.map((cell) => ({ kind: 0, target: encode(cell.x, cell.y) })),
        actor
      ),
      CLOCK
    )
    if (stepped.chain.sim_state === state.chain.sim_state) return { ...state, exhausted: true }
    return drive({ ...state, chain: stepped.chain, rounds: state.rounds + 1 })
  }
  return { opened, ...drive({ chain: opened, rounds: 0, cast: null, target_hp_before: 0, exhausted: false }) }
}

describe('#1065 · the composed build reaches the fight seat', () => {
  const seat = build_seat(character(), [AMULET])

  test('the captured amulet decodes to a real contribution — the fixture is not neutral', () => {
    expect(AMULET.id).toBe(LIVING_ID)
    expect(gear('strength')).toBeGreaterThan(0)
    expect(gear('raw_damage')).toBeGreaterThan(0)
    expect(gear('critical')).toBeGreaterThan(0)
  })

  test('every gear field the fold consumes lands — not just the ones spelled the same on both sides', () => {
    // The halves that already worked: identically-spelled primaries and the ap/mp alias pair.
    expect(seat.stats.strength).toBe(INVESTED.strength + gear('strength'))
    expect(seat.stats.vitality).toBe(INVESTED.vitality + gear('vitality'))
    expect(seat.ap_max).toBe(BASE_AP + gear('action'))
    expect(seat.mp_max).toBe(BASE_MP + gear('movement'))
    expect(seat.stats.range).toBe(gear('range'))
    // The halves that did not: the six fields whose corpus key is the /v1 decode's UI spelling.
    expect(seat.stats.raw_damage).toBe(gear('raw_damage'))
    expect(seat.stats.critical_hit).toBe(gear('critical'))
    expect(seat.stats.earth_resistance).toBe(gear('earth_resistance'))
    expect(seat.stats.fire_resistance).toBe(gear('fire_resistance'))
    expect(seat.stats.water_resistance).toBe(gear('water_resistance'))
    expect(seat.stats.air_resistance).toBe(gear('air_resistance'))
  })

  test('and the fight entity carries the CHOSEN spell level, keyed as a committed cast names it', () => {
    const [entity] = start_args().args.team0
    expect(entity.spell_levels[WARCLEAVE.object_id]).toBe(6)
    expect(entity.stats).toEqual(seat.stats)
  })
})

describe('#1065 · BEHAVIOUR: the fight deals the composed build s damage', () => {
  const run = walk_in_and_cast()

  test('one committed cast lands, at the chosen level, for the chain formula s own amount', () => {
    expect(run.exhausted).toBeFalsy()
    expect(run.cast).not.toBeNull()
    const hits = run.cast.receipt.events.filter((row) => row.type.endsWith('Hit'))
    expect(hits.length).toBeGreaterThan(0)

    // The template the chain resolved, at the level the seat chose — level 6 is index 5, and its authored band
    // is strictly above level 1's, so a seeding that lost the level cannot pass this by accident.
    const template = run.chain.ctx.spell_templates.get(WARCLEAVE.object_id)
    const [level_one, , , , , level_six] = template.levels
    const cast_event = run.cast.receipt.events.find((row) => row.type.endsWith('Cast'))
    const effects = cast_event.parsedJson.is_critical ? level_six.crit_effects : level_six.base_effects
    const damage_effect = effects.find((effect) => effect.type === 'DAMAGE')
    expect(damage_effect.min).toBeGreaterThan(
      (level_one.base_effects.find((effect) => effect.type === 'DAMAGE') ?? {}).min
    )

    // THE ORACLE: the chain-parity formula, fed the stats the FIXTURE says this build has — invested points
    // plus the amulet's max roll, flat gear damage included. Independent of the fold under test.
    const composed = {
      strength: INVESTED.strength + gear('strength'),
      raw_damage: gear('raw_damage'),
    }
    const band = calculate_raw_damage(damage_effect, composed)
    const dealt = Number(hits[0].parsedJson.amount)
    expect(dealt).toBeGreaterThanOrEqual(band.min)
    expect(dealt).toBeLessThanOrEqual(band.max)
    expect(run.chain.sim_state.team1[0].health).toBeLessThan(run.target_hp_before)
  })
})
