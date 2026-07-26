// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// sim_chain_silent_cast.test.js — #1012's RED: the local chain must never eat a committed cast in silence.
//
// THE MEASURED SYMPTOM. On /simulator a level-200 seat commits a staged `{ kind:1, target, spell_template_id }`
// turn, the commit "succeeds" (a version lands), and the receipt carries ONLY TurnEnded/TurnStarted: no Cast,
// no Hit, no AP spent, no refusal, nothing on the console. The player pressed a card and the game did nothing.
//
// THE MECHANISM this file pins. The staged id space is NOT the miss (`in_hand_cast_folds_the_full_envelope`
// is the positive control: the very same door, a dealt card, folds the whole envelope and spends the AP). The
// miss is HAND MEMBERSHIP: `packages/sim`'s reducer only honours a cast whose spell sits in the caster's dealt
// hand (`handle_cast`'s `current.hand.includes` gate, HAND_SIZE = 7), while the mounted spell bar offers every
// class spell the character unlocked — 20 of them at level 200. Cast the 8th and the reducer returns the state
// untouched with zero events, which `submit_commands` used to encode as a perfectly ordinary empty turn.
//
// THE LAW THIS GATE CARRIES (docs/CODE_LAW.md, no silent failures): whatever the reason a staged cast cannot
// fold — an id the ctx cannot resolve, a card the seat does not hold, a rule the sim refuses — the local chain
// REFUSES LOUDLY and names it, exactly as `commands_from_staged` already throws for the kind-2 weapon strike.
// A refusal rolls the drafted turn back through the production failure path; a silent no-op steals the turn.

import { describe, test, expect } from 'bun:test'

import * as SE from '../../sim/src/spell_effect.js'
import { encode } from '../src/los.js'
import {
  arena_from_board,
  create_sim_chain,
  current_actor,
  derive_board,
  pending_mob_turn,
  run_ai_turn,
  submit_staged,
} from '../src/sim_chain.js'

const SEED = 0xc81f3a92
const FIGHT_ID = 'sim:c81f3a92:1'
const NOW = 1_784_752_468_344
const HAND_SIZE = 7 // packages/sim reduce.js — the opening deal every player seat gets

const level = (effects, { ap_cost = 1, range_max = 14 } = {}) => ({
  ap_cost,
  range_min: 0,
  range_max,
  modifiable_range: false,
  line_launch: false,
  line_of_sight: false,
  free_cell: false,
  casts_per_turn: 255,
  casts_per_target: 255,
  cooldown_turns: 0,
  crit_rate: 0,
  effects: effects.map((e) => ({ chance: 100, ...e })),
  crit_effects: [],
})

const damage = (id, value) => ({
  id,
  levels: [level([{ kind: SE.K_DAMAGE, element: 0, value, target_filter: SE.TF_NOT_TEAM }])],
})

/** A level-200-shaped class deck: MORE spells than one opening hand can hold. That is the whole fixture. */
const PLAYER_KIT = Array.from({ length: HAND_SIZE + 2 }, (_unused, i) => damage(`0xspell_${i}`, 12))
const MOB_KIT = [damage('0xmob_hit', 5)]
const TEMPLATES_RAW = [...PLAYER_KIT, ...MOB_KIT]
const PLAYER_DECK = PLAYER_KIT.map((s) => s.id)

const fighter = (id, cell, is_player, { health, ap, deck }) => ({
  id,
  name: id,
  cell,
  health,
  health_max: health,
  ap,
  ap_max: ap,
  mp: 4,
  mp_max: 4,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'yajin' : '0xmob_template',
  level: is_player ? 200 : 80,
  stats: {},
  effects: [],
  deck: [...deck],
  hand: is_player ? [] : [...deck], // players are dealt at start; mobs come pre-handed
  discard: [],
  spell_levels: Object.fromEntries(deck.map((s) => [s, 1])),
  ap_reserve: 0,
})

/** The player on a team-A start cell with a walkable neighbour holding the mob — melee range, no LOS argument. */
const build_chain = () => {
  const { board } = derive_board(SEED)
  const arena = arena_from_board(board)
  const [me] = arena.spawns_a
  const walkable = ({ x, y }) =>
    x >= 0 && y >= 0 && x < arena.width && y < arena.height && arena.cells[y * arena.width + x] === 0
  const mob_cell = [
    { x: me.x + 1, y: me.y },
    { x: me.x, y: me.y + 1 },
    { x: me.x - 1, y: me.y },
    { x: me.x, y: me.y - 1 },
  ].find(walkable)
  expect(mob_cell).toBeDefined()
  return create_sim_chain({
    seed: SEED,
    fight_id: FIGHT_ID,
    team0: [fighter('sim_c1', me, true, { health: 1440, ap: 6, deck: PLAYER_DECK })],
    team1: [fighter('mob_0', mob_cell, false, { health: 1050, ap: 4, deck: MOB_KIT.map((s) => s.id) })],
    templates_raw: TEMPLATES_RAW,
  })
}

/** Fold mob turns until the roster seat holds the turn — the state a committed player turn starts from. */
const on_my_turn = (chain) => {
  let live = chain
  for (let i = 0; i < 8 && pending_mob_turn(live) != null; i++)
    live = run_ai_turn(live, pending_mob_turn(live), { now_ms: NOW }).chain
  expect(current_actor(live)).toBe('sim_c1')
  return live
}

/** The exact staging the board performs for one card (DungeonBoard flush_commit / dev_cast), through the exact
 *  door `fight_shim.commit_turn` routes a committed turn into. */
const commit_cast = (chain, spell_template_id) => {
  const target = chain.sim_state.team1[0].cell
  return submit_staged(chain, [{ kind: 1, target: encode(target.x, target.y), spell_template_id }], 'sim_c1', {
    now_ms: NOW,
  })
}

const seat = (chain) => chain.sim_state.team0.find((e) => e.id === 'sim_c1')
const row_kinds = (result) => result.receipt.events.map((row) => String(row.type).split('::').pop())

describe('the local chain never eats a committed cast (#1012)', () => {
  test('the fixture reproduces a real seat: more castable spells than one hand holds', () => {
    const chain = build_chain()
    const me = seat(chain)

    expect(me.hand.length).toBe(HAND_SIZE)
    expect(me.deck.length).toBeGreaterThan(0) // the undealt remainder — castable on chain, dead here
    expect(PLAYER_DECK.length).toBeGreaterThan(HAND_SIZE)
  })

  test('in-hand cast folds the full envelope and spends the AP (the positive control)', () => {
    const chain = on_my_turn(build_chain())
    const [dealt] = seat(chain).hand
    const ap_before = seat(chain).ap
    const hp_before = chain.sim_state.team1[0].health

    const result = commit_cast(chain, dealt)
    const after = result.chain

    expect(row_kinds(result)).toContain('Cast')
    expect(row_kinds(result)).toContain('Hit')
    expect(after.sim_state.team1[0].health).toBeLessThan(hp_before)
    // AP is spent on the caster's own turn; the pool refills only when the turn comes back around.
    expect(seat({ sim_state: result.chain.sim_state }).ap).toBeLessThan(ap_before)
  })

  test('a staged cast the seat cannot fold REFUSES LOUDLY — never an empty committed turn', () => {
    const chain = on_my_turn(build_chain())
    const [undealt] = seat(chain).deck

    // The id space is exonerated: the ctx resolves this very template. What the seat lacks is the CARD.
    expect(chain.ctx.spell_templates.has(undealt)).toBe(true)
    expect(seat(chain).hand).not.toContain(undealt)

    expect(() => commit_cast(chain, undealt)).toThrow(/sim_chain: cast .* folded nothing/)
  })

  test('the SECOND cast of one card in a turn refuses too — the turn is all or nothing', () => {
    const chain = on_my_turn(build_chain())
    const [dealt] = seat(chain).hand
    const target = chain.sim_state.team1[0].cell
    const staged = Array.from({ length: 2 }, () => ({
      kind: 1,
      target: encode(target.x, target.y),
      spell_template_id: dealt,
    }))

    // The sim discards a cast card out of the hand, so the second copy folds nothing — on chain the spell's
    // own `casts_per_turn` would have allowed it. Loud, and the WHOLE turn is refused: the caller keeps the
    // pre-turn chain, so the first cast never half-commits.
    expect(() => submit_staged(chain, staged, 'sim_c1', { now_ms: NOW })).toThrow(/already cast that card/)
  })

  test('a staged cast naming a template the ctx cannot resolve REFUSES LOUDLY', () => {
    const chain = on_my_turn(build_chain())

    expect(chain.ctx.spell_templates.has('0xnot_a_template')).toBe(false)
    expect(() => commit_cast(chain, '0xnot_a_template')).toThrow(/sim_chain: cast .* folded nothing/)
  })
})
