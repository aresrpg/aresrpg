// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One run-to owner. Party-member clicks resolve one checkpoint through the SDK; chat position
// links enter already resolved. The engine and HUD consume only this final target.

import { chain_to_client_coordinate } from '@aresrpg/immutable'

import { copy_text } from '../i18n/copy.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'
import { toast } from '../toast.ts'

import { selected_party } from './party.ts'
import { selected_character } from './session.ts'

export type RunToRequest = Readonly<{
  status: 'loading'
  source: 'character'
  controlled_character_id: string
  target_character_id: string
  name: string
  world: string
}>

export type RunTo =
  | RunToRequest
  | Readonly<Omit<RunToRequest, 'status'> & { status: 'running'; x: number; z: number }>
  | Readonly<{
      status: 'running'
      source: 'position'
      controlled_character_id: string
      name: string
      world: string
      x: number
      z: number
    }>

export type RunToState = Readonly<{ run: RunTo | null; restore_flat: boolean }>

export type RunToInput =
  | Readonly<{ type: 'run_to/character'; character_id: string }>
  | Readonly<{ type: 'run_to/position'; world: string; x: number; z: number }>
  | Readonly<{
      type: 'run_to/resolved'
      request: RunToRequest
      checkpoint: Readonly<{ x: number; z: number }> | null
    }>
  | Readonly<{
      type: 'run_to/stopped'
      reason: 'arrived' | 'manual' | 'blocked' | 'inactive'
      restore_flat: boolean
    }>

export const initial_run_to_state = (): RunToState => Object.freeze({ run: null, restore_flat: false })

export const run_to_progress_percent = (initial: number, remaining: number): number =>
  initial <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((1 - remaining / initial) * 100)))

export const run_to_target = (state: Readonly<AppState>): Readonly<{ x: number; z: number }> | null => {
  const { run } = state.run_to
  return run?.status === 'running' && run.controlled_character_id === state.session.selected_character_id
    ? Object.freeze({ x: chain_to_client_coordinate(run.x), z: chain_to_client_coordinate(run.z) })
    : null
}

const character_can_run = (state: Readonly<AppState>): boolean => {
  const controlled = selected_character(state.session)
  if (!controlled?.world) return false
  return ![
    controlled.world !== controlled.checkpoint_world,
    controlled.custody !== 'kiosk',
    controlled.active_fight,
    controlled.dungeon_run,
    controlled.ambush,
    state.world.gathering,
    state.fight.mounted,
    state.session.link_status !== 'ready',
  ].some(Boolean)
}

export const run_to_available = character_can_run

const character_request = (state: Readonly<AppState>, target: string): RunToRequest | null => {
  if (!character_can_run(state)) return null
  const controlled = selected_character(state.session)
  const member = selected_party(state)?.members.find(({ character_id }) => character_id === target)
  const owned = state.session.characters.some(({ id }) => id === target)
  if (!controlled?.world || !member || owned) return null
  return Object.freeze({
    status: 'loading',
    source: 'character',
    controlled_character_id: controlled.id,
    target_character_id: target,
    name: member.name,
    world: controlled.world,
  })
}

const position_run = (
  state: Readonly<AppState>,
  input: Readonly<Extract<RunToInput, { type: 'run_to/position' }>>
): RunTo | null => {
  if (!character_can_run(state)) return null
  const controlled = selected_character(state.session)
  return controlled?.world === input.world
    ? Object.freeze({
        status: 'running',
        source: 'position',
        controlled_character_id: controlled.id,
        name: input.world,
        world: input.world,
        x: input.x,
        z: input.z,
      })
    : null
}

const with_run = (state: Readonly<AppState>, run: RunTo | null, restore_flat = state.run_to.restore_flat): AppState =>
  Object.freeze({ ...state, run_to: Object.freeze({ run, restore_flat }) })

const start_run = (state: Readonly<AppState>, run: RunTo | null): AppState =>
  with_run(state, run, run !== null && (state.run_to.restore_flat || !state.settings.flat_mode))

const run_member_exists = (state: Readonly<AppState>, run: Readonly<RunTo>): boolean =>
  run.source !== 'character' ||
  selected_party(state)?.members.some(({ character_id }) => character_id === run.target_character_id) === true

const fold_command = (state: AppState, input: AppInput): AppState | null => {
  if (input.type === 'run_to/character') return start_run(state, character_request(state, input.character_id))
  if (input.type === 'run_to/position') return start_run(state, position_run(state, input))
  if (input.type === 'run_to/resolved') {
    if (state.run_to.run !== input.request) return state
    return with_run(
      state,
      input.checkpoint ? Object.freeze({ ...input.request, status: 'running' as const, ...input.checkpoint }) : null,
      input.checkpoint ? state.run_to.restore_flat : false
    )
  }
  return null
}

const cancels_run = (input: Readonly<AppInput>): boolean =>
  ['run_to/stopped', 'character/select', 'auth/disconnected', 'auth/rejected', 'auth/connected'].includes(input.type)

const reduce = (state: AppState, input: AppInput): AppState => {
  const command = fold_command(state, input)
  if (command) return command
  if (cancels_run(input)) return state.run_to.run ? with_run(state, null, false) : state
  if (input.type === 'server/packet' && input.packet.type === 'packet/party') {
    const { run: next } = state.run_to
    return next && !run_member_exists(state, next) ? with_run(state, null) : state
  }
  return state
}

const observe: NonNullable<AppModule['observe']> = ({ events, get_state, dispatch }) => {
  const text = (key: string, values?: Readonly<Record<string, string>>) => {
    const { copy } = get_state()
    return copy ? copy_text(copy.party_panel)(key, values) : key
  }
  const enable_flat_mode = (): void => {
    const state = get_state()
    if (!state.settings.flat_mode)
      dispatch({ type: 'settings/changed', settings: Object.freeze({ ...state.settings, flat_mode: true }) })
  }
  events.on('run_to/character', () => {
    const state = get_state()
    const request = state.run_to.run
    const { wallet } = state.session
    if (!wallet || request?.status !== 'loading') return
    void wallet
      .read_character_checkpoint(request.target_character_id, request.world)
      .then((checkpoint) => {
        const current = get_state()
        if (current.run_to.run !== request || current.session.wallet !== wallet) return
        dispatch({ type: 'run_to/resolved', request, checkpoint })
        if (!checkpoint) return void toast.add(text('run_to_wrong_world'))
        enable_flat_mode()
        toast.add(text('run_to_started', { name: request.name }), 'info')
      })
      .catch((error: unknown) => {
        if (get_state().run_to.run !== request || get_state().session.wallet !== wallet) return
        dispatch({ type: 'run_to/resolved', request, checkpoint: null })
        console.warn('The run-to checkpoint lookup failed.', error)
        toast.add(text('run_to_unavailable'))
      })
  })
  events.on('run_to/position', (input) => {
    const state = get_state()
    const { run } = state.run_to
    if (run?.source !== 'position' || run.world !== input.world || run.x !== input.x || run.z !== input.z) {
      if (selected_character(state.session)?.world !== input.world) toast.add(text('run_to_position_wrong_world'))
      return
    }
    enable_flat_mode()
    toast.add(text('run_to_started_position'), 'info')
  })
  events.on('run_to/stopped', ({ reason, restore_flat }) => {
    if (reason !== 'arrived' || !restore_flat) return
    const state = get_state()
    if (state.settings.flat_mode)
      dispatch({ type: 'settings/changed', settings: Object.freeze({ ...state.settings, flat_mode: false }) })
  })
}

export default Object.freeze({ name: 'run_to', reduce, observe }) satisfies AppModule
