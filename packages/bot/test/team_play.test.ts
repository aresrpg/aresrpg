// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { CONTRACT_CONSTANTS, create_character_source, create_fight, player_max_hp } from '@aresrpg/fight'
import type { CharacterRow } from '@aresrpg/protocol'
import { bind_strategy } from '@aresrpg/protocol/strategies'

import spells from '../../../seed/content/spells.json'
import dungeons from '../../../seed/content/dungeons.json'
import mobs from '../../../seed/content/mobs.json'
import { encode_cell, mask_from_cells } from '../../fight/src/combat_grid.ts'
import { id } from '../../sdk/test/helpers/transport.ts'
import { empty_snapshot } from '../src/actor_snapshot.ts'
import { empty_inventory } from '../src/actor_inventory.ts'
import { select_dungeon_step, select_join } from '../src/behavior_team.ts'
import { select_spending } from '../src/behavior_growth.ts'
import { select_owned_item } from '../src/behavior_items.ts'
import { select_group } from '../src/behavior_targets.ts'
import { next_combat_action } from '../src/combat_plan.ts'
import { parse_combat_profile } from '../src/combat_profile.ts'
import { plan_combat_turn } from '../src/combat_tactics.ts'
import { fight_checkpoint_id, validate_gameplay, type GameplayContext } from '../src/gameplay.ts'
import { parse_behavior_script, type BehaviorRun } from '../src/behavior_script.ts'
import { next_behavior_action } from '../src/behavior_plan.ts'
import { empty_behavior_memory } from '../src/behavior_tree.ts'

import { fixture_bot } from './helpers/control_fixture.ts'
import { character as trainee, item, profession_context } from './helpers/profession_fixture.ts'
import {
  character,
  character_id,
  fight_id,
  placement,
  profile,
  row_of,
  started,
} from './helpers/combat_runtime_fixture.ts'

const ally_id = id(77)
const now = 63_000
const [dungeon] = dungeons
const portal = { world: 'nauvis', x: 50512, z: 50000 }
const free = (patch: Partial<CharacterRow> = {}): CharacterRow => ({
  ...character(),
  id: ally_id,
  custody: 'kiosk',
  active_fight: undefined,
  x: 250_000,
  z: 250_000,
  ...patch,
})
const context_of = (
  checkpoint: ReturnType<typeof placement>,
  characters: readonly CharacterRow[],
  chain_ms = now
): GameplayContext => ({
  address: fixture_bot.address,
  now,
  freshness_ms: 60_000,
  command: {
    id: 'fixture',
    grant_id: 'grant',
    bot_id: fixture_bot.id,
    lane_key: 'lane',
    fingerprint: 'fixture',
    kind: 'observe',
    payload: {},
    decision_revision: 0,
    observation_revision: 1,
    status: 'accepted',
  },
  snapshot: {
    ...empty_snapshot(),
    characters,
    fights: { [fight_id]: row_of(checkpoint) },
    clock: { chain_ms, observed_at: now },
    observed_at: now,
    observation_revision: 1,
    ready: true,
    frozen: false,
    indexing_lag: 0,
  },
})
const plan = (context: GameplayContext, action: Readonly<{ kind: string; payload: object }>) =>
  validate_gameplay({ ...context, command: { ...context.command, ...action } as GameplayContext['command'] })
const selected = (selection: ReturnType<typeof select_join>) => {
  if (selection.status !== 'action') throw new Error(`expected an action, got ${JSON.stringify(selection)}`)
  return selection.action
}
/** A second hero of the same wallet seated beside the first, each with its own seat and source. */
const with_ally = (checkpoint: ReturnType<typeof placement>, patch: object = {}) => {
  const seat = structuredClone(checkpoint.contract.fighters[0]!)
  if (seat.kind.type !== 'player') throw new Error('invalid fixture')
  seat.kind.character = ally_id
  checkpoint.contract.fighters.push(Object.assign(seat, patch))
  checkpoint.sources.players[ally_id] = structuredClone(checkpoint.sources.players[character_id]!)
  return checkpoint
}

test('a healer heals its most wounded ally and fights alone otherwise', () => {
  const cell = (x: number) => encode_cell(BigInt(x), 5n)
  const state = with_ally(placement(), { cell: cell(7) })
  state.sources.players[character_id] = create_character_source({ classe: 'iyashi', level: 30n })
  state.sources.spells = Object.fromEntries(spells.map(({ name, ...spell }) => [name, spell])) as never
  state.contract.closed = mask_from_cells([])
  state.contract.board.shape_mask = mask_from_cells(
    Array.from({ length: Number(CONTRACT_CONSTANTS.grid_cells) }, (_, index) => BigInt(index))
  )
  Object.assign(state.contract.board, { obstacles: [], holes: [] })
  Object.assign(state.contract, { round: 1n, queue: [0n, 1n, 2n], turn_ptr: 0n, turn_started_ms: 60_000n })
  Object.assign(state.contract.fighters[0]!, { cell: cell(5), ap: 8n, mp: 3n })
  Object.assign(state.contract.fighters[1]!, { cell: cell(3), hp: 1_000n })
  const healer = parse_combat_profile({
    version: '1',
    intent: 'Heal a wounded ally first; otherwise attack.',
    combos: [
      { name: 'heal', steps: [{ type: 'cast', spell: 'Healing Word', target: 'lowest_hp_ally' }] },
      { name: 'attack', steps: [{ type: 'cast', spell: 'Wounding Word', target: 'nearest_enemy' }] },
    ],
    rules: [
      { when: { type: 'ally_hp_below', percent: 60 }, combo: 'heal' },
      { when: { type: 'always' }, combo: 'attack' },
    ],
    fallback: 'end_turn',
  })
  const max = player_max_hp(state.sources.players[ally_id]!)
  const turn = (ally_hp: bigint) => {
    const wounded = structuredClone(state)
    wounded.contract.fighters[2]!.hp = ally_hp
    return plan_combat_turn(healer, create_fight({ state: wounded, mode: 'remote' }).state(), 0n, 63_000n).actions
  }
  expect(turn(max / 2n)[0]).toEqual({ type: 'cast', spell: 'Healing Word', target_cell: String(cell(7)) })
  expect(turn(max)[0]).toEqual({ type: 'cast', spell: 'Wounding Word', target_cell: String(cell(3)) })
  const solo = structuredClone(state)
  solo.contract.fighters[2]!.dead = true
  const alone = parse_combat_profile({ ...healer, rules: [{ when: { type: 'ally_present' }, combo: 'heal' }] })
  expect(plan_combat_turn(alone, create_fight({ state: solo, mode: 'remote' }).state(), 0n, 63_000n).actions).toEqual(
    []
  )
})

test('a hero joins the placement a teammate opened and refuses every fight it cannot join', () => {
  const join = { type: 'join', character_id: ally_id, allies: [character_id] } as const
  const open = context_of(placement(), [character(), free()])
  const action = selected(select_join(join, open))
  expect(action).toEqual({
    kind: 'fight_join',
    payload: {
      character_id: ally_id,
      fight: fight_id,
      checkpoint_id: fight_checkpoint_id(open.snapshot.fights[fight_id]!),
    },
  })
  expect(plan(open, action)).toMatchObject({
    kind: 'fight_join',
    travel: { character_id: ally_id, target_x: 250_000, target_z: 250_000 },
    input: { fight: fight_id, character_id: ally_id, team: 0 },
  })
  const locked = placement()
  locked.contract.access_a = 1n
  const room = placement()
  room.contract.dungeon = dungeon!.dungeon
  for (const closed of [
    context_of(started(), [character(), free()]),
    context_of(locked, [character(), free()]),
    context_of(room, [character(), free()]),
    context_of(placement(), [
      character(),
      free({ ambush: { protector: 'p', x: 0, z: 0, scalar: 0, board_seed: '1', hp: '1' } }),
    ]),
    context_of(with_ally(placement()), [character(), free()]),
  ])
    expect(select_join(join, closed)).toEqual({ status: 'failure', code: 'fight_not_joinable' })
  expect(() => plan(context_of(started(), [character(), free()]), action)).toThrow('needs_resync')
  const far = context_of(placement(), [character(), free({ x: 50_000, z: 50_000 })])
  expect(() => plan(far, selected(select_join(join, far)))).toThrow('travel_not_ready')
})

test('nobody leads: a hero waits the placement window for free teammates and plays only its own turn', () => {
  const intent = { fight: fight_id, profiles: [{ character_id, revision: 1, profile }] }
  const team = { ...intent, allies: [ally_id] }
  const gathering = context_of(placement(), [character(), free()], 30_000)
  expect(next_combat_action(team, gathering).state).toBe('waiting')
  expect(next_combat_action(intent, gathering).action?.kind).toBe('fight_ready')
  const expired = context_of(placement(), [character(), free()], 1000 + Number(CONTRACT_CONSTANTS.placement_force_ms))
  expect(next_combat_action(team, expired).action?.kind).toBe('fight_ready')
  const busy = context_of(placement(), [character(), free({ world: 'elsewhere' })], 30_000)
  expect(next_combat_action(team, busy).action?.kind).toBe('fight_ready')
  // The teammate's turn belongs to the teammate's own tree.
  const shared = with_ally(started())
  shared.contract.queue = [2n, 0n, 1n]
  shared.contract.turn_ptr = 0n
  const seated = [character(), free({ custody: 'fight', active_fight: { id: fight_id, seat: 2 } })]
  const turn_ms = Number(shared.contract.turn_started_ms)
  const during = (chain_ms: number) => ({ ...context_of(shared, seated, chain_ms), now: chain_ms })
  const late = turn_ms + Number(CONTRACT_CONSTANTS.turn_max_ms)
  expect(next_combat_action(intent, during(turn_ms + 5000))).toEqual({ state: 'waiting' })
  expect(next_combat_action(intent, { ...during(late), now }).action?.kind).toBe('fight_crank')
  const own = { fight: fight_id, profiles: [{ character_id: ally_id, revision: 1, profile }] }
  expect(next_combat_action(own, { ...during(late), now }).action).toMatchObject({
    kind: 'fight_turn',
    payload: { character_id: ally_id, fighter_idx: '2' },
  })
})

test('a dungeon run advances from observed state: enter with a key, join an open room or open it', () => {
  const leaf = {
    type: 'dungeon',
    character_id: ally_id,
    world: portal.world,
    dungeon: dungeon!.dungeon,
    profile,
  } as const
  const hero = free({ ...portal, checkpoint_world: portal.world })
  const key = { id: id(40), item_type: dungeon!.key, name: 'Key', category: 'key', level: 1, amount: 1 }
  const stocked = (items: readonly object[], characters: readonly CharacterRow[], checkpoint = placement()) => {
    const context = context_of(checkpoint, characters)
    const inventory = { ...empty_inventory(), loaded: true, listings: [], trades: [], items }
    return { ...context, snapshot: { ...context.snapshot, inventory } } as GameplayContext
  }
  const owned = { ...key, kiosk: hero.kiosk, version: '1' }
  expect(select_dungeon_step(leaf, context_of(placement(), [hero]))).toMatchObject({ status: 'waiting' })
  expect(select_dungeon_step(leaf, stocked([], [hero]))).toEqual({ status: 'failure', code: 'item_unavailable' })
  const enter = selected(select_dungeon_step(leaf, stocked([owned], [hero])))
  expect(enter).toEqual({
    kind: 'dungeon_enter',
    payload: { character_id: ally_id, world: portal.world, dungeon: dungeon!.dungeon, key_id: key.id },
  })
  expect(plan(stocked([owned], [hero]), enter)).toMatchObject({
    kind: 'dungeon_enter',
    travel: { target_x: portal.x, target_z: portal.z },
    input: { key_id: key.id, dungeon: dungeon!.dungeon },
  })
  expect(() => plan(stocked([{ ...owned, item_type: 'other' }], [hero]), enter)).toThrow('item_unavailable')
  const staged = { ...hero, dungeon_run: { dungeon: dungeon!.dungeon, room: 1 } }
  const opened = selected(select_dungeon_step(leaf, stocked([], [staged])))
  expect(opened).toEqual({
    kind: 'dungeon_fight',
    payload: { character_id: ally_id, world: portal.world, dungeon: dungeon!.dungeon },
  })
  expect(plan(stocked([], [staged]), opened)).toMatchObject({
    kind: 'dungeon_fight',
    input: { access: 0, mob_types: dungeon!.rooms[0]!.map(({ mob_type }) => mob_type) },
  })
  expect(() => plan(stocked([], [hero]), opened)).toThrow('character_not_available')
  const elsewhere = { ...staged, dungeon_run: { dungeon: 'another', room: 1 } }
  expect(select_dungeon_step(leaf, stocked([], [elsewhere]))).toEqual({
    status: 'failure',
    code: 'dungeon_unavailable',
  })
  // A teammate already opened this room: join it, with no leader and no second fight.
  const room = placement()
  Object.assign(room.contract, { dungeon: dungeon!.dungeon, dungeon_room: 1n })
  const opener = { ...character(), dungeon_run: staged.dungeon_run }
  const raid = { ...leaf, allies: [character_id] }
  const together = stocked([], [opener, staged], room)
  const joined = selected(select_dungeon_step(raid, together))
  expect(joined).toMatchObject({ kind: 'fight_join', payload: { fight: fight_id, dungeon: dungeon!.dungeon } })
  expect(plan(together, joined)).toMatchObject({ kind: 'fight_join', input: { team: null, character_id: ally_id } })
  const later = stocked([], [opener, { ...staged, dungeon_run: { dungeon: dungeon!.dungeon, room: 2 } }], room)
  expect(selected(select_dungeon_step(raid, later)).kind).toBe('dungeon_fight')
  expect(() => plan(later, joined)).toThrow('fight_not_joinable')
})

test('a room is playable only by a command that names its dungeon, and settles through the dungeon door', () => {
  const room = started()
  Object.assign(room.contract, { dungeon: dungeon!.dungeon, dungeon_room: 1n })
  const hero = { ...character(), dungeon_run: { dungeon: dungeon!.dungeon, room: 1 } }
  const context = context_of(room, [hero])
  const payload = {
    character_id,
    fight: fight_id,
    fighter_idx: '0',
    checkpoint_id: fight_checkpoint_id(context.snapshot.fights[fight_id]!),
  }
  expect(() => plan(context, { kind: 'fight_crank', payload })).toThrow('unsupported_fight_mode')
  const scoped = { ...payload, dungeon: dungeon!.dungeon }
  expect(() => plan(context, { kind: 'fight_crank', payload: scoped })).toThrow('illegal_fight_action')
  const ordinary = context_of(started(), [character()])
  const stray = { ...scoped, checkpoint_id: fight_checkpoint_id(ordinary.snapshot.fights[fight_id]!) }
  expect(() => plan(ordinary, { kind: 'fight_crank', payload: stray })).toThrow('unsupported_fight_mode')
  const intent = { fight: fight_id, profiles: [{ character_id, revision: 1, profile }] }
  expect(() => next_combat_action(intent, context)).toThrow('unsupported_fight_mode')
  expect(next_combat_action({ ...intent, dungeon: dungeon!.dungeon }, context).action).toMatchObject({
    kind: 'fight_turn',
    payload: { dungeon: dungeon!.dungeon },
  })
  room.contract.ended = true
  const ended = context_of(room, [hero])
  const settle = { ...scoped, checkpoint_id: fight_checkpoint_id(ended.snapshot.fights[fight_id]!) }
  expect(plan(ended, { kind: 'fight_settle', payload: settle })).toMatchObject({
    kind: 'fight_settle',
    input: { dungeon: dungeon!.dungeon },
  })
  const leave = { kind: 'dungeon_leave', payload: { character_id, dungeon: dungeon!.dungeon } }
  expect(plan(context, leave)).toMatchObject({ input: { room: { fight: fight_id, fighter_idx: 0n } } })
  const between = { ...hero, custody: 'kiosk' as const, active_fight: undefined }
  expect(plan(context_of(room, [between]), leave)).toMatchObject({ input: { room: null } })
  expect(() => plan(context_of(room, [character()]), leave)).toThrow('character_not_available')
})

test('a tree accepts the team, dungeon and growth leaves and still acts for one hero', () => {
  const tree = (children: readonly object[]) => ({
    version: '1',
    objective: { title: 'Raid' },
    tree: { type: 'selector', children: children.map((action) => ({ type: 'action', action })) },
  })
  const leaves = [
    { type: 'dungeon', character_id, world: portal.world, dungeon: dungeon!.dungeon, profile, allies: [ally_id] },
    { type: 'combat', profiles: [{ character_id, profile }], allies: [ally_id] },
    { type: 'join', character_id, allies: [ally_id] },
    { type: 'spend_points', character_id, stats: ['strength', 'vitality'], spells: [] },
    { type: 'equip_owned', character_id, slot: 'hat', order: 'highest_level' },
    { type: 'engage', character_id, mob_types: [mobs[0]!.mob_type], order: 'best_xp', level_margin: 5 },
  ]
  expect(parse_behavior_script(tree(leaves)).tree).toMatchObject({ type: 'selector' })
  for (const invalid of [
    { type: 'join', character_id },
    { type: 'engage', character_id, mob_types: [mobs[0]!.mob_type], order: 'best_xp' },
    { type: 'equip_owned', character_id, slot: 'hat', item_type: 'any', order: 'highest_level' },
    { type: 'spend_points', character_id, stats: ['luck'], spells: [] },
  ])
    expect(() => parse_behavior_script(tree([invalid]))).toThrow('invalid_behavior_action')
})

/** Two observed groups derived from seed: a weak one beside the hero and a richer, stronger one further. */
const select_growth_fixture = () => {
  const weak = mobs.toSorted((a, b) => a.level_min - b.level_min)[0]!
  const level = weak.level_min + 4
  const strong = mobs.filter((mob) => mob.level_min > level).toSorted((a, b) => b.xp - a.xp)[0]!
  const spell = spells.find(({ classe, unlock_level }) => classe === trainee.classe && unlock_level <= 1)!.name
  const hero = { ...trainee, level, available_points: 7, available_spell_points: 1 }
  const base = profession_context()
  const zone = base.snapshot.zones['fixture:97:97']!
  const group = (index: number, x: number, mob_type: string) => ({
    index,
    x,
    z: 50_000,
    members: [{ mob_type, level_scalar: 0 }],
  })
  const hat = (number: number, level: number) => ({ ...item(`hat_${level}`, 1, number), category: 'hat', level })
  const with_snapshot = (patch: object): GameplayContext => ({ ...base, snapshot: { ...base.snapshot, ...patch } })
  const inventory = { ...base.snapshot.inventory!, items: [hat(41, 1), hat(42, hero.level), hat(43, hero.level + 1)] }
  const zones = {
    'fixture:97:97': {
      ...zone,
      spawns: { ...zone.spawns!, mobs: [group(0, 50_010, weak.mob_type), group(1, 50_100, strong.mob_type)] },
    },
  }
  const worn = { ...hat(42, hero.level), slot: 'hat' }
  return {
    hero,
    spell,
    mob_types: [weak.mob_type, strong.mob_type],
    weak_index: 0,
    strong_index: 1,
    strong_margin: strong.level_min - hero.level,
    best_hat: id(42),
    context: with_snapshot({ characters: [hero], zones, inventory }),
    wearing_best: with_snapshot({ characters: [{ ...hero, equipment: [worn] }], zones, inventory }),
  }
}

test('smart choices come from seed and observed state: richest group in the margin, best item, priority points', () => {
  const f = select_growth_fixture()
  const pick = (level_margin: number) =>
    select_group(f.hero.id, f.mob_types, f.context, undefined, { order: 'best_xp', level_margin })?.payload.group_index
  expect(pick(f.strong_margin)).toBe(String(f.strong_index))
  expect(pick(0)).toBe(String(f.weak_index))
  const nearest = select_group(f.hero.id, f.mob_types, f.context, undefined, { order: 'nearest' })
  expect(nearest?.payload.group_index).toBe(String(f.weak_index))
  const best = { type: 'equip_owned', character_id: f.hero.id, slot: 'hat', order: 'highest_level' } as const
  expect(select_owned_item(best, f.context)).toMatchObject({ action: { payload: { item_id: f.best_hat } } })
  expect(select_owned_item(best, f.wearing_best)).toEqual({ status: 'failure', code: 'item_unavailable' })
  const spend = { type: 'spend_points', character_id: f.hero.id, stats: ['strength', 'vitality'], spells: [] } as const
  expect(select_spending(spend, f.context)).toMatchObject({
    action: { kind: 'raise_stats', payload: { spending: { strength: f.hero.available_points } } },
  })
  expect(plan(f.context, selected(select_spending(spend, f.context))).kind).toBe('raise_stats')
  const spent = { ...f.context, snapshot: { ...f.context.snapshot, characters: [{ ...f.hero, available_points: 0 }] } }
  expect(select_spending(spend, spent)).toEqual({ status: 'failure', code: 'nothing_to_spend' })
  expect(select_spending({ ...spend, spells: [f.spell] }, spent)).toMatchObject({
    action: { kind: 'raise_spell', payload: { spell: f.spell } },
  })
})

test('the raid strategy drives one hero through a dungeon and an ordinary combat leaf leaves rooms alone', () => {
  const scope = { character: character_id, title: 'Raid', area: { world: portal.world }, dungeon: dungeon!.dungeon }
  const run_of = (strategy: string): BehaviorRun => ({
    id: 'run',
    bot_id: fixture_bot.id,
    grant_id: 'grant',
    lane_key: 'lane',
    character_id,
    fingerprint: 'fixture',
    script: parse_behavior_script(bind_strategy(strategy, scope)),
    revision: 1,
    memory: empty_behavior_memory(),
    pending_node: null,
    activation: null,
    consumed_command_id: null,
    status: 'active',
    actions_started: 0,
    last_command_id: null,
    created_at: 0,
  })
  const at_portal = { ...portal, checkpoint_world: portal.world, custody: 'kiosk' as const, active_fight: undefined }
  const staged = { ...character(), ...at_portal, dungeon_run: { dungeon: dungeon!.dungeon, room: 1 } }
  const stock = (context: GameplayContext, items: readonly object[]) =>
    ({
      ...context,
      snapshot: {
        ...context.snapshot,
        inventory: { ...empty_inventory(), loaded: true, listings: [], trades: [], items },
      },
    }) as GameplayContext
  const key = { id: id(40), item_type: dungeon!.key, name: 'Key', category: 'key', level: 1, amount: 1 }
  const outside = { ...character(), ...at_portal }
  const owned_key = { ...key, kiosk: outside.kiosk, version: '1' }
  const raid = run_of('dungeon_raid')
  const next = (context: GameplayContext, run = raid) => next_behavior_action(run, null, context)
  expect(next(stock(context_of(placement(), [outside]), [owned_key])).action?.kind).toBe('dungeon_enter')
  expect(next(stock(context_of(placement(), [outside]), []))).toMatchObject({ state: 'completed' })
  expect(next(stock(context_of(placement(), [staged]), [])).action?.kind).toBe('dungeon_fight')
  const room = started()
  Object.assign(room.contract, { dungeon: dungeon!.dungeon, dungeon_room: 1n })
  const fighting = context_of(room, [{ ...character(), dungeon_run: staged.dungeon_run }])
  const turn = next(fighting)
  expect(turn).toMatchObject({
    state: 'action',
    action: { kind: 'fight_turn', payload: { dungeon: dungeon!.dungeon } },
    record: { activation: { fight: fight_id } },
  })
  // An ordinary combat leaf never plays a room: it falls through instead of blocking the tree.
  const hunt = next(fighting, run_of('team_hunt'))
  expect(hunt.action?.kind).not.toBe('fight_turn')
  expect(hunt.issue).not.toBe('unsupported_fight_mode')
  // And the dungeon leaf leaves an ordinary fight to the tree's combat leaf.
  const ordinary = next(context_of(started(), [character()]))
  expect(ordinary.action).toMatchObject({ kind: 'fight_turn' })
  expect(ordinary.action?.payload).not.toHaveProperty('dungeon')
})

test('a raid bound with a run cap ends after that many dungeon runs ended, and not before', () => {
  const scope = { character: character_id, title: 'Raid', area: { world: portal.world }, dungeon: dungeon!.dungeon }
  const script = (runs?: number) => parse_behavior_script(bind_strategy('dungeon_raid', { ...scope, runs }))
  const raid = (runs?: number): BehaviorRun => ({
    id: 'run',
    bot_id: fixture_bot.id,
    grant_id: 'grant',
    lane_key: 'lane',
    character_id,
    fingerprint: 'fixture',
    script: script(runs),
    revision: 1,
    memory: empty_behavior_memory(),
    pending_node: null,
    activation: null,
    consumed_command_id: null,
    status: 'active',
    actions_started: 0,
    last_command_id: null,
    created_at: 0,
  })
  const at_portal = { ...portal, checkpoint_world: portal.world, custody: 'kiosk' as const, active_fight: undefined }
  const outside = { ...character(), ...at_portal }
  const inside = { ...outside, dungeon_run: { dungeon: dungeon!.dungeon, room: 1 } }
  const keys = { id: id(40), item_type: dungeon!.key, name: 'Key', category: 'key', level: 1, amount: 9 }
  const seen = (hero: CharacterRow, checkpoint = placement()): GameplayContext => {
    const context = context_of(checkpoint, [hero])
    const items = [{ ...keys, kiosk: outside.kiosk, version: '1' }]
    const inventory = { ...empty_inventory(), loaded: true, listings: [], trades: [], items }
    return { ...context, snapshot: { ...context.snapshot, inventory } } as GameplayContext
  }
  /** Each look carries the tally the run stored at the look before it. */
  const played = (run: BehaviorRun, looks: readonly GameplayContext[]) =>
    looks.reduce<readonly ReturnType<typeof next_behavior_action>[]>((results, context) => {
      const tally = results.at(-1)?.record.tally
      return [...results, next_behavior_action({ ...run, tally }, null, context)]
    }, [])
  // The last room is won while the hero still sits in its fight: the run has ended, the fight has not.
  const settling = seen(character())
  const looks = [seen(outside), seen(inside), seen(outside), seen(inside), settling, seen(outside)]
  const capped = played(raid(2), looks)
  expect(capped.map(({ state, action }) => action?.kind ?? state)).toEqual([
    'dungeon_enter',
    'dungeon_fight',
    'dungeon_enter',
    'dungeon_fight',
    capped[4]!.action!.kind,
    'completed',
  ])
  expect(capped.map(({ record }) => record.tally?.dungeon_runs ?? 0)).toEqual([0, 0, 1, 1, 2, 2])
  // Two runs ended, but the hero is still in a fight: the tree plays it out before it ends.
  expect(capped[4]).toMatchObject({ state: 'action' })
  expect(capped[5]).toMatchObject({ state: 'completed', issue: 'run_cap_reached' })
  expect(capped[5]!.action).toBeUndefined()
  // With no cap bound the hero raids while keys last, as before.
  const open = played(raid(), looks)
  expect(open.at(-1)!.action?.kind).toBe('dungeon_enter')
  expect(open.at(-1)!.record.tally?.dungeon_runs).toBe(2)
  // One run is not two.
  expect(played(raid(2), looks.slice(0, 3)).at(-1)!.action?.kind).toBe('dungeon_enter')
})

test('a run whose fees reached its cap plays out the fight its hero is in, then ends before anything new', () => {
  const scope = { character: character_id, title: 'Raid', area: { world: portal.world }, dungeon: dungeon!.dungeon }
  const capped = (strategy: string): BehaviorRun => ({
    id: 'run',
    bot_id: fixture_bot.id,
    grant_id: 'grant',
    lane_key: 'lane',
    character_id,
    fingerprint: 'fixture',
    script: parse_behavior_script(bind_strategy(strategy, { ...scope, fee_cap_mist: '100' })),
    revision: 1,
    memory: empty_behavior_memory(),
    pending_node: null,
    activation: null,
    consumed_command_id: null,
    status: 'active',
    actions_started: 0,
    last_command_id: null,
    created_at: 0,
    tally: { fees_mist: '100', dungeon_runs: 0, in_dungeon: false },
  })
  const fighting = context_of(started(), [character()])
  const free = context_of(placement(), [{ ...character(), custody: 'kiosk', active_fight: undefined }])
  // Leaving a fight would forfeit it: its turns are still signed.
  expect(next_behavior_action(capped('dungeon_raid'), null, fighting).action).toMatchObject({ kind: 'fight_turn' })
  for (const strategy of ['dungeon_raid', 'team_hunt']) {
    // A run never ends while its hero sits in a fight, even one its tree cannot play.
    expect(next_behavior_action(capped(strategy), null, fighting).state).not.toBe('completed')
    const ended = next_behavior_action(capped(strategy), null, free)
    expect(ended).toMatchObject({ state: 'completed', issue: 'fee_cap_reached' })
    expect(ended.action).toBeUndefined()
  }
})

test('a raid hero keeps its key until every listed teammate can follow it into the dungeon', () => {
  const { world } = portal
  const raid = { type: 'dungeon', character_id, world, dungeon: dungeon!.dungeon, profile, allies: [ally_id] } as const
  const place = { ...portal, checkpoint_world: world, custody: 'kiosk' as const, active_fight: undefined }
  const hero = { ...character(), ...place }
  const mate = free({ ...place })
  const keys = (amount: number, kiosk = hero.kiosk) => ({
    id: id(40),
    item_type: dungeon!.key,
    name: 'Key',
    category: 'key',
    level: 1,
    amount,
    kiosk,
    version: '1',
  })
  const step = (items: readonly object[], characters: readonly CharacterRow[]) => {
    const context = context_of(placement(), characters)
    const inventory = { ...empty_inventory(), loaded: true, listings: [], trades: [], items }
    return select_dungeon_step(raid, { ...context, snapshot: { ...context.snapshot, inventory } } as GameplayContext)
  }
  const refused = { status: 'failure', code: 'item_unavailable' } as const
  // One key for two heroes: nobody burns it to fight alone.
  expect(step([keys(1)], [hero, mate])).toEqual(refused)
  // A listed teammate this wallet does not hold cannot follow either.
  expect(step([keys(2)], [hero])).toEqual(refused)
  // A teammate in another kiosk needs its own key there.
  expect(step([keys(2)], [hero, { ...mate, kiosk: id(90) }])).toEqual(refused)
  expect(step([keys(2)], [hero, mate])).toMatchObject({ status: 'action', action: { kind: 'dungeon_enter' } })
  // A teammate already inside this dungeon run needs no further key.
  const inside = { ...mate, dungeon_run: { dungeon: dungeon!.dungeon, room: 1 } }
  expect(step([keys(1)], [hero, inside])).toMatchObject({ status: 'action', action: { kind: 'dungeon_enter' } })
  expect(step([keys(1)], [hero, { ...mate, dungeon_run: { dungeon: 'another', room: 1 } }])).toEqual(refused)
})
