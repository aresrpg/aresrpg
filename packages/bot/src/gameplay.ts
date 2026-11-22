// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  create_fight,
  encode_fight_action,
  fight_loot_types,
  hydrate_fight_checkpoint,
  type HydratedFightCheckpoint,
  type FightCommandInput,
} from '@aresrpg/fight'
import { live_mob_groups, zone_of, type ClientPacket, type FightStateRow } from '@aresrpg/protocol'
import type { Sdk } from '@aresrpg/sdk'
import { create_agent_actions } from '@aresrpg/sdk/agent-actions'

import spells from '../../../seed/content/spells.json'

import {
  assert_target_context,
  assert_area_position,
  parse_world_area,
  WORLD_AREA_SCHEMA,
  type WorldArea,
  parse_target_options,
  target_schema,
  type TargetOptions,
} from './target_constraints.ts'
import {
  EQUIPMENT_ACTIONS,
  validate_equip_item,
  validate_consumable,
  equipment_executors,
  type EquipmentActionPlan,
} from './equipment_actions.ts'
import {
  TEAM_ACTIONS,
  assert_supported_fight,
  team_executors,
  settle_executor,
  validate_dungeon_enter,
  validate_dungeon_fight,
  validate_dungeon_leave,
  validate_fight_forfeit,
  validate_fight_join,
  type SettlePlan,
  type TeamActionPlan,
  type TeamExecutor,
} from './team_actions.ts'
import { LOOT_BOX_ACTIONS, validate_open_boxes, validate_claim_loot, type LootBoxPlan } from './loot_boxes.ts'
import { RAISE_SPELL_ACTION, validate_spell_allocation, type SpellAllocationPlan } from './spell_allocation.ts'
import { RAISE_STATS_ACTION, validate_stat_allocation, type StatAllocationPlan } from './stat_allocation.ts'
import { zone_key, type ActorWorld } from './actor_world.ts'
import { hash_secret } from './security.ts'
import {
  object_schema,
  identifier,
  nonempty,
  decimal,
  coordinate,
  world_coordinate,
  decode,
  u64,
} from './gameplay_schema.ts'
import {
  assert_fresh,
  owned_character,
  custody_of,
  assert_travel,
  travel_destination,
  assert_tracked_zone,
  type GameplayContext,
} from './gameplay_context.ts'
export { gameplay_observed_ms, type GameplayContext } from './gameplay_context.ts'
import {
  PROFESSION_ACTIONS,
  validate_profession_action,
  profession_action_executors,
  type ProfessionActionPlan,
} from './profession_actions.ts'
import {
  MARKET_ACTIONS,
  market_validators,
  market_executors,
  type MarketExecutor,
  type MarketPlan,
} from './market_actions.ts'
import { CHARACTER_ACTIONS, character_validators, character_executors } from './character_actions.ts'
import type { CreateCharacterPlan } from './character_actions.ts'

type AgentActions = ReturnType<typeof create_agent_actions>
type Actions = AgentActions['fight'] &
  Pick<
    AgentActions['character'],
    | 'search_zone'
    | 'equip'
    | 'gather'
    | 'craft'
    | 'resolve_ambush'
    | 'raise_stats'
    | 'raise_spell'
    | 'open_loot_boxes'
    | 'claim_loot_batch'
    | 'use_consumable'
  >
type TurnInput = Parameters<Actions['commit_turn']>[0]
type FightPayload = Readonly<{
  character_id: string
  fight: string
  fighter_idx: string
  checkpoint_id: string
  /** Names the dungeon whose room this command may act in; absent for an ordinary fight. */
  dungeon?: string
  target_options?: TargetOptions
}>
export type FightTurnPayload = FightPayload &
  Readonly<{
    actions: readonly (
      | Readonly<{ type: 'move'; path: readonly string[] }>
      | Readonly<{ type: 'cast'; spell: string; target_cell: string }>
      | Readonly<{ type: 'strike'; target_cell: string }>
    )[]
  }>
type PlacePayload = FightPayload & Readonly<{ cell: string }>
type SearchPayload = Readonly<{ character_id: string; world: string; x: number; z: number; area?: WorldArea }>
type EngagePayload = Readonly<{
  target_options?: TargetOptions
  character_id: string
  world: string
  zone_x: number
  zone_z: number
  group_index: string
  zone_checkpoint_id: string
}>
const search_schema = {
  ...object_schema({
    character_id: identifier,
    world: nonempty,
    x: world_coordinate,
    z: world_coordinate,
    area: WORLD_AREA_SCHEMA,
  }),
  required: ['character_id', 'world', 'x', 'z'],
}
const fight_properties = { character_id: identifier, fight: identifier, fighter_idx: decimal, checkpoint_id: nonempty }
const fight_schema_of = (properties: Parameters<typeof target_schema>[0]) => ({
  ...target_schema({ ...properties, dungeon: nonempty }),
  required: Object.keys(properties),
})
const fight_schema = fight_schema_of(fight_properties)
const place_schema = fight_schema_of({ ...fight_properties, cell: decimal })
const engage_schema = target_schema({
  character_id: identifier,
  world: nonempty,
  zone_x: coordinate,
  zone_z: coordinate,
  group_index: decimal,
  zone_checkpoint_id: nonempty,
})
export const FIGHT_TURN_SCHEMA = fight_schema_of({
  ...fight_properties,
  actions: {
    type: 'array',
    items: {
      oneOf: [
        object_schema({ type: { const: 'move' }, path: { type: 'array', items: decimal } }),
        object_schema({ type: { const: 'cast' }, spell: nonempty, target_cell: decimal }),
        object_schema({ type: { const: 'strike' }, target_cell: decimal }),
      ],
    },
  },
})
const parse_fight = (value: unknown): FightPayload => {
  const payload = decode<FightPayload>(fight_schema, value)
  u64(payload.fighter_idx)
  return payload
}
const parse_place = (value: unknown): PlacePayload => {
  const payload = decode<PlacePayload>(place_schema, value)
  u64(payload.fighter_idx)
  u64(payload.cell)
  return payload
}
const parse_engage = (value: unknown): EngagePayload => {
  const payload = decode<EngagePayload>(engage_schema, value)
  u64(payload.group_index)
  return payload
}
const turn_input = (payload: FightTurnPayload): TurnInput => {
  const fighter_idx = u64(payload.fighter_idx)
  return {
    fight: payload.fight,
    actions: payload.actions.map((action) => {
      switch (action.type) {
        case 'move':
          return { type: 'move', path: action.path.map(u64) }
        case 'cast':
          return { type: 'cast', fighter_idx, spell: action.spell, target_cell: u64(action.target_cell) }
        case 'strike':
          return { type: 'strike', fighter_idx, target_cell: u64(action.target_cell) }
      }
    }),
  }
}
export const parse_fight_turn = (value: unknown): FightTurnPayload => {
  const payload = decode<FightTurnPayload>(FIGHT_TURN_SCHEMA, value)
  turn_input(payload)
  return payload
}
/** One catalog supplies both MCP descriptions/schemas and admission parsing. */
export const GAMEPLAY_ACTIONS = Object.freeze({
  ...PROFESSION_ACTIONS,
  ...LOOT_BOX_ACTIONS,
  raise_stats: RAISE_STATS_ACTION,
  raise_spell: RAISE_SPELL_ACTION,
  ...EQUIPMENT_ACTIONS,
  ...TEAM_ACTIONS,
  ...MARKET_ACTIONS,
  ...CHARACTER_ACTIONS,
  world_search: Object.freeze({
    description:
      "Discover or refresh a zone in an owned character's observed world window, using canonical chain travel and exact kiosk custody.",
    input_schema: search_schema,
    parse: (value: unknown) => decode<SearchPayload>(search_schema, value),
  }),
  fight_engage: Object.freeze({
    description:
      'Engage an available observed roaming PvE mob group with an owned kiosk-held character. Uses the SDK default open access.',
    input_schema: engage_schema,
    parse: parse_engage,
  }),
  fight_place: Object.freeze({
    description: 'Place an owned fighter in its ordinary PvE placement phase.',
    input_schema: place_schema,
    parse: parse_place,
  }),
  fight_ready: Object.freeze({
    description: 'Ready an owned PvE fighter. The final ready may start combat atomically.',
    input_schema: fight_schema,
    parse: parse_fight,
  }),
  fight_start: Object.freeze({
    description: 'Start an owned PvE fight when all players are ready or observed chain time permits force start.',
    input_schema: fight_schema,
    parse: parse_fight,
  }),
  fight_crank: Object.freeze({
    description: 'Advance an owned active PvE fight when the canonical dead-seat or turn-timeout rule permits.',
    input_schema: fight_schema,
    parse: parse_fight,
  }),
  fight_turn: Object.freeze({
    description: 'Validate and commit one complete owned PvE turn through the shared fight twin and SDK.',
    input_schema: FIGHT_TURN_SCHEMA,
    parse: parse_fight_turn,
  }),
  fight_settle: Object.freeze({
    description:
      'Settle one owned terminal PvE seat and collect its canonical loot into its original personal kiosk. No caller-supplied loot or merge targets.',
    input_schema: fight_schema,
    parse: parse_fight,
  }),
})
export type GameplayActionName = keyof typeof GAMEPLAY_ACTIONS
export const parse_gameplay_action = (kind: string, payload: unknown) => {
  if (!Object.hasOwn(GAMEPLAY_ACTIONS, kind)) throw new Error('invalid_action')
  const parsed = GAMEPLAY_ACTIONS[kind as GameplayActionName].parse(payload)
  parse_target_options((parsed as { target_options?: unknown }).target_options)
  parse_world_area((parsed as { area?: unknown }).area)
  return parsed
}
export const gameplay_json = (value: unknown): string =>
  JSON.stringify(value, (_, field: unknown) => (typeof field === 'bigint' ? field.toString() : field))
export const fight_checkpoint_id = (row: FightStateRow): string => hash_secret(gameplay_json(row))
export const zone_checkpoint_id = (row: ActorWorld['zones'][string]): string => hash_secret(gameplay_json(row))
export const hydrate_gameplay_fight = (row: FightStateRow): HydratedFightCheckpoint =>
  hydrate_fight_checkpoint({
    contract: row.contract,
    sources: { players: row.players, spells: Object.fromEntries(spells.map((spell) => [spell.name, spell])) },
  })
type Plan<K extends GameplayActionName, M extends keyof Actions> = Readonly<{
  kind: K
  travel?: import('./locomotion.ts').Travel
  input: Parameters<Actions[M]>[0]
}>
export type GameplayPlan =
  | EquipmentActionPlan
  | MarketPlan
  | CreateCharacterPlan
  | ProfessionActionPlan
  | StatAllocationPlan
  | SpellAllocationPlan
  | LootBoxPlan
  | TeamActionPlan
  | Plan<'world_search', 'search_zone'>
  | Plan<'fight_engage', 'engage'>
  | Plan<'fight_place', 'place'>
  | Plan<'fight_ready', 'ready'>
  | Plan<'fight_start', 'start'>
  | Plan<'fight_crank', 'crank'>
  | Plan<'fight_turn', 'commit_turn'>
  | SettlePlan

const observed_fight = (payload: Pick<FightPayload, 'fight' | 'checkpoint_id'>, context: GameplayContext) => {
  const row = context.snapshot.fights[payload.fight]
  if (!row || fight_checkpoint_id(row) !== payload.checkpoint_id) throw new Error('needs_resync')
  return { row, checkpoint: hydrate_gameplay_fight(row) }
}
export const owned_fight = (payload: FightPayload, context: GameplayContext) => {
  const { row, checkpoint } = observed_fight(payload, context)
  const { contract } = checkpoint
  const seat = u64(payload.fighter_idx)
  const character = owned_character(context, payload.character_id)
  const { active_fight } = character
  if (!active_fight) throw new Error('fight_authority_mismatch')
  const fighter = contract.fighters.find((_, index) => BigInt(index) === seat)
  if (fighter?.kind.type !== 'player') throw new Error('fight_authority_mismatch')
  const authority = [
    character.custody === 'fight',
    active_fight.id === payload.fight,
    active_fight.seat === Number(seat),
    fighter.kind.character === payload.character_id,
    fighter.kind.owner === context.address,
    !fighter.settled,
    !fighter.forfeited,
    contract.id === payload.fight,
  ].every(Boolean)
  if (!authority) throw new Error('fight_authority_mismatch')
  assert_supported_fight(row, contract, payload.dungeon)
  assert_target_context(payload.target_options, character, {
    world: contract.world,
    x: Number(contract.x),
    z: Number(contract.z),
    types: contract.fighters.flatMap(({ kind }) => (kind.type === 'mob' ? [kind.snapshot.mob_type] : [])),
  })
  return { checkpoint, character, seat }
}
const preview_command = (fighter: bigint, action: TurnInput['actions'][number]): FightCommandInput => {
  switch (action.type) {
    case 'move':
      return { type: 'move_to', fighter, path: action.path }
    case 'cast':
      return { type: 'cast_spell', fighter, spell: action.spell, target_cell: action.target_cell }
    case 'strike':
      return { type: 'weapon_strike', fighter, target_cell: action.target_cell }
  }
}
export const fight_turn_inputs = (payload: FightTurnPayload): readonly FightCommandInput[] =>
  turn_input(payload).actions.map((action) => preview_command(u64(payload.fighter_idx), action))

const preview = (checkpoint: HydratedFightCheckpoint, input: FightCommandInput) => {
  const result = create_fight({ state: checkpoint, mode: 'remote' }).apply(input)
  if (result.error) throw new Error('illegal_fight_action:' + result.error.code)
}
const validate_turn = (context: GameplayContext, observed_ms: bigint): Plan<'fight_turn', 'commit_turn'> => {
  const payload = parse_fight_turn(context.command.payload)
  const { checkpoint, seat } = owned_fight(payload, context)
  const { contract } = checkpoint
  if ([contract.round === 0n, contract.ended, contract.queue[Number(contract.turn_ptr)] !== seat].some(Boolean))
    throw new Error('not_active_turn')
  if (observed_ms < contract.turn_started_ms) throw new Error('needs_resync')
  const input = turn_input(payload)
  const runtime = create_fight({ state: checkpoint, mode: 'remote' })
  for (const action of fight_turn_inputs(payload)) {
    const result = runtime.apply({ ...action, observed_ms })
    if (result.error) throw new Error('illegal_fight_action:' + result.error.code)
  }
  // The SDK terminal door seals lethal drafts. Twin end_turn only accepts live fights.
  if (!runtime.state().contract.ended) {
    const boundary = runtime.apply({ type: 'end_turn', fighter: seat, observed_ms })
    if (boundary.error) throw new Error('illegal_fight_turn:' + boundary.error.code)
  }
  return { kind: 'fight_turn', input }
}
const validate_place = (context: GameplayContext): Plan<'fight_place', 'place'> => {
  const payload = parse_place(context.command.payload)
  const { checkpoint, seat } = owned_fight(payload, context)
  const cell = u64(payload.cell)
  preview(checkpoint, { type: 'place', fighter: seat, cell })
  return { kind: 'fight_place', input: { fight: payload.fight, fighter_idx: seat, cell } }
}
const validate_ready = (context: GameplayContext): Plan<'fight_ready', 'ready'> => {
  const payload = parse_fight(context.command.payload)
  const { checkpoint, seat } = owned_fight(payload, context)
  preview(checkpoint, { type: 'ready', fighter: seat })
  return { kind: 'fight_ready', input: { fight: payload.fight, fighter_idx: seat } }
}
const validate_boundary = <K extends 'fight_start' | 'fight_crank'>(
  context: GameplayContext,
  kind: K
): Plan<K, 'start'> => {
  const payload = parse_fight(context.command.payload)
  const { checkpoint } = owned_fight(payload, context)
  // Unlocking a timeout requires an observed chain timestamp, never interpolation alone.
  preview(checkpoint, {
    type: kind === 'fight_start' ? 'start' : 'crank',
    observed_ms: BigInt(context.snapshot.clock!.chain_ms),
  })
  return { kind, input: { fight: payload.fight } }
}
const validate_settle = (context: GameplayContext): SettlePlan => {
  const payload = parse_fight(context.command.payload)
  const { checkpoint, character, seat } = owned_fight(payload, context)
  const { contract } = checkpoint
  if (!contract.ended) throw new Error('fight_not_ended')
  const loot = fight_loot_types(checkpoint, Number(seat)).map((item_type) => ({ item_type, existing: null }))
  const last = contract.fighters.every(
    (fighter, index) => fighter.kind.type !== 'player' || fighter.settled || fighter.forfeited || BigInt(index) === seat
  )
  return {
    kind: 'fight_settle',
    input: {
      fight: payload.fight,
      custody: custody_of(character),
      settlements: [{ fighter_idx: seat, loot }],
      last,
      boss_rewards: contract.boss_weight > 0n,
      dungeon: contract.dungeon,
    },
  }
}
const validate_search = (context: GameplayContext): Plan<'world_search', 'search_zone'> => {
  const payload = GAMEPLAY_ACTIONS.world_search.parse(context.command.payload)
  const character = owned_character(context, payload.character_id)
  const { zx, zz } = zone_of(payload.x, payload.z)
  assert_tracked_zone(context, payload.character_id, payload.world, zx, zz)
  parse_world_area(payload.area)
  assert_area_position(payload.area, character.world!, character.x!, character.z!)
  assert_area_position(payload.area, payload.world, payload.x, payload.z)
  assert_travel(character, payload, payload.x, payload.z, context.snapshot.clock!.chain_ms)
  return {
    kind: 'world_search',
    travel: { ...travel_destination(character, payload.x, payload.z), area: payload.area },
    input: {
      ...payload,
      custody: custody_of(character),
      refresh: Object.hasOwn(context.snapshot.zones, zone_key(payload.world, zx, zz)),
    },
  }
}
const validate_engage = (context: GameplayContext): Plan<'fight_engage', 'engage'> => {
  const payload = parse_engage(context.command.payload)
  const character = owned_character(context, payload.character_id)
  const key = zone_key(payload.world, payload.zone_x, payload.zone_z)
  const zone = context.snapshot.zones[key]
  assert_tracked_zone(context, payload.character_id, payload.world, payload.zone_x, payload.zone_z)
  if (!zone?.spawns || zone_checkpoint_id(zone) !== payload.zone_checkpoint_id) throw new Error('needs_resync')
  const group_index = u64(payload.group_index)
  const group = live_mob_groups(zone.spawns.mobs, zone.zone).find(
    (candidate) => BigInt(candidate.index) === group_index
  )
  if (!group || group.members.length === 0) throw new Error('mob_group_unavailable')
  const area = assert_target_context(payload.target_options, character, {
    world: payload.world,
    x: group.x,
    z: group.z,
    types: group.members.map(({ mob_type }) => mob_type),
  })
  assert_travel(character, payload, group.x, group.z, context.snapshot.clock!.chain_ms)
  return {
    kind: 'fight_engage',
    travel: { ...travel_destination(character, group.x, group.z), area },
    input: {
      character_id: payload.character_id,
      world: payload.world,
      zone_x: payload.zone_x,
      zone_z: payload.zone_z,
      group_index,
      custody: custody_of(character),
      mob_types: group.members.map(({ mob_type }) => mob_type),
    },
  }
}
/** Rechecked at final signing and submission admission against the current actor snapshot. */
export const validate_gameplay = (context: GameplayContext): GameplayPlan => {
  const observed_ms = assert_fresh(context)
  parse_target_options(context.command.payload.target_options)
  const validators: Partial<Record<GameplayContext['command']['kind'], () => GameplayPlan>> = {
    equip_item: () => validate_equip_item(context),
    use_consumable: () => validate_consumable(context),
    ...market_validators(context),
    ...character_validators(context),
    raise_stats: () => validate_stat_allocation(context),
    raise_spell: () => validate_spell_allocation(context),
    open_loot_boxes: () => validate_open_boxes(context),
    claim_loot: () => validate_claim_loot(context),
    fight_join: () => validate_fight_join(context, (payload) => observed_fight(payload, context)),
    dungeon_enter: () => validate_dungeon_enter(context),
    dungeon_fight: () => validate_dungeon_fight(context),
    dungeon_leave: () => validate_dungeon_leave(context),
    fight_forfeit: () => validate_fight_forfeit(context),
    world_search: () => validate_search(context),
    fight_engage: () => validate_engage(context),
    fight_place: () => validate_place(context),
    fight_ready: () => validate_ready(context),
    fight_start: () => validate_boundary(context, 'fight_start'),
    fight_crank: () => validate_boundary(context, 'fight_crank'),
    fight_turn: () => validate_turn(context, observed_ms),
    fight_settle: () => validate_settle(context),
  }
  return validators[context.command.kind]?.() ?? validate_profession_action(context)
}
export type GameplayActions = Pick<
  Actions,
  | 'search_zone'
  | 'engage'
  | 'place'
  | 'ready'
  | 'start'
  | 'crank'
  | 'commit_turn'
  | 'settle'
  | 'equip'
  | 'gather'
  | 'craft'
  | 'resolve_ambush'
  | 'raise_stats'
  | 'raise_spell'
  | 'open_loot_boxes'
  | 'claim_loot_batch'
  | 'use_consumable'
>
type WalletExecutor = MarketExecutor & Parameters<typeof character_executors>[0]
export type GameplayPacketSender = (packet: ClientPacket) => Promise<boolean>
export const execute_gameplay_actions = async (
  context: GameplayContext,
  actions: GameplayActions & WalletExecutor & TeamExecutor,
  send?: GameplayPacketSender
) => {
  const plan = validate_gameplay(context)
  const executors = {
    ...profession_action_executors(actions),
    ...equipment_executors(actions),
    ...team_executors(actions),
    ...market_executors(actions),
    ...character_executors(actions),
    raise_stats: actions.raise_stats,
    raise_spell: actions.raise_spell,
    open_loot_boxes: actions.open_loot_boxes,
    claim_loot: actions.claim_loot_batch,
    world_search: actions.search_zone,
    fight_engage: actions.engage,
    fight_place: actions.place,
    fight_ready: actions.ready,
    fight_start: actions.start,
    fight_crank: actions.crank,
    fight_turn: actions.commit_turn,
    fight_settle: settle_executor(actions),
  } satisfies { [Plan in GameplayPlan as Plan['kind']]: (input: Plan['input']) => Promise<unknown> }
  // The mapped type checks each key/input pair; the discriminated plan preserves that correlation at dispatch.
  const execute = () => executors[plan.kind](plan.input as never)
  if (plan.kind !== 'fight_turn' || !send) return execute()
  try {
    const fighter = BigInt(String(context.command.payload.fighter_idx))
    for (const action of plan.input.actions) {
      const sent = await send({
        type: 'packet/fight_action',
        fight: plan.input.fight,
        action: encode_fight_action({ ...preview_command(fighter, action), observed_ms: assert_fresh(context) }),
      })
      if (!sent) throw new Error('fight_connection_not_ready')
    }
    return await execute()
  } catch (error) {
    // The normal resync door rolls watchers back after a refused or uncertain draft; it never retries a write.
    try {
      await send({ type: 'packet/fight_resync', fight: plan.input.fight })
    } catch (resync_error) {
      throw new AggregateError([error, resync_error], 'Fight submission and presentation resync failed', {
        cause: resync_error,
      })
    }
    throw error
  }
}
export const execute_fight_turn = async (context: GameplayContext, actions: Pick<Actions, 'commit_turn'>) => {
  const plan = validate_gameplay(context)
  if (plan.kind !== 'fight_turn') throw new Error('invalid_action')
  return actions.commit_turn(plan.input)
}
export const execute_gameplay = ({
  sdk,
  send,
  ...context
}: GameplayContext & Readonly<{ sdk: Sdk; send?: GameplayPacketSender }>) => {
  const actions = create_agent_actions(sdk, context.address)
  return execute_gameplay_actions(
    context,
    {
      ...actions.fight,
      ...actions.character,
      ...actions.marketplace,
      dungeon: actions.dungeon,
      create_character: actions.create_character,
    },
    send
  )
}
