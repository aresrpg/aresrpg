// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The shared fight profile of the strategy catalogue, played by a class it does not name.
// Regression (owner report 2026-11-22): an Ikari sent to fight used one weapon strike a turn, ended its
// turn beside a monster without attacking, and never cast a punishment on itself.
import { expect, test } from 'bun:test'
import { board_zone_cells, CONTRACT_CONSTANTS, create_character_source, create_fight } from '@aresrpg/fight'

import catalogue from '../../../seed/content/strategies.json'
import spells from '../../../seed/content/spells.json'
import { encode_cell, mask_from_cells } from '../../fight/src/combat_grid.ts'
import { parse_combat_profile } from '../src/combat_profile.ts'
import { plan_combat_turn } from '../src/combat_tactics.ts'
import { fight_turn_inputs, type FightTurnPayload } from '../src/gameplay.ts'

import { character_id, placement } from './helpers/combat_runtime_fixture.ts'

const cell = (x: number, y = 5) => encode_cell(BigInt(x), BigInt(y))
/** A level 30 hero of a class with 8 action points, and one monster standing at `enemy`. */
const hero = (classe: string, enemy: bigint, build: Readonly<Record<string, bigint>> = {}) => {
  const state = placement()
  state.sources.players[character_id] = create_character_source({ classe, level: 30n, ...build })
  state.sources.spells = Object.fromEntries(spells.map(({ name, ...spell }) => [name, spell])) as never
  state.contract.closed = mask_from_cells([])
  state.contract.board.shape_mask = mask_from_cells(
    Array.from({ length: Number(CONTRACT_CONSTANTS.grid_cells) }, (_, index) => BigInt(index))
  )
  state.contract.board.obstacles = []
  state.contract.board.holes = []
  state.contract.round = 1n
  state.contract.queue = [0n, 1n]
  state.contract.turn_ptr = 0n
  state.contract.turn_started_ms = 60_000n
  Object.assign(state.contract.fighters[0]!, { cell: cell(5), ap: 8n, mp: 3n })
  Object.assign(state.contract.fighters[1]!, { cell: enemy, hp: 1_000n })
  return create_fight({ state, mode: 'remote' }).state()
}
const ikari = (enemy: bigint) => hero('ikari', enemy)
const shared = parse_combat_profile(catalogue.profile)
type State = ReturnType<typeof hero>
const play = (state: State, actions: FightTurnPayload['actions']): State => {
  const runtime = create_fight({ state, mode: 'remote' })
  for (const action of fight_turn_inputs({ fighter_idx: '0', actions } as FightTurnPayload))
    expect(runtime.apply({ ...action, observed_ms: 63_000n }).error).toBeNull()
  return runtime.state()
}
const casts = (actions: FightTurnPayload['actions']) =>
  actions.flatMap((action) => (action.type === 'cast' ? [action.spell] : []))
/** A boost is a cast on the hero's own cell; the hero stands on cell 5 until it walks. */
const OWN = String(cell(5))
const boosts_of = (actions: FightTurnPayload['actions']) =>
  actions.flatMap((action) => (action.type === 'cast' && action.target_cell === OWN ? [action.spell] : []))
/** The hero's next turn on the same board: its points are back, and nothing is on cooldown, so only
 * what is already in effect can stop a boost from being cast again. */
const next_turn = (state: State): State => {
  const next = structuredClone(state)
  Object.assign(next.contract.fighters[0]!, { ap: 8n, mp: 3n, cooldowns: [] })
  next.contract.turn_casts = []
  return create_fight({ state: next, mode: 'remote' }).state()
}
/** Plays turns until the hero casts no boost any more; the plan of that turn and the state before it. */
const once_boosted = (start: State) => {
  let state = start
  for (let turn = 0; turn < 6; turn += 1) {
    const { actions } = plan_combat_turn(shared, state, 0n, 63_000n)
    if (!boosts_of(actions).length) return { state, actions }
    state = next_turn(play(state, actions))
  }
  throw new Error('the hero never stopped boosting')
}

// Owner ruling 2026-11-22: "self boost should be the first action ... then start attacking next turn".
test('the first action of a fight is a boost on the hero itself, never stacked and never cast again while in effect', () => {
  const state = ikari(cell(4))
  const { actions } = plan_combat_turn(shared, state, 0n, 63_000n)
  const boosts = boosts_of(actions)
  expect(actions[0]).toMatchObject({ type: 'cast', target_cell: OWN })
  // Ikari's punishments are among them, each cast once.
  expect(boosts.some((spell) => spell.endsWith('Punishment'))).toBe(true)
  expect(new Set(boosts).size).toBe(boosts.length)
  const after = play(state, actions)
  expect(after.contract.fighters[0]!.effects.length).toBeGreaterThan(state.contract.fighters[0]!.effects.length)
  expect(after.contract.fighters[0]!.hp).toBe(state.contract.fighters[0]!.hp)
  const again = plan_combat_turn(shared, next_turn(after), 0n, 63_000n)
  expect(casts(again.actions).filter((spell) => boosts.includes(spell))).toEqual([])
})

test('once its boosts are in effect the hero attacks with its spells, as often as its action points allow', () => {
  const { state, actions } = once_boosted(ikari(cell(4)))
  // It does not end its turn empty-handed beside the monster, and it does not stop at one hit.
  expect(actions.length).toBeGreaterThanOrEqual(2)
  expect(boosts_of(actions)).toEqual([])
  const after = play(state, actions)
  expect(after.contract.fighters[1]!.hp).toBeLessThan(1_000n)
  // The points are spent: not enough is left for another attack of the kind it used.
  expect(after.contract.fighters[0]!.ap).toBeLessThan(4n)
})

test('with no monster in reach the hero boosts, then walks closer', () => {
  const { actions } = plan_combat_turn(shared, ikari(cell(14)), 0n, 63_000n)
  expect(actions[0]).toMatchObject({ type: 'cast', target_cell: OWN })
  expect(actions.some((action) => action.type === 'move')).toBe(true)
})

// Owner ruling 2026-11-22: "a boost for strength is only smart if the character has earth damage ...
// do not bother boosting agility for a fire yogan". A boost for raw damage or points is good in any case.
test('a boost of an elemental characteristic is cast only for the element the hero is built on', () => {
  const punishments = (build: Readonly<Record<string, bigint>>) =>
    casts(plan_combat_turn(shared, hero('ikari', cell(14), build), 0n, 63_000n).actions).filter((spell) =>
      spell.endsWith('Punishment')
    )
  // Ikari has a punishment for each element. Built on strength, only the strength one is worth its points.
  expect(punishments({ strength: 200n })).toEqual(['Forced Punishment'])
  // Built on agility, only the agility one.
  expect(punishments({ agility: 200n })).toEqual(['Nimble Punishment'])
})

test('a helpful glyph laid under the hero is a boost too, and one already there is not laid again', () => {
  const state = hero('tomoda', cell(14))
  const own = state.contract.fighters[0]!.cell
  const { actions } = plan_combat_turn(shared, state, 0n, 63_000n)
  // The game lays a glyph on a free cell only: it goes beside the hero, and its area covers the hero.
  expect(casts(actions)[0]).toBe('Pack Totem')
  const after = play(state, [actions[0]!])
  const glyph = after.contract.zones.find(({ owner_fighter }) => owner_fighter === 0n)!
  expect(board_zone_cells(glyph)).toContain(own)
  const again = plan_combat_turn(shared, next_turn(after), 0n, 63_000n)
  expect(casts(again.actions)).not.toContain('Pack Totem')
})

test('a profile that names its own spells keeps working unchanged', () => {
  const named = parse_combat_profile({
    version: '1',
    intent: 'One named spell.',
    combos: [{ name: 'hit', steps: [{ type: 'cast', spell: "Ikari's Foot", target: 'nearest_enemy' }] }],
    rules: [{ when: { type: 'always' }, combo: 'hit' }],
    fallback: 'end_turn',
  })
  expect(casts(plan_combat_turn(named, ikari(cell(4)), 0n, 63_000n).actions)).toEqual(["Ikari's Foot"])
})
