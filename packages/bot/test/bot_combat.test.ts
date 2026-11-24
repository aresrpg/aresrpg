// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Combat profiles and tactics: targeting, support, the class-blind profile.
import { expect, test, describe } from 'bun:test'
import { create_character_source, create_fight, spell_target_cells, CONTRACT_CONSTANTS } from '@aresrpg/fight'

import spells from '../../../seed/content/spells.json'
import { fixture as fight_fixture } from '../../fight/test/helpers.ts'
import { parse_combat_profile, validate_profile_character, type CombatProfile } from '../src/combat_profile.ts'
import { plan_combat_turn } from '../src/combat_tactics.ts'
import { encode_cell, mask_from_cells } from '../../fight/src/combat_grid.ts'
import { next_behavior_action } from '../src/behavior_plan.ts'
import { parse_behavior_script, type BehaviorRun } from '../src/behavior_script.ts'
import { empty_behavior_memory } from '../src/behavior_tree.ts'
import { fight_turn_inputs, type FightTurnPayload } from '../src/gameplay.ts'
import { create_runtime } from '../../fight/src/runtime.ts'
import { tick_turn_start } from '../../fight/src/turn_effects.ts'
import { support_beneficiaries } from '../src/combat_support.ts'

import { put } from './fixture.ts'
import {
  fight_character_id as character_id,
  combat_fixture,
  placement,
  generic_profile,
  started_fight,
} from './fixture_fight.ts'

describe('combat profile', () => {
  const profile = (): CombatProfile => ({
    version: '1',
    intent: 'Strength: traps then retreat. Do not allocate capital.',
    combos: [
      {
        name: 'traps',
        steps: [
          { type: 'cast', spell: 'Tricky Trap', target: 'trap_near_enemy' },
          { type: 'cast', spell: 'Mass Trap', target: 'trap_near_enemy' },
        ],
      },
      { name: 'escape', steps: [{ type: 'move', direction: 'retreat' }] },
    ],
    rules: [
      { when: { type: 'always' }, combo: 'traps' },
      { when: { type: 'always' }, combo: 'escape' },
    ],
    fallback: 'end_turn',
  })
  const checkpoint = () => {
    const state = structuredClone({ checkpoint: fight_fixture() }.checkpoint)
    state.sources.players['0xc1'] = create_character_source({ classe: 'yajin', level: 30n, strength: 100n })
    state.sources.spells = Object.fromEntries(spells.map(({ name, ...spell }) => [name, spell])) as never
    state.contract.closed = state.contract.closed.map(() => 0n)
    state.contract.round = 1n
    state.contract.queue = [0n, 1n]
    state.contract.turn_ptr = 0n
    state.contract.turn_started_ms = 1_000n
    state.contract.fighters[0]!.cell = 105n
    state.contract.fighters[0]!.ap = 6n
    state.contract.fighters[0]!.mp = 3n
    state.contract.fighters[1]!.cell = 109n
    return create_fight({ state, mode: 'remote' }).state()
  }

  test('profile validation rejects arbitrary code, unknown spells and ambiguous combo references', () => {
    expect(parse_combat_profile(profile())).toEqual(profile())
    expect(() => parse_combat_profile({ ...profile(), script: 'run()' })).toThrow()
    expect(() => parse_combat_profile({ ...profile(), combos: [profile().combos[0], profile().combos[0]] })).toThrow(
      'duplicate_combo'
    )
    expect(() =>
      parse_combat_profile({ ...profile(), rules: [{ when: { type: 'always' }, combo: 'missing' }] })
    ).toThrow('unknown_combo')
    expect(() =>
      parse_combat_profile({
        ...profile(),
        combos: [{ name: 'x', steps: [{ type: 'cast', spell: 'invented', target: 'self' }] }],
      })
    ).toThrow('unknown_combat_spell')
    expect(validate_profile_character(profile(), { classe: 'yajin', level: 1, spells: {} })).toEqual(['Mass Trap'])
    expect(validate_profile_character(profile(), { classe: 'senshi', level: 200, spells: {} })).toEqual([
      'Tricky Trap',
      'Mass Trap',
    ])
  })

  test('trap combo retains its legal prefix then retreats, deterministically without mutating the source', () => {
    const state = checkpoint()
    const before = structuredClone(state)
    const result = plan_combat_turn(profile(), state, 0n, 4_000n)
    expect(result.actions.map(({ type }) => type)).toEqual(['cast', 'move'])
    const cast = result.actions[0]!
    if (cast.type !== 'cast') throw new Error('expected trap')
    expect(cast.spell).toBe('Tricky Trap')
    expect(spell_target_cells(state, 0n, cast.spell).targetable).toContain(BigInt(cast.target_cell))
    const simulation = create_fight({ state, mode: 'remote' })
    simulation.apply({
      type: 'cast_spell',
      fighter: 0n,
      spell: cast.spell,
      target_cell: BigInt(cast.target_cell),
      observed_ms: 4_000n,
    })
    expect(simulation.state().contract.zones.length).toBeGreaterThan(0)
    expect(simulation.state().contract.fighters[1]!.hp).toBe(state.contract.fighters[1]!.hp)
    expect(result.skipped.length).toBe(1)
    expect(plan_combat_turn(profile(), state, 0n, 4_000n)).toEqual(result)
    expect(state).toEqual(before)
  })
})

describe('combat tactics', () => {
  const cell = (x: number, y = 5) => encode_cell(BigInt(x), BigInt(y))
  const checkpoint = (walls = [cell(8)]) => {
    const state = placement()
    state.sources.players[character_id] = create_character_source({ classe: 'yajin', level: 30n })
    state.sources.spells = Object.fromEntries(spells.map(({ name, ...spell }) => [name, spell])) as never
    state.contract.closed = mask_from_cells(walls)
    state.contract.board.shape_mask = mask_from_cells(
      Array.from({ length: Number(CONTRACT_CONSTANTS.grid_cells) }, (_, index) => BigInt(index))
    )
    state.contract.board.obstacles = walls
    state.contract.board.holes = []
    state.contract.round = 1n
    state.contract.queue = [0n, 1n, 2n]
    state.contract.turn_ptr = 0n
    state.contract.turn_started_ms = 60_000n
    Object.assign(state.contract.fighters[0]!, { cell: cell(5), ap: 8n, mp: 3n })
    Object.assign(state.contract.fighters[1]!, { cell: cell(4), hp: 1_000n })
    state.contract.fighters.push({ ...structuredClone(state.contract.fighters[1]!), cell: cell(6) })
    return create_fight({ state, mode: 'remote' }).state()
  }
  const profile = (): CombatProfile =>
    parse_combat_profile({
      version: '1',
      intent: 'Push for damage, then hit the displaced enemy.',
      combos: [
        {
          name: 'attack',
          steps: [
            { type: 'cast', spell: 'Tricky Blow', target: 'highest_damage_enemy' },
            { type: 'cast', spell: 'Deviousness', target: 'lowest_hp_enemy' },
          ],
        },
      ],
      rules: [{ when: { type: 'always' }, combo: 'attack' }],
      fallback: 'awaiting_ai',
    })
  const replay = (state: ReturnType<typeof checkpoint>, actions: FightTurnPayload['actions']) => {
    const runtime = create_fight({ state, mode: 'remote' })
    return fight_turn_inputs({ fighter_idx: '0', actions } as FightTurnPayload).flatMap((action) => {
      const result = runtime.apply({ ...action, observed_ms: 63_000n })
      expect(result.error).toBeNull()
      return result.events
    })
  }

  test('autonomous damage targeting chooses wall collision over equal-range free push and chains displaced state', () => {
    const state = checkpoint()
    const before = structuredClone(state)
    const planned = plan_combat_turn(profile(), state, 0n, 63_000n)
    expect(planned.actions).toEqual([
      { type: 'cast', spell: 'Tricky Blow', target_cell: String(cell(6)) },
      { type: 'cast', spell: 'Deviousness', target_cell: String(cell(7)) },
    ])
    const events = replay(state, planned.actions)
    expect(events.some(({ type }) => type === 'push_collided')).toBe(true)
    expect(plan_combat_turn(profile(), state, 0n, 63_000n)).toEqual(planned)
    expect(state).toEqual(before)
    const free = plan_combat_turn(profile(), checkpoint([]), 0n, 63_000n)
    expect(free.actions[0]).toMatchObject({ target_cell: String(cell(4)) })
  })

  test('accepted behavior combat sequences select and validate collision-aware ordinary turn actions', async () => {
    for (const [state, tactics] of [
      [checkpoint(), profile()],
      [positioning_checkpoint(), positioned_profile()],
    ] as const) {
      const f = await combat_fixture(state)
      const script = parse_behavior_script({
        version: '1',
        objective: { title: 'Wall-aware combat' },
        tree: { type: 'action', action: { type: 'combat', profiles: [{ character_id, profile: tactics }] } },
      })
      const run: BehaviorRun = {
        ...(await f.get_run()),
        character_id,
        script,
        revision: 1,
        memory: empty_behavior_memory(),
        pending_node: null,
        activation: null,
        consumed_command_id: null,
      }
      const next = next_behavior_action(run, null, f.context)
      expect(next.state).toBe('action')
      expect(next.action?.kind).toBe('fight_turn')
      expect(next.action?.payload.actions).toEqual(plan_combat_turn(tactics, state, 0n, 63_000n).actions)
      expect(next.record.activation?.fight).toBe(state.contract.id)
      replay(state, next.action!.payload.actions as FightTurnPayload['actions'])
    }
  })

  const positioned_profile = (): CombatProfile =>
    parse_combat_profile({
      ...profile(),
      combos: [
        {
          name: 'attack',
          steps: [{ type: 'cast', spell: 'Tricky Blow', target: 'highest_damage_enemy', position: 'best_damage' }],
        },
      ],
    })
  const positioning_checkpoint = (walls = [cell(6, 7)]) => {
    const state = checkpoint(walls)
    state.sources.players[character_id] = create_character_source({ classe: 'yajin', level: 30n, agility: 1_000n })
    state.contract.fighters[0]!.mp = 2n
    return state
  }

  test('position search finds a legal flank for wall damage rather than the nearest enemy or straight approach', () => {
    const state = positioning_checkpoint()
    const before = structuredClone(state)
    const stationary = plan_combat_turn(profile(), state, 0n, 63_000n)
    expect(replay(state, stationary.actions).some(({ type }) => type === 'push_collided')).toBe(false)
    const planned = plan_combat_turn(positioned_profile(), state, 0n, 63_000n)
    expect(planned.actions).toEqual([
      { type: 'move', path: [String(cell(5, 4)), String(cell(6, 4))] },
      { type: 'cast', spell: 'Tricky Blow', target_cell: String(cell(6)) },
    ])
    expect(replay(state, planned.actions).some(({ type }) => type === 'push_collided')).toBe(true)
    expect(state).toEqual(before)
    const chained = parse_combat_profile({
      ...positioned_profile(),
      combos: [
        {
          name: 'attack',
          steps: [
            ...positioned_profile().combos[0]!.steps,
            { type: 'cast', spell: 'Deviousness', target: 'lowest_hp_enemy' },
          ],
        },
      ],
    })
    const chain = plan_combat_turn(chained, state, 0n, 63_000n)
    expect(chain.actions.at(-1)).toMatchObject({ type: 'cast', spell: 'Deviousness', target_cell: String(cell(6, 6)) })
    replay(state, chain.actions)
    expect(plan_combat_turn(positioned_profile(), state, 0n, 63_000n)).toEqual(planned)
  })
})

describe('combat support', () => {
  const cell = (x: number, y = 5) => encode_cell(BigInt(x), BigInt(y))
  const checkpoint = () => {
    const state = placement()
    state.sources.players[character_id] = create_character_source({ classe: 'tomoda', level: 30n })
    state.sources.spells = Object.fromEntries(spells.map(({ name, ...spell }) => [name, spell])) as never
    state.contract.closed = mask_from_cells([])
    state.contract.board.shape_mask = mask_from_cells(
      Array.from({ length: Number(CONTRACT_CONSTANTS.grid_cells) }, (_, index) => BigInt(index))
    )
    state.contract.board.obstacles = []
    state.contract.board.holes = []
    state.contract.round = 1n
    state.contract.queue = [0n, 1n, 2n]
    state.contract.turn_ptr = 0n
    state.contract.turn_started_ms = 60_000n
    Object.assign(state.contract.fighters[0]!, { cell: cell(5), ap: 8n, mp: 3n })
    Object.assign(state.contract.fighters[1]!, { cell: cell(4), hp: 1_000n })
    state.contract.fighters.push({
      ...structuredClone(state.contract.fighters[1]!),
      team: state.contract.fighters[0]!.team,
      cell: cell(7),
    })
    return create_fight({ state, mode: 'remote' }).state()
  }
  const profile = () =>
    parse_combat_profile({
      version: '1',
      intent: 'Cover allies with a support glyph.',
      combos: [{ name: 'support', steps: [{ type: 'cast', spell: 'Pack Totem', target: 'most_allies' }] }],
      rules: [{ when: { type: 'always' }, combo: 'support' }],
      fallback: 'awaiting_ai',
    })

  test('Pack Totem covers caster and ally rather than the nearest enemy without claiming immediate buffs', () => {
    const state = checkpoint()
    const before = structuredClone(state)
    const planned = plan_combat_turn(profile(), state, 0n, 63_000n)
    expect(planned.actions).toEqual([{ type: 'cast', spell: 'Pack Totem', target_cell: String(cell(6)) }])
    const runtime = create_fight({ state, mode: 'remote' })
    const result = runtime.apply({
      type: 'cast_spell',
      fighter: 0n,
      spell: 'Pack Totem',
      target_cell: cell(6),
      observed_ms: 63_000n,
    })
    expect(result.error).toBeNull()
    expect(result.state.contract.zones).toHaveLength(1)
    expect(result.state.contract.fighters[2]!.effects).toEqual(before.contract.fighters[2]!.effects)
    const next = create_runtime(result.state)
    tick_turn_start(next, 2n)
    expect(next.contract.fighters[2]!.effects).toContainEqual({
      kind: 4n,
      stat: 9n,
      value: 5n,
      turns_left: 1n,
      source: 0n,
      element: '',
    })
    expect(state).toEqual(before)
    expect(plan_combat_turn(profile(), state, 0n, 63_000n)).toEqual(planned)
  })

  test('support scores new positive stat or pool gains, not existing buffs or enemy gains', () => {
    const before = checkpoint()
    const buff = { kind: 4n, stat: 9n, value: 5n, turns_left: 1n, source: 0n, element: '' }
    before.contract.fighters[0]!.effects = [buff]
    expect(support_beneficiaries(before, structuredClone(before), 0n)).toBe(0)
    const after = structuredClone(before)
    after.contract.fighters[1]!.effects.push(buff)
    expect(support_beneficiaries(before, after, 0n)).toBe(0)
    after.contract.fighters[2]!.effects.push(buff)
    expect(support_beneficiaries(before, after, 0n)).toBe(1)
    after.contract.fighters[0]!.hp += 1n
    expect(support_beneficiaries(before, after, 0n)).toBe(2)
  })
})

describe('combat generic', () => {
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
  const shared = parse_combat_profile(generic_profile)
  type State = ReturnType<typeof hero>
  const play = (state: State, actions: FightTurnPayload['actions']): State => {
    const runtime = create_fight({ state, mode: 'remote' })
    for (const action of fight_turn_inputs({ fighter_idx: '0', actions } as FightTurnPayload))
      expect(runtime.apply({ ...action, observed_ms: 63_000n }).error).toBeNull()
    return runtime.state()
  }
  const casts = (actions: FightTurnPayload['actions']) =>
    actions.flatMap((action) => (action.type === 'cast' ? [action.spell] : []))
  test('the class-blind profile attacks with every learned spell, as often as its action points allow', () => {
    const state = ikari(cell(4))
    const { actions } = plan_combat_turn(shared, state, 0n, 63_000n)
    // It does not end its turn empty-handed beside the monster, and it does not stop at one hit.
    expect(actions.length).toBeGreaterThanOrEqual(2)
    const after = play(state, actions)
    expect(after.contract.fighters[1]!.hp).toBeLessThan(1_000n)
    // The points are spent: not enough is left for another attack of the kind it used.
    expect(after.contract.fighters[0]!.ap).toBeLessThan(4n)
  }, 30_000)

  test('a profile or tree that names the removed boost step is refused, and a stored one waits for its author', async () => {
    const boosting = {
      ...generic_profile,
      combos: [...generic_profile.combos, { name: 'boost', steps: [{ type: 'boost' }] }],
    }
    expect(() => parse_combat_profile(boosting)).toThrow('combat_boost_removed')
    const tree = {
      version: '1',
      objective: { title: 'Fight' },
      tree: { type: 'action', action: { type: 'combat', allies: [], profiles: [{ character_id, profile: boosting }] } },
    }
    expect(() => parse_behavior_script(tree)).toThrow('combat_boost_removed')
    const f = await combat_fixture(started_fight())
    const stored = await f.get_run()
    const leaf = { type: 'combat', profiles: [{ character_id, profile: boosting }] }
    await put(f.store, 'behavior:fixture-run', {
      ...stored,
      script: { ...stored.script, tree: { type: 'action', action: leaf } },
    })
    await f.tick()
    expect(await f.get_run()).toMatchObject({
      status: 'awaiting_ai',
      issue: 'combat_boost_removed',
      actions_started: 0,
    })
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
})
