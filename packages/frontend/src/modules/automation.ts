// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Collect All: one character empties one resource pack it stands at, one confirmed gather at a time. A protector,
// a fight or a step away ends the run; it never walks, searches or forfeits.

import { client_to_chain_coordinate } from '@aresrpg/immutable'

import { collect_all_available } from '../game/gather_gate.ts'
import { resource_at } from '../game/gather_target.ts'
import { resource_node_id } from '../game/resource_nodes.ts'
import { SPAWN_INTERACTION_RANGE_BLOCKS, world_keyboard_eligible, WORLD_MOVE_KEYS } from '../game/core/world_input.ts'
import { pose_matches_character, read_pose, subscribe_pose } from '../game/core/pose_feed.ts'
import type { AppContext, AppInput, AppModule, AppState } from '../store.ts'

import { chain_now } from './chain_clock.ts'
import { selected_character } from './session.ts'
import { advance_automation, automation_available, automation_character_idle } from './automation_step.ts'
import {
  initial_automation_state,
  stop_automation,
  retry_automation,
  with_automation_run,
  type AutomationInput,
  type AutomationRun,
} from './automation_state.ts'

export { initial_automation_state }
export type { AutomationInput, AutomationState } from './automation_state.ts'

/** The pack under the pressed node, while the character stands within reach of it. */
const collect_all_target = (state: AppState, input: Extract<AutomationInput, { type: 'automation/collect_all' }>) => {
  const row = resource_at(input.node, state)
  if (!row || !collect_all_available(row.character, row.resource)) return null
  if (!pose_matches_character(input.pose, row.character.id)) return null
  const { pack, found } = row
  const distance = Math.hypot(
    pack.x - client_to_chain_coordinate(input.pose.x),
    pack.z - client_to_chain_coordinate(input.pose.z)
  )
  if (distance > SPAWN_INTERACTION_RANGE_BLOCKS) return null
  return {
    item_type: pack.item_type,
    target: { key: found.key, x: pack.x, z: pack.z, node: resource_node_id(row.node.pack_id, 0) },
    nodes: pack.nodes,
  }
}

const start = (state: AppState, input: Extract<AppInput, { type: 'automation/collect_all' }>): AppState => {
  if (
    [
      state.automation.run,
      state.run_to.run,
      !automation_available(state),
      Object.keys(state.world.pending_zone_searches).length > 0,
    ].some(Boolean)
  )
    return state
  const request = collect_all_target(state, input)
  const character = selected_character(state.session)
  if (!request || !character || !automation_character_idle(state, character)) return state
  return with_automation_run(state, {
    ...request,
    id: input.id,
    character_id: character.id,
    world: character.world!,
    step: { type: 'inspecting', target: request.target },
  })
}

/** A run continues only while nothing contests the pack: no protector, no fight, a live link. */
const automation_access = (state: AppState, run: AutomationRun): boolean => {
  const character = selected_character(state.session)
  return ![
    state.session.link_status !== 'ready',
    character?.ambush,
    character?.active_fight,
    state.world.gathering[run.character_id]?.ambushed,
    state.fight.mounted,
  ].some(Boolean)
}

/** A pack waits for observed chain time, never an extrapolated cooldown deadline. */
const automation_clock = (state: AppState, monotonic_ms: number): number | null =>
  chain_now(state.chain_clock, monotonic_ms) === null ? null : state.chain_clock!.chain_ms

const gather_outcome = (state: AppState, run: AutomationRun, input: AppInput): AppState => {
  const { step } = run
  if (step.type !== 'gathering') return state
  if (input.type === 'world/gather_started') {
    const { gathering } = input
    if (
      step.attempt_id !== null ||
      ![gathering.character_id === run.character_id, gathering.item_type === run.item_type].every(Boolean)
    )
      return state
    return with_automation_run(state, { ...run, step: { ...step, attempt_id: gathering.attempt_id } })
  }
  if (input.type !== 'world/gather_confirmed' && input.type !== 'world/gather_failed') return state
  if (input.character_id !== run.character_id || input.attempt_id !== step.attempt_id) return state
  if (input.type === 'world/gather_failed') return retry_automation(state, run, step.target, input.retry_at_ms)
  return step.confirmed ? state : with_automation_run(state, { ...run, step: { ...step, confirmed: true } })
}

const INTERRUPTIONS: readonly AppInput['type'][] = [
  'auth/connected',
  'auth/disconnected',
  'auth/rejected',
  'world/engage',
  'run_to/character',
  'run_to/fight',
  'run_to/position',
]
const interrupted = (state: AppState, run: AutomationRun, input: AppInput): boolean => {
  const character = selected_character(state.session)
  return character?.id !== run.character_id || character.world !== run.world || INTERRUPTIONS.includes(input.type)
}

export const reduce_automation = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'automation/collect_all') return start(state, input)
  const { run } = state.automation
  if (!run) return state
  if (
    [
      state.session.agent_view.request,
      !automation_access(state, run),
      input.type === 'automation/stop',
      interrupted(state, run, input),
    ].some(Boolean)
  )
    return stop_automation(state)
  return input.type === 'automation/tick' ? advance_automation(state, input) : gather_outcome(state, run, input)
}

/** The gather a run asks for: once, when its step becomes a gather. */
const gather_command = (run: AutomationRun | null): AppInput | null =>
  run?.step.type === 'gathering' ? { type: 'world/gather', node: run.step.target.node } : null

const observe_automation_controls = ({ get_state, dispatch, signal }: AppContext): void => {
  const on_key = (event: Readonly<KeyboardEvent>): void => {
    const state = get_state()
    if (
      !state.automation.run ||
      (state.navigation.page !== 'world' && event.code !== 'Escape') ||
      !world_keyboard_eligible(event)
    )
      return
    if (WORLD_MOVE_KEYS[event.code] || ['Space', 'Escape'].includes(event.code)) dispatch({ type: 'automation/stop' })
  }
  globalThis.addEventListener?.('keydown', on_key, { capture: true })
  signal.addEventListener('abort', () => globalThis.removeEventListener?.('keydown', on_key, { capture: true }))
}

const observe_automation: NonNullable<AppModule['observe']> = (context) => {
  const { events, get_state, dispatch, signal } = context
  observe_automation_controls(context)
  let timer: ReturnType<typeof setTimeout> | null = null
  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer)
    const state = get_state()
    const step = state.automation.run?.step
    const now = performance.now()
    if (!step || !automation_available(state) || automation_clock(state, now) === null) {
      timer = null
      return
    }
    const delay = step.type === 'retrying' && step.retry_at_ms > now ? step.retry_at_ms - now : 250
    timer = setTimeout(advance, delay)
  }
  const advance = (): void => {
    const state = get_state()
    if (state.automation.run)
      dispatch({
        type: 'automation/tick',
        monotonic_ms: performance.now(),
        world_ms: automation_clock(state, performance.now()),
        pose: read_pose(),
      })
    schedule()
  }
  events.on('STATE_UPDATED', (state, previous) => {
    const command = gather_command(state.automation.run)
    if (command && !gather_command(previous.automation.run)) dispatch(command)
    advance()
  })
  const unsubscribe_pose = subscribe_pose(advance)
  schedule()
  signal.addEventListener('abort', () => {
    unsubscribe_pose()
    if (timer !== null) clearTimeout(timer)
  })
}

export default Object.freeze({
  name: 'automation',
  initial: () => ({ automation: initial_automation_state() }),
  reduce: reduce_automation,
  observe: observe_automation,
}) satisfies AppModule
