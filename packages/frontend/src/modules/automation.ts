// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { read_pose, subscribe_pose } from '../game/core/pose_feed.ts'
import { character_travel_ready } from '../game/travel_gate.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'

import { chain_now } from './chain_clock.ts'
import { selected_character } from './session.ts'
import {
  advance_automation,
  automation_available,
  automation_resource_gate,
  automation_character_idle,
} from './automation_step.ts'
import {
  initial_automation_state,
  stop_automation,
  retry_automation,
  with_automation,
  with_automation_run,
  type AutomationRun,
} from './automation_state.ts'
import { fight_result_available, fight_result_complete } from './fight_result_view.ts'

export { initial_automation_state }
export type { AutomationInput, AutomationState } from './automation_state.ts'

const start = (state: AppState, id: string): AppState => {
  const character = selected_character(state.session)
  if (state.automation.run || !state.automation.unlocked) return state
  if (
    !character ||
    !automation_available(state) ||
    !automation_resource_gate(state) ||
    !automation_character_idle(state, character) ||
    Object.keys(state.world.pending_zone_searches).length > 0
  )
    return stop_automation(state, 'unavailable')
  return with_automation(state, {
    ...state.automation,
    quantity: 0,
    reason: null,
    run: {
      id,
      character_id: character.id,
      world: character.world!,
      item_type: state.automation.item_type,
      visited: {},
      step: { type: 'planning' },
    },
  })
}

const fold_command = (state: AppState, input: AppInput): AppState | null => {
  switch (input.type) {
    case 'automation/unlocked':
      return state.automation.unlocked ? state : with_automation(state, { ...state.automation, unlocked: true })
    case 'automation/resource':
      return state.automation.run
        ? state
        : with_automation(state, { ...state.automation, item_type: input.item_type, reason: null })
    case 'automation/start':
      return start(state, input.id)
    case 'automation/stop':
      return stop_automation(state, input.reason)
    case 'automation/tick':
      return advance_automation(state, input)
    default:
      return null
  }
}

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
  if (step.confirmed) return state
  return with_automation(state, {
    ...state.automation,
    quantity: state.automation.quantity + input.quantity,
    run: { ...run, step: { ...step, confirmed: true } },
  })
}

const protector_outcome = (state: AppState, run: AutomationRun, input: AppInput): AppState => {
  const { step } = run
  if (step.type !== 'gathering') return state
  if (input.type === 'fight/forfeit_completed') {
    if (![input.fight === step.fight, input.fighter === step.fighter, step.forfeit === 'pending'].every(Boolean))
      return state
    return input.ok
      ? with_automation_run(state, { ...run, step: { ...step, forfeit: 'confirmed' } })
      : stop_automation(state, 'failed')
  }
  if (input.type !== 'world/ambush_resolved' && input.type !== 'world/ambush_failed') return state
  if (
    ![step.attempt_id !== null, input.attempt_id === step.attempt_id, input.character_id === run.character_id].every(
      Boolean
    )
  )
    return state
  return input.type === 'world/ambush_failed'
    ? stop_automation(state, 'failed')
    : with_automation_run(state, { ...run, step: { ...step, fight: input.fight } })
}

const interrupted = (state: AppState, run: AutomationRun, input: AppInput): boolean => {
  const character = selected_character(state.session)
  if (character?.id !== run.character_id || character.world !== run.world) return true
  if (['auth/connected', 'auth/disconnected', 'auth/rejected', 'world/engage', 'run_to/character'].includes(input.type))
    return true
  return input.type === 'run_to/position' && input.source !== 'automation'
}

const movement_outcome = (state: AppState, run: AutomationRun, input: AppInput): AppState | null => {
  if (input.type === 'run_to/stopped' && run.step.type === 'moving') {
    if (input.reason === 'inactive') return with_automation_run(state, { ...run, step: { type: 'planning' } })
    return input.reason === 'arrived'
      ? with_automation_run(state, {
          ...run,
          step: { type: 'inspecting', target: run.step.target },
        })
      : stop_automation(state, input.reason === 'manual' ? 'stopped' : 'blocked')
  }
  if (input.type === 'world/search_zone_failed' && run.step.type === 'searching' && input.key === run.step.target.key)
    return retry_automation(
      state,
      run,
      { key: input.key, x: run.step.target.x, z: run.step.target.z, node: null },
      input.retry_at_ms
    )
  return null
}

export const reduce_automation = (state: AppState, input: AppInput): AppState => {
  const command = fold_command(state, input)
  if (command) return command
  const { run } = state.automation
  if (!run) return state
  if (interrupted(state, run, input)) return stop_automation(state, 'stopped')
  const movement = movement_outcome(state, run, input)
  if (movement) return movement
  const gathered = gather_outcome(state, run, input)
  return gathered !== state ? gathered : protector_outcome(state, run, input)
}

const command_for_run = (run: AutomationRun | null): AppInput | null => {
  if (!run) return null
  const { step } = run
  switch (step.type) {
    case 'moving':
      return { type: 'run_to/position', world: run.world, x: step.target.x, z: step.target.z, source: 'automation' }
    case 'searching':
      return { type: 'world/search_zone', target: step.target }
    case 'gathering':
      if (step.forfeit === 'confirmed') return null
      return step.forfeit === 'pending'
        ? {
            type: 'fight/input',
            fight: step.fight!,
            origin: 'local',
            input: { type: 'forfeit', fighter: step.fighter! },
          }
        : { type: 'world/gather', node: step.target.node! }
    default:
      return null
  }
}

/** Each phase issues one command; later confirmations/progress updates retain that phase. */
export const automation_command = (state: AppState, previous: AppState): AppInput | null => {
  const command = command_for_run(state.automation.run)
  const before = command_for_run(previous.automation.run)
  return command?.type === before?.type ? null : command
}

const protector_result_ready = (state: AppState): boolean => {
  const { run } = state.automation
  if (!run) return false
  const { step } = run
  if (step.type !== 'gathering' || step.forfeit !== 'confirmed') return false
  const result = state.fight_result.current_by_character[run.character_id]
  return (
    !!result &&
    [
      result.fight === step.fight,
      result.result_open,
      fight_result_complete(result),
      fight_result_available(state.fight, result.fight),
    ].every(Boolean)
  )
}

/** Find the first legal millisecond within the next poll using the existing travel proof. */
export const automation_wake_delay = (state: AppState, now: number | null): number => {
  const step = state.automation.run?.step
  const character = selected_character(state.session)
  if (step?.type !== 'inspecting') return 250
  const ready = (delay: number): boolean =>
    character !== null && now !== null && character_travel_ready(character, step.target, Math.floor(now + delay))
  let lower = 0
  let upper = 250
  if (ready(lower) || !ready(upper)) return upper
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2)
    if (ready(middle)) upper = middle
    else lower = middle
  }
  return upper
}

export const observe_automation: NonNullable<AppModule['observe']> = ({ events, get_state, dispatch, signal }) => {
  let timer: ReturnType<typeof setTimeout> | null = null
  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer)
    const state = get_state()
    const step = state.automation.run?.step
    const now = performance.now()
    const world_ms = chain_now(state.chain_clock, now)
    if (!step || !automation_available(state) || world_ms === null) {
      timer = null
      return
    }
    const delay =
      step.type === 'retrying' && step.retry_at_ms > now
        ? step.retry_at_ms - now
        : automation_wake_delay(state, world_ms)
    timer = setTimeout(advance, delay)
  }
  const advance = (): void => {
    const state = get_state()
    if (state.automation.run)
      dispatch({
        type: 'automation/tick',
        monotonic_ms: performance.now(),
        world_ms: chain_now(state.chain_clock, performance.now()),
        pose: read_pose(),
      })
    schedule()
  }
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.run_to.run?.source === 'automation' && state.automation.run?.step.type !== 'moving')
      dispatch({
        type: 'run_to/stopped',
        reason: state.automation.run ? 'arrived' : 'manual',
        restore_flat: state.run_to.restore_flat,
      })
    const command = automation_command(state, previous)
    if (command) dispatch(command)
    if (protector_result_ready(state))
      dispatch({ type: 'fight_result/closed', character_id: state.automation.run!.character_id })
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
  reduce: reduce_automation,
  observe: observe_automation,
}) satisfies AppModule
