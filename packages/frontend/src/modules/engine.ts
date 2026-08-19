// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { parse_world_recipe, type EngineStatus } from '@aresrpg/engine'
import { chain_to_client_coordinate } from '@aresrpg/immutable'

import type { create_world, WorldView } from '../game/core/world.ts'
import { character_render_source, load_character_appearance } from '../game/character_entities.ts'
import {
  browser_position_storage,
  create_position_writer,
  resume_position,
  type ChainAnchor,
} from '../game/core/position_store.ts'
import { read_pose, subscribe_pose } from '../game/core/pose_feed.ts'
import { create_presence_renderer } from '../game/presence_entities.ts'
import { world_terrain } from '../content/worlds.ts'
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
  return Number.isFinite(selected.x) && Number.isFinite(selected.z)
    ? {
        x: chain_to_client_coordinate(selected.x!),
        z: chain_to_client_coordinate(selected.z!),
      }
    : null
}

/** The chain checkpoint as the LOCAL cache's identity: a saved pose is honored only while it
 *  was captured under this exact anchor (chain truth moved = the cache is stale). */
const selected_anchor = (
  state: AppState
): Readonly<{ character_id: string; world: string; anchor: ChainAnchor }> | null => {
  const selected = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
  if (!selected?.world || selected.world !== selected.checkpoint_world) return null
  if (!Number.isFinite(selected.x) || !Number.isFinite(selected.z)) return null
  return Object.freeze({
    character_id: selected.id,
    world: selected.world,
    anchor: Object.freeze({ x: selected.x!, z: selected.z!, at_ms: selected.at_ms ?? 0 }),
  })
}

const selected_world = (state: AppState): string | null =>
  state.session.characters.find(({ id }) => id === state.session.selected_character_id)?.world ?? null

const observe = ({ events, dispatch, get_state, signal }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  let canvas: HTMLCanvasElement | null = null
  let world: ReturnType<typeof create_world> | null = null
  let presence: ReturnType<typeof create_presence_renderer> | null = null
  let unsubscribe_status: (() => void) | null = null
  let generation = 0
  let mounted_world_name: string | null | undefined
  let character_generation = 0
  let character_key: string | null = null
  let target_generation = 0
  const storage = browser_position_storage()

  const sync_activity = (state: AppState): void => {
    if (!world) return
    world.set_active(is_world_page(state.navigation.page))
    world.set_interactive(
      is_world_page(state.navigation.page) && (!!state.session.wallet || state.navigation.guest_spectating)
    )
  }

  const sync_settings = (state: AppState): void => {
    if (!world) return
    world.set_quality(state.settings.quality, state.settings.render_distance)
    world.set_flattened(state.settings.flat_mode)
  }

  const sync_target = (state: AppState): void => {
    if (!world) return
    const position = selected_position(state)
    if (!position) {
      world.release()
      return
    }
    // The saved local pose (IndexedDB) wins over the checkpoint only while it explains
    // itself against the current chain anchor; the arbitration is async, so the point is
    // deferred and guarded against a selection change in flight.
    const identity = selected_anchor(state)
    target_generation += 1
    const own_generation = target_generation
    const point = (resumed: Readonly<{ x: number; z: number }> | null): void => {
      if (signal.aborted || own_generation !== target_generation || !world) return
      world.point_at(resumed ?? position)
    }
    if (!identity) {
      point(null)
      return
    }
    storage
      .load(identity.character_id, identity.world)
      .then((saved) => point(resume_position(saved, identity.anchor)))
      .catch((error: unknown) => {
        console.error('The saved position could not be read — resuming at the checkpoint.', error)
        point(null)
      })
  }

  const sync_character = (state: AppState): void => {
    if (!world) return
    const selected = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
    const source = selected ? character_render_source(selected) : null
    const next_key = source ? JSON.stringify(source) : null
    if (next_key === character_key) return
    character_key = next_key
    character_generation += 1
    const own_generation = character_generation
    if (!source) {
      world.set_character(null)
      return
    }
    void load_character_appearance(source).then(
      (appearance) => {
        if (signal.aborted || own_generation !== character_generation || !world) return
        world.set_character(Object.freeze({ id: source.id, appearance }))
      },
      (error: unknown) => {
        if (own_generation !== character_generation || !world) return
        console.error(`Character ${source.id} failed to resolve its appearance.`, error)
        world.set_character(null)
      }
    )
  }

  const sync_presence = (state: AppState): void => {
    presence?.update(state.world.players, state.session.selected_character_id)
  }

  const sync = (state: AppState): void => {
    sync_activity(state)
    sync_settings(state)
    sync_target(state)
    sync_character(state)
    sync_presence(state)
  }

  const dispose_world = (): void => {
    generation += 1
    character_generation += 1
    character_key = null
    presence?.dispose()
    presence = null
    unsubscribe_status?.()
    unsubscribe_status = null
    world?.dispose()
    world = null
    mounted_world_name = undefined
    if (import.meta.env.DEV) visual_global.__ares_visual__ = undefined
  }

  const mount = (next_canvas: HTMLCanvasElement): void => {
    const world_name = selected_world(get_state())
    if (canvas === next_canvas && world && mounted_world_name === world_name) return
    dispose_world()
    canvas = next_canvas
    mounted_world_name = world_name
    const terrain = world_terrain(world_name)
    if (!terrain) {
      dispatch({
        type: 'engine/status',
        status: {
          state: 'failed',
          backend: 'none',
          issue: { code: 'world_unavailable', detail: world_name ?? undefined },
        },
      })
      return
    }
    const own_generation = generation
    void import('../game/core/world.ts')
      .then(({ create_world: create }) => {
        if (signal.aborted || canvas !== next_canvas || generation !== own_generation) return
        const created = create({
          canvas: next_canvas,
          world: parse_world_recipe(terrain),
          quality: get_state().settings.quality,
        })
        world = created
        presence = create_presence_renderer({ submit: created.set_entities, entity_height: created.entity_height })
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
        if (signal.aborted || canvas !== next_canvas || generation !== own_generation) return
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

  // ── the resume cache's write half: debounced saves from the pose lane, fight-gated ──
  const writer = create_position_writer({
    save: (row) => {
      const identity = selected_anchor(get_state())
      if (!identity) return
      void storage
        .save(identity.character_id, identity.world, row)
        .catch((error: unknown) => console.warn('The position cache write failed.', error))
    },
  })
  const unsubscribe_pose = subscribe_pose(() => {
    const pose = read_pose()
    if (!pose) return
    const state = get_state()
    if (state.fight.mode !== null) return // a fight takes the body out of the world
    const identity = selected_anchor(state)
    if (!identity) return
    writer.note(pose, identity.anchor)
  })

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
    if (world_changed && canvas) mount(canvas)
    else if (selection_changed || target_became_available) sync_target(state)
    if (selection_changed || state.session.characters !== previous.session.characters) sync_character(state)
    if (selection_changed || state.world.players !== previous.world.players) sync_presence(state)
  })
  signal.addEventListener('abort', () => {
    writer.flush()
    unsubscribe_pose()
    dispose_world()
  })
}

export default Object.freeze({ name: 'engine', reduce, observe }) satisfies AppModule
