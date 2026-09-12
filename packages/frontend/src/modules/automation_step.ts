// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { client_to_chain_coordinate } from '@aresrpg/immutable'
import { ZONE_RESEARCH_TTL_MS, type CharacterRow } from '@aresrpg/protocol'

import { indexing_blocked } from '../components/IndexingCatchupModal.tsx'
import { character_travel_ready } from '../game/travel_gate.ts'
import { gather_gate } from '../game/gather_gate.ts'
import { parse_resource_node_id, resource_node_id } from '../game/resource_nodes.ts'
import { pose_matches_character } from '../game/core/pose_feed.ts'
import { SPAWN_INTERACTION_RANGE_BLOCKS } from '../game/core/world_input.ts'
import { RUN_TO_ARRIVAL_DISTANCE } from '../game/core/run_to.ts'
import type { AppState } from '../store.ts'

import { selected_character } from './session.ts'
import { remote_input_context } from './fight_chain.ts'
import { live_spawns, parse_resource_pack_id, resource_pack_id } from './world_spawns.ts'
import { searchable_zone, zone_discovery_arrived } from './world.ts'
import {
  automation_zone_key,
  gathering_resources,
  nearest_resource,
  next_resource_zone,
  remember_empty_zone,
  type AutomationTarget,
  type RouteContext,
} from './automation_route.ts'
import {
  stop_automation,
  with_automation_run,
  type AutomationInput,
  type AutomationRun,
  type AutomationStep,
} from './automation_state.ts'

type Tick = Extract<AutomationInput, { type: 'automation/tick' }>

export const automation_available = (state: AppState): boolean => {
  const character = selected_character(state.session)
  return (
    !!character?.world &&
    state.session.wallet !== null &&
    state.session.game_frozen === false &&
    state.session.link_status === 'ready' &&
    !indexing_blocked(state.session.link_status, state.session.indexing_lag) &&
    !character.dungeon_run
  )
}

export const automation_resource_gate = (state: AppState): boolean => {
  const character = selected_character(state.session)
  const resource = gathering_resources(character?.world ?? null).find(
    ({ item_type }) => item_type === state.automation.item_type
  )
  return !!character && !!resource && gather_gate(character, resource).ok
}

export const automation_character_idle = (state: AppState, character: Readonly<CharacterRow>): boolean =>
  ![
    character.custody !== 'kiosk',
    character.checkpoint_world !== character.world,
    character.active_fight,
    character.ambush,
    state.world.gathering[character.id],
    state.fight.mounted,
  ].some(Boolean)

type StepOf<Kind extends AutomationStep['type']> = Extract<AutomationStep, { type: Kind }>

const target_pack = (state: AppState, target: AutomationTarget) => {
  const node = parse_resource_node_id(target.node ?? '')
  const found = node ? parse_resource_pack_id(node.pack_id) : null
  const zone = state.world.zones[target.key]
  if (!found || !zone) return null
  if (target.node !== resource_node_id(resource_pack_id(target.key, zone.seed, found.index), 0)) return null
  return live_spawns(state.world, target.key).resources.find(({ index }) => index === found.index)
}

const travel_ready = (state: AppState, target: AutomationTarget, world_ms: number | null): boolean =>
  world_ms !== null && character_travel_ready(selected_character(state.session)!, target, Math.floor(world_ms))

const with_step = (state: AppState, run: AutomationRun, step: AutomationStep): AppState =>
  with_automation_run(state, { ...run, step })

const after_deadline = (
  state: AppState,
  run: AutomationRun,
  now_ms: number,
  deadline_ms: number,
  step: AutomationStep
): AppState => (now_ms >= deadline_ms ? with_step(state, run, step) : state)

const target_in_range = (target: AutomationTarget, position: Readonly<{ x: number; z: number }>): boolean =>
  Math.hypot(target.x - position.x, target.z - position.z) <=
  (target.node ? SPAWN_INTERACTION_RANGE_BLOCKS : RUN_TO_ARRIVAL_DISTANCE)

const plan = (state: AppState, run: AutomationRun, context: RouteContext): AppState => {
  const key = automation_zone_key(run.world, context.x, context.z)
  const current = nearest_resource(context, key)
  const complete = state.world.zones[key] && state.world.spawns[key]
  const visited = complete && !current ? remember_empty_zone(context, key) : run.visited
  const target = current ?? next_resource_zone({ ...context, visited })
  const next = { ...run, visited }
  if (!target) {
    const expiries = Object.values(visited).filter((until) => until > context.now_ms)
    const until_ms = expiries.length ? Math.min(...expiries) : context.now_ms + ZONE_RESEARCH_TTL_MS
    return with_step(state, next, { type: 'waiting', until_ms })
  }
  return with_step(
    state,
    next,
    target_in_range(target, context) ? { type: 'inspecting', target } : { type: 'moving', target }
  )
}

const inspect_target = (state: AppState, run: AutomationRun, step: StepOf<'inspecting'>, tick: Tick): AppState => {
  const { target } = step
  if (!travel_ready(state, target, tick.world_ms)) return state
  const window = state.world.windows[run.character_id]
  if (!window?.zones.some(({ zx, zz }) => `${window.world}:${zx}:${zz}` === target.key)) return state
  if (target.node) {
    const pack = target_pack(state, target)
    if (!pack || pack.item_type !== run.item_type) return with_step(state, run, { type: 'planning' })
    return with_step(state, run, {
      type: 'gathering',
      target,
      nodes_before: pack.nodes,
      seed: state.world.zones[target.key]!.seed,
      attempt_id: null,
      confirmed: false,
      fight: null,
      fighter: null,
      forfeit: 'idle',
    })
  }
  const search = searchable_zone(state, Math.floor(tick.world_ms!), tick.pose)
  if (search?.key === target.key) return with_step(state, run, { type: 'searching', target: search })
  if (state.world.zones[target.key] && state.world.spawns[target.key])
    return with_step(state, run, { type: 'planning' })
  return state
}

const protector_step = (state: AppState, run: AutomationRun, step: StepOf<'gathering'>): AppState => {
  const character = selected_character(state.session)!
  if (step.forfeit === 'confirmed') {
    const result = state.fight_result.current_by_character[run.character_id]
    return automation_character_idle(state, character) && !result?.result_open
      ? with_step(state, run, { type: 'planning' })
      : state
  }
  const fight = step.fight!
  if (step.forfeit !== 'idle' || state.fight.environments[fight]?.transaction_pending) return state
  const context = remote_input_context(state, fight, 'local')
  if (!context || context.checkpoint.contract.ended) return state
  const { checkpoint } = context
  const fighter = checkpoint.contract.fighters.findIndex(
    (row) =>
      row.kind.type === 'player' &&
      [
        row.kind.character === run.character_id,
        row.kind.owner === state.session.wallet!.address,
        !row.forfeited,
        !row.settled,
        !row.dead,
      ].every(Boolean)
  )
  return fighter < 0 ? state : with_step(state, run, { ...step, forfeit: 'pending', fighter: BigInt(fighter) })
}

const gather_step = (state: AppState, run: AutomationRun, step: StepOf<'gathering'>): AppState => {
  if (step.fight) return protector_step(state, run, step)
  if (!step.confirmed || !automation_character_idle(state, selected_character(state.session)!)) return state
  const zone = state.world.zones[step.target.key]
  if (!zone || !state.world.spawns[step.target.key]) return state
  const consumed = zone.seed !== step.seed || (target_pack(state, step.target)?.nodes ?? 0) < step.nodes_before
  return consumed ? with_step(state, run, { type: 'planning' }) : state
}

const advance_movement = (
  state: AppState,
  run: AutomationRun,
  step: StepOf<'moving'>,
  context: RouteContext,
  tick: Tick
): AppState => {
  if (target_in_range(step.target, context) && travel_ready(state, step.target, tick.world_ms))
    return with_step(state, run, { type: 'inspecting', target: step.target })
  return state
}

const advance_world_step = (state: AppState, run: AutomationRun, context: RouteContext, tick: Tick): AppState => {
  const { step } = run
  switch (step.type) {
    case 'planning':
      return plan(state, run, context)
    case 'moving':
      return advance_movement(state, run, step, context, tick)
    case 'inspecting':
      return inspect_target(state, run, step, tick)
    case 'searching':
      return zone_discovery_arrived(
        state.world.zones[step.target.key],
        state.world.spawns[step.target.key],
        step.target.previous_searched_at_ms
      )
        ? with_step(state, run, { type: 'planning' })
        : state
    case 'waiting':
      return after_deadline(state, run, context.now_ms, step.until_ms, { type: 'planning' })
    case 'retrying':
      return after_deadline(state, run, tick.monotonic_ms, step.retry_at_ms, {
        type: 'inspecting',
        target: step.target,
      })
    case 'gathering':
      return state
  }
}

export const advance_automation = (state: AppState, tick: Tick): AppState => {
  const { run } = state.automation
  if (!run) return state
  if (!automation_available(state) || tick.world_ms === null) return state
  if (!automation_resource_gate(state)) return stop_automation(state, 'unavailable')
  if (run.step.type === 'gathering') return gather_step(state, run, run.step)
  return advance_travel(state, run, tick)
}

const advance_travel = (state: AppState, run: AutomationRun, tick: Tick): AppState => {
  if (!automation_character_idle(state, selected_character(state.session)!))
    return stop_automation(state, 'unavailable')
  if (!pose_matches_character(tick.pose, run.character_id)) return state
  const context: RouteContext = {
    world: run.world,
    resource: gathering_resources(run.world).find(({ item_type }) => item_type === run.item_type)!,
    zones: state.world,
    visited: run.visited,
    now_ms: tick.world_ms!,
    x: client_to_chain_coordinate(tick.pose.x),
    z: client_to_chain_coordinate(tick.pose.z),
  }
  return advance_world_step(state, run, context, tick)
}
