// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { client_to_chain_coordinate } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'

import { indexing_blocked } from '../components/IndexingCatchupModal.tsx'
import { character_travel_ready } from '../game/travel_gate.ts'
import { collect_all_available } from '../game/gather_gate.ts'
import { parse_resource_node_id, resource_node_id } from '../game/resource_nodes.ts'
import { pose_matches_character } from '../game/core/pose_feed.ts'
import { SPAWN_INTERACTION_RANGE_BLOCKS } from '../game/core/world_input.ts'
import type { AppState } from '../store.ts'

import { selected_character } from './session.ts'
import { live_spawns, parse_resource_pack_id, resource_pack_id } from './world_spawns.ts'
import {
  gathering_resources,
  stop_automation,
  with_automation_run,
  type AutomationInput,
  type AutomationRun,
  type AutomationStep,
  type AutomationTarget,
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

const resource_gate = (state: AppState, run: AutomationRun): boolean => {
  const character = selected_character(state.session)
  const resource = gathering_resources(character?.world ?? null).find(({ item_type }) => item_type === run.item_type)
  return !!character && !!resource && collect_all_available(character, resource)
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
  const node = parse_resource_node_id(target.node)
  const found = node ? parse_resource_pack_id(node.pack_id) : null
  const zone = state.world.zones[target.key]
  if (!found || !zone) return null
  if (target.node !== resource_node_id(resource_pack_id(target.key, zone.seed, found.index), 0)) return null
  return live_spawns(state.world, target.key).resources.find(({ index }) => index === found.index)
}

const with_step = (state: AppState, run: AutomationRun, step: AutomationStep): AppState =>
  with_automation_run(state, { ...run, step })

/** The next node of the same pack, or the end of the run once the pack is empty or gone. */
const next_node = (state: AppState, run: AutomationRun): AppState =>
  target_pack(state, run.target)?.item_type === run.item_type
    ? with_step(state, run, { type: 'inspecting', target: run.target })
    : stop_automation(state)

const inspect_target = (state: AppState, run: AutomationRun, step: StepOf<'inspecting'>, tick: Tick): AppState => {
  const { target } = step
  const character = selected_character(state.session)!
  if (tick.world_ms === null || !character_travel_ready(character, target, Math.floor(tick.world_ms))) return state
  const window = state.world.windows[run.character_id]
  if (!window?.zones.some(({ zx, zz }) => `${window.world}:${zx}:${zz}` === target.key)) return state
  const pack = target_pack(state, target)
  if (!pack || pack.item_type !== run.item_type) return stop_automation(state)
  return with_step(state, run, {
    type: 'gathering',
    target,
    nodes_before: pack.nodes,
    anchor_at_ms: character.at_ms!,
    seed: state.world.zones[target.key]!.seed,
    attempt_id: null,
    confirmed: false,
  })
}

const gather_step = (state: AppState, run: AutomationRun, step: StepOf<'gathering'>): AppState => {
  const character = selected_character(state.session)!
  const ready = [step.confirmed, character.at_ms! > step.anchor_at_ms, automation_character_idle(state, character)]
  if (!ready.every(Boolean)) return state
  const zone = state.world.zones[step.target.key]
  if (!zone || !state.world.spawns[step.target.key]) return state
  const consumed = zone.seed !== step.seed || (target_pack(state, step.target)?.nodes ?? 0) < step.nodes_before
  return consumed ? next_node(state, run) : state
}

/** Out of reach of its pack, the run ends: Collect All never walks. */
const advance_at_pack = (state: AppState, run: AutomationRun, tick: Tick): AppState => {
  if (!automation_character_idle(state, selected_character(state.session)!)) return stop_automation(state)
  if (!pose_matches_character(tick.pose, run.character_id)) return state
  const distance = Math.hypot(
    run.target.x - client_to_chain_coordinate(tick.pose.x),
    run.target.z - client_to_chain_coordinate(tick.pose.z)
  )
  if (distance > SPAWN_INTERACTION_RANGE_BLOCKS) return stop_automation(state)
  const { step } = run
  switch (step.type) {
    case 'inspecting':
      return inspect_target(state, run, step, tick)
    case 'retrying':
      return tick.monotonic_ms >= step.retry_at_ms
        ? with_step(state, run, { type: 'inspecting', target: step.target })
        : state
    case 'gathering':
      return state
  }
}

export const advance_automation = (state: AppState, tick: Tick): AppState => {
  const { run } = state.automation
  if (!run || !automation_available(state) || tick.world_ms === null) return state
  if (!resource_gate(state, run)) return stop_automation(state)
  if (run.step.type === 'gathering') return gather_step(state, run, run.step)
  return advance_at_pack(state, run, tick)
}
