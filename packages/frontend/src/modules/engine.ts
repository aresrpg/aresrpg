// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { EngineStatus } from '@aresrpg/engine'

import type { create_world, WorldView } from '../game/core/world.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'

import { is_world_page } from './navigation.ts'

export type EngineState = EngineStatus
export type EngineInput =
  | Readonly<{ type: 'engine/canvas_attached'; canvas: HTMLCanvasElement }>
  | Readonly<{ type: 'engine/canvas_detached'; canvas: HTMLCanvasElement }>
  | Readonly<{ type: 'engine/status'; status: EngineStatus }>

export const initial_engine_state = (): EngineState => ({ state: 'initializing', backend: 'none' })

const reduce = (state: AppState, input: AppInput): AppState =>
  input.type === 'engine/status' ? Object.freeze({ ...state, engine: input.status }) : state

type VisualControl = Readonly<{
  stage: (scene: WorldView & Readonly<{ time_of_day: number }>) => void
  state: ReturnType<typeof create_world>['state']
}>

const visual_global = globalThis as typeof globalThis & { __ares_visual__?: VisualControl }

const selected_position = (state: AppState): Readonly<{ x: number; z: number }> | null => {
  const selected = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
  if (!selected || selected.world !== selected.checkpoint_world) return null
  return Number.isFinite(selected.x) && Number.isFinite(selected.z) ? { x: selected.x!, z: selected.z! } : null
}

const selected_world = (state: AppState): string | null =>
  state.session.characters.find(({ id }) => id === state.session.selected_character_id)?.world ?? null

const observe = ({ events, dispatch, get_state, signal }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  let canvas: HTMLCanvasElement | null = null
  let world: ReturnType<typeof create_world> | null = null
  let unsubscribe_status: (() => void) | null = null
  let generation = 0

  const sync_activity = (state: AppState): void => {
    if (!world) return
    world.set_active(is_world_page(state.navigation.page))
    world.set_interactive(
      is_world_page(state.navigation.page) && (!!state.session.wallet || state.navigation.guest_spectating)
    )
  }

  const sync_settings = (state: AppState): void => {
    if (!world) return
    world.set_quality(state.settings.quality)
    world.set_flattened(state.settings.flat_mode)
  }

  const sync_target = (state: AppState): void => {
    if (!world) return
    const position = selected_position(state)
    if (position) world.point_at(position)
    else world.release()
  }

  const sync = (state: AppState): void => {
    sync_activity(state)
    sync_settings(state)
    sync_target(state)
  }

  const dispose_world = (): void => {
    generation += 1
    unsubscribe_status?.()
    unsubscribe_status = null
    world?.dispose()
    world = null
    if (import.meta.env.DEV) visual_global.__ares_visual__ = undefined
  }

  const mount = (next_canvas: HTMLCanvasElement): void => {
    if (canvas === next_canvas && world) return
    dispose_world()
    canvas = next_canvas
    const own_generation = generation
    void import('../game/core/world.ts')
      .then(({ create_world: create }) => {
        if (signal.aborted || canvas !== next_canvas || generation !== own_generation) return
        const created = create(next_canvas)
        world = created
        unsubscribe_status = created.subscribe_status((status) => dispatch({ type: 'engine/status', status }))
        sync(get_state())
        if (import.meta.env.DEV)
          visual_global.__ares_visual__ = Object.freeze({
            stage: ({ time_of_day, ...view }) => {
              created.set_view(view)
              created.set_time_of_day(time_of_day)
            },
            state: created.state,
          })
      })
      .catch((error) => {
        if (signal.aborted) return
        console.error('World engine failed to load.', error)
        dispatch({
          type: 'engine/status',
          status: {
            state: 'failed',
            backend: 'none',
            issue: { code: 'graphics_unavailable', detail: String(error) },
          },
        })
      })
  }

  events.on('engine/canvas_attached', ({ canvas: next_canvas }) => mount(next_canvas))
  events.on('engine/canvas_detached', ({ canvas: previous_canvas }) => {
    if (canvas !== previous_canvas) return
    canvas = null
    dispose_world()
  })
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.navigation !== previous.navigation || state.session.wallet !== previous.session.wallet)
      sync_activity(state)
    if (state.settings !== previous.settings) sync_settings(state)
    const selection_changed = state.session.selected_character_id !== previous.session.selected_character_id
    const target_became_available = selected_position(previous) === null && selected_position(state) !== null
    const world_changed = selected_world(state) !== selected_world(previous)
    if (selection_changed || target_became_available || world_changed) sync_target(state)
  })
  signal.addEventListener('abort', dispose_world)
}

export default Object.freeze({ name: 'engine', reduce, observe }) satisfies AppModule
