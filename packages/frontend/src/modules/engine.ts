// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data, functional/prefer-immutable-types -- this module is the explicit lifecycle boundary for mutable engine and browser handles. */

import { parse_world_recipe, type EngineStatus, type EntityRender } from '@aresrpg/engine'
import { chain_to_client_coordinate } from '@aresrpg/immutable'

import type { create_world, WorldView } from '../game/core/world.ts'
import { character_render_source, load_character_appearance } from '../game/character_entities.ts'
import {
  browser_position_storage,
  chain_anchor_changed,
  create_owned_position_cache,
  resolve_world_boot_position,
} from '../game/core/position_store.ts'
import { read_pose, subscribe_pose } from '../game/core/pose_feed.ts'
import {
  read_owned_character_positions,
  subscribe_owned_character_positions,
} from '../game/core/owned_character_feed.ts'
import { publish_scene, submit_scene_entities, subscribe_scene } from '../game/core/scene_feed.ts'
import { create_presence_renderer } from '../game/presence_entities.ts'
import { create_resource_renderer } from '../game/resource_nodes.ts'
import { resolve_world_hover, type WorldHover } from '../game/core/player_pick.ts'
import { publish_self_tag } from '../game/core/nametag_feed.ts'
import { world_terrain } from '../content/worlds.ts'
import { content_catalog } from '../content/catalog.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'

import { engage_sword_markers, live_spawns, mob_group_id, resource_pack_id } from './world.ts'
import {
  selected_anchor,
  selected_character_in_dungeon,
  selected_checkpoint_position,
  selected_live_position,
  selected_position,
  selected_world,
  sync_dungeon_scene,
  world_presence_rows,
} from './engine_selection.ts'
import { sword_fights } from './world_engage.ts'
import { is_world_page, world_scene_active } from './navigation.ts'
import { run_to_target } from './run_to.ts'
import { selected_world_action_lock } from './world_gather.ts'

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

const observe = ({ events, dispatch, get_state, signal }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  let canvas: HTMLCanvasElement | null = null
  let world: ReturnType<typeof create_world> | null = null
  let presence: ReturnType<typeof create_presence_renderer> | null = null
  let spawns: Awaited<ReturnType<typeof create_spawns>> | null = null
  let resources: ReturnType<typeof create_resource_renderer> | null = null
  let unsubscribe_status: (() => void) | null = null
  let generation = 0
  let mounted_world_name: string | null | undefined
  let character_generation = 0
  let character_key: string | null = null
  let target_generation = 0
  const storage = browser_position_storage()

  const resolve_selected_position = async (state: AppState): Promise<Readonly<{ x: number; z: number }> | null> => {
    const live = state.session.link_status === 'ready' ? selected_live_position(state) : null
    const checkpoint = live ?? selected_checkpoint_position(state)
    if (!checkpoint) return null
    if (state.session.link_status !== 'ready') return checkpoint
    const identity = selected_anchor(state)
    if (!identity) return checkpoint
    try {
      return await resolve_world_boot_position({
        live,
        checkpoint,
        chain_anchor: identity.anchor,
        load: () => storage.load(identity.character_id, identity.world),
      })
    } catch (error) {
      console.error('The saved position could not be read — resuming at the checkpoint.', error)
      return checkpoint
    }
  }

  const sync_activity = (state: AppState): void => {
    if (!world) return
    world.set_active(world_scene_active(state.navigation.page, state.fight.mounted))
    world.set_interactive(
      is_world_page(state.navigation.page) && (!!state.session.wallet || state.navigation.guest_spectating)
    )
    world.set_action_lock(is_world_page(state.navigation.page) ? selected_world_action_lock(state) : null)
  }

  const sync_settings = (state: AppState): void => {
    if (!world) return
    world.set_quality(state.settings.quality, state.settings.render_distance)
    world.set_flattened(state.settings.flat_mode)
    world.set_footsteps_enabled(state.settings.footsteps_enabled !== false)
  }
  const sync_target = (state: AppState, checkpoint_only = false): void => {
    if (!world) return
    const position = checkpoint_only ? selected_checkpoint_position(state) : selected_position(state)
    if (!position) {
      world.release()
      sync_activity(get_state())
      return
    }
    const identity = selected_anchor(state)
    world.release()
    target_generation += 1
    const own_generation = target_generation
    const point = (resumed: Readonly<{ x: number; z: number }> | null): void => {
      if (signal.aborted || own_generation !== target_generation || !world) return
      world.point_at(resumed ?? position)
      sync_activity(get_state())
    }
    if (!identity || checkpoint_only) {
      point(null)
      return
    }
    void resolve_selected_position(state).then(point)
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

  // Players and zone mobs keep separate source lists; only their composition reaches the scene.
  let presence_entities: readonly EntityRender[] = Object.freeze([])
  let spawn_entities: readonly EntityRender[] = Object.freeze([])
  const submit_world_entities = (): void =>
    submit_scene_entities('world', Object.freeze([...presence_entities, ...spawn_entities]))

  const create_spawns = async (api: NonNullable<typeof world>) => {
    const { create_spawn_renderer } = await import('../game/spawn_entities.ts')
    return create_spawn_renderer({
      submit: (entities) => {
        spawn_entities = entities
        submit_world_entities()
      },
      ground_height: api.mob_ground_height,
      entity_height: api.entity_height,
      label: (group_id, element, position) => api.set_world_label(group_id, element, position),
    })
  }

  const create_resources = (api: NonNullable<typeof world>) =>
    create_resource_renderer({
      submit: api.set_resource_nodes,
      ground_height: api.ground_height,
      label: api.set_resource_node_label,
    })

  const sync_presence = (state: AppState): void => {
    const in_dungeon = selected_character_in_dungeon(state)
    const ground_height = (x: number, z: number): number =>
      world?.ground_height(chain_to_client_coordinate(x), chain_to_client_coordinate(z)) ?? 0
    presence?.update(
      in_dungeon ? Object.freeze({}) : world_presence_rows(state, ground_height),
      state.session.selected_character_id
    )
  }
  /** The tracked zones' live groups, minus what chain truth says is already taken. */
  const sync_spawns = (state: AppState): void => {
    if (!spawns) return
    const world_name = selected_world(state)
    const selected = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
    if (!world_name || selected?.dungeon_run) {
      spawns.update([])
      return
    }
    spawns.update(
      Object.keys(state.world.spawns).flatMap((key) =>
        key.startsWith(`${world_name}:`)
          ? live_spawns(state.world, key).mobs.map((group) => ({
              id: mob_group_id(key, state.world.zones[key]!.seed, group.index),
              x: chain_to_client_coordinate(group.x),
              z: chain_to_client_coordinate(group.z),
              members: group.members,
            }))
          : []
      )
    )
  }

  const sync_resources = (state: AppState): void => {
    if (!resources) return
    const world_name = selected_world(state)
    const selected = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
    const authored = world_name ? (content_catalog.world(world_name)?.resources ?? []) : []
    if (!world_name || selected?.dungeon_run) {
      resources.update([])
      return
    }
    resources.update(
      Object.keys(state.world.spawns).flatMap((key) =>
        key.startsWith(`${world_name}:`)
          ? live_spawns(state.world, key).resources.flatMap((pack) => {
              const row = authored.find(({ item_type }) => item_type === pack.item_type)
              return row
                ? [
                    {
                      id: resource_pack_id(key, state.world.zones[key]!.seed, pack.index),
                      x: chain_to_client_coordinate(pack.x),
                      z: chain_to_client_coordinate(pack.z),
                      item_type: pack.item_type,
                      job: row.job,
                      tier: row.tier,
                      nodes: pack.nodes,
                    },
                  ]
                : []
            })
          : []
      )
    )
  }

  /** The tracked zones' live fights as planted swords — kolizeum fights are arena-internal
   *  (nominal world) and never stand in a world's ground. */
  let sword_assets: Readonly<{ model_url: string; impact_sound_url: string }> | null = null
  const sync_fights = (state: AppState): void => {
    const api = world
    if (!api) return
    const world_name = selected_world(state)
    const selected = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
    const arm = (assets: Readonly<{ model_url: string; impact_sound_url: string }>): void => {
      sword_assets = assets
      const canonical = (selected?.dungeon_run ? [] : sword_fights(state.world.fights, world_name)).map((fight) => {
        const x = chain_to_client_coordinate(fight.x)
        const z = chain_to_client_coordinate(fight.z)
        return {
          id: fight.id,
          x,
          y: api.ground_height(x, z),
          z,
          placement_ms: Number(fight.placement_ms),
        }
      })
      const optimistic = engage_sword_markers(state.world).map((marker) => ({
        ...marker,
        y: api.ground_height(marker.x, marker.z),
      }))
      const markers = [...canonical, ...optimistic]
      api.set_fight_swords(assets.model_url, assets.impact_sound_url, markers)
    }
    if (sword_assets) arm(sword_assets)
    // Preload the shared sword on world mount. An engage press must animate immediately rather
    // than wait for the first fight to discover its model.
    else if (world_name)
      void Promise.all([import('../content/fight_models.ts'), import('../game/audio/fight_audio_registry.ts')])
        .then(async ([{ load_fight_sword_url }, { fight_audio_src }]) => {
          const model_url = await load_fight_sword_url()
          const impact_sound_url = fight_audio_src('sword_plant')
          return model_url && impact_sound_url ? Object.freeze({ model_url, impact_sound_url }) : null
        })
        .then((assets) => {
          if (!assets || world !== api) return
          sword_assets = assets
          sync_fights(get_state())
        })
  }

  // the OWN companion — the SAME loader and shape the demo lab uses (one code path, owner
  // 2026-08-21); it follows the equipped pet slot of the selected character
  let pet_key: string | null = null
  let pet_generation = 0
  const sync_pet = (state: AppState): void => {
    if (!world) return
    const selected = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
    const pet_type = selected?.equipment.find(({ slot }) => slot === 'pet')?.item_type ?? null
    if (pet_type === pet_key) return
    pet_key = pet_type
    pet_generation += 1
    const own_generation = pet_generation
    if (!pet_type) {
      world.set_pet(null)
      return
    }
    void import('../content/pet_models.ts')
      .then(({ load_pet_companion }) => load_pet_companion('own_pet', pet_type))
      .then(
        (companion) => {
          if (signal.aborted || own_generation !== pet_generation || !world) return
          world.set_pet(companion)
        },
        (error: unknown) => {
          if (own_generation !== pet_generation || !world) return
          console.error(`The companion ${pet_type} failed to load.`, error)
          world.set_pet(null)
        }
      )
  }

  const sync = (state: AppState, initial_position?: Readonly<{ x: number; z: number }>): void => {
    sync_settings(state)
    sync_character(state)
    sync_presence(state)
    sync_spawns(state)
    sync_resources(state)
    sync_dungeon_scene(world, state)
    sync_pet(state)
    sync_fights(state)
    world?.set_run_target(run_to_target(state))
    // The published demo's target is its known origin. The player app must likewise resolve
    // its real first target before workers receive a batch, rather than mesh origin then cancel.
    if (initial_position) {
      world?.point_at(initial_position)
      sync_activity(state)
    } else sync_target(state)
  }

  const dispose_world = (): void => {
    generation += 1
    character_generation += 1
    character_key = null
    pet_key = null
    publish_scene(null)
    presence?.dispose()
    spawns?.dispose()
    resources?.dispose()
    presence = null
    spawns = null
    resources = null
    // both halves of the composed list go with the world that held them, or the next world's
    // first submit would concat a dead crowd behind its own
    presence_entities = Object.freeze([])
    spawn_entities = Object.freeze([])
    unsubscribe_status?.()
    unsubscribe_status = null
    world?.dispose()
    world = null
    mounted_world_name = undefined
    // a torn-down world takes its crown labels with it — the feed must not keep a ghost self tag
    self_tag_on = false
    publish_self_tag(null)
    if (import.meta.env.DEV) visual_global.__ares_visual__ = undefined
  }

  const self_tag_element = typeof document === 'undefined' ? null : document.createElement('div')
  let self_tag_on = false
  const set_self_tag = (focused: boolean): void => {
    if (focused === self_tag_on) return
    const character_id = get_state().session.selected_character_id
    if (!character_id) return
    self_tag_on = focused
    world?.set_entity_label(character_id, focused ? self_tag_element : null)
    publish_self_tag(focused ? self_tag_element : null)
  }
  const hover_under_cursor = (event: MouseEvent): WorldHover | null => {
    const view = world?.camera_frame()
    const own = read_pose()
    if (!world || !view || !own || !canvas || world.mode() !== 'follow') return null
    const rect = canvas.getBoundingClientRect()
    return resolve_world_hover({
      view,
      width: rect.width,
      height: rect.height,
      cursor_x: event.clientX - rect.left,
      cursor_y: event.clientY - rect.top,
      own,
      candidates: presence?.positions() ?? [],
    })
  }

  const on_mouse_move = (event: MouseEvent): void => {
    if (!self_tag_element) return
    set_self_tag(hover_under_cursor(event)?.self ?? false)
  }

  // right-click on a nearby BODY opens the player context menu; anywhere else keeps the
  // camera's right-drag untouched
  const on_context_menu = (event: MouseEvent): void => {
    event.preventDefault()
    const hover = hover_under_cursor(event)
    if (!hover?.target) return
    dispatch({
      type: 'world/player_menu',
      menu: { character_id: hover.target, x: event.clientX, y: event.clientY, source: 'body' },
    })
  }

  const mount = (next_canvas: HTMLCanvasElement): void => {
    const world_name = selected_world(get_state())
    if (canvas === next_canvas && world && mounted_world_name === world_name) return
    dispose_world()
    canvas?.removeEventListener('contextmenu', on_context_menu)
    canvas?.removeEventListener('mousemove', on_mouse_move)
    set_self_tag(false)
    canvas = next_canvas
    next_canvas.addEventListener('contextmenu', on_context_menu)
    next_canvas.addEventListener('mousemove', on_mouse_move)
    mounted_world_name = world_name
    const boot_character_id = get_state().session.selected_character_id
    const boot_position = resolve_selected_position(get_state())
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
    const world_content = content_catalog.world(world_name ?? '')
    const world_mobs = [
      ...(world_content?.mobs ?? []),
      ...(world_content?.cities.flatMap(
        ({ dungeon }) => content_catalog.dungeon(dungeon)?.rooms.flatMap((room) => room) ?? []
      ) ?? []),
    ]
    void import('../game/mob_entities.ts').then(({ preload_world_mobs }) => preload_world_mobs(world_mobs))
    const own_generation = generation
    void Promise.all([import('../game/core/world.ts'), boot_position])
      .then(([{ create_world: create }, initial_position]) => {
        if (signal.aborted || canvas !== next_canvas || generation !== own_generation) return
        if (get_state().session.selected_character_id !== boot_character_id) {
          mount(next_canvas)
          return
        }
        const created = create({
          canvas: next_canvas,
          world: parse_world_recipe(terrain),
          quality: get_state().settings.quality,
          initial_focus: initial_position ? [initial_position.x, initial_position.z] : [0, 0],
          on_travel: () => dispatch({ type: 'dialog/open', dialog: 'travel' }),
          on_run_stopped: (reason) =>
            dispatch({ type: 'run_to/stopped', reason, restore_flat: get_state().run_to.restore_flat }),
        })
        world = created
        // Publish the running scene; the fight board mounts here, never in a second engine.
        publish_scene(created)
        presence = create_presence_renderer({
          // Presence holds its list only outside fights; a fight board shows fighters alone.
          submit: (entities) => {
            presence_entities = entities
            submit_world_entities()
          },
          entity_height: created.entity_height,
          pet_ground_height: created.pet_ground_height,
          label: (character_id, element) => created.set_entity_label(character_id, element),
        })
        // the spawn lane stays DYNAMIC for the same reason fight_models and pet_models do: it
        // reaches content/mob_models.ts, whose import.meta.glob is a build-only door — a static
        // edge here drags Vite's glob into every consumer of the store, tests included
        void create_spawns(created).then((renderer) => {
          if (signal.aborted || world !== created) {
            renderer.dispose()
            return
          }
          spawns = renderer
          sync_spawns(get_state())
        })
        resources = create_resources(created)
        unsubscribe_status = created.subscribe_status((status) => dispatch({ type: 'engine/status', status }))
        sync(get_state(), initial_position ?? undefined)
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
  const position_cache = create_owned_position_cache({ storage, on_error: console.warn })
  const persist_owned_positions = (state: AppState): void =>
    position_cache.note_all(state.session.characters, Object.values(read_owned_character_positions()))
  const unsubscribe_scene = subscribe_scene(() => {
    sync_presence(get_state())
    sync_spawns(get_state())
    sync_resources(get_state())
    sync_dungeon_scene(world, get_state())
  })
  const unsubscribe_owned_positions = subscribe_owned_character_positions(() => {
    const state = get_state()
    persist_owned_positions(state)
    sync_presence(state)
  })
  const unsubscribe_pose = subscribe_pose(() => {
    const state = get_state()
    spawns?.refresh()
    sync_resources(state)
  })
  events.on('engine/canvas_attached', ({ canvas: next_canvas }) => mount(next_canvas))
  events.on('engine/canvas_detached', ({ canvas: previous_canvas }) => {
    if (canvas !== previous_canvas) return
    previous_canvas.removeEventListener('contextmenu', on_context_menu)
    previous_canvas.removeEventListener('mousemove', on_mouse_move)
    set_self_tag(false)
    canvas = null
    dispose_world()
  })
  const sync_position_cache = (state: AppState, previous: AppState): void => {
    if (state.session.link_status === 'ready' && previous.session.link_status !== 'ready')
      return void position_cache.restore(state.session.characters)
    if (state.session.link_status === 'ready' || previous.session.link_status !== 'ready') return
    position_cache.invalidate(state.session.characters)
    sync_target(state, true)
  }
  const sync_run_to = (state: AppState, previous: AppState): void => {
    if (state.run_to.run !== previous.run_to.run) world?.set_run_target(run_to_target(state))
  }
  events.on('STATE_UPDATED', (state, previous) => {
    sync_activity(state)
    sync_position_cache(state, previous)
    sync_run_to(state, previous)
    if (state.settings !== previous.settings) sync_settings(state)
    const selection_changed = state.session.selected_character_id !== previous.session.selected_character_id
    const target_became_available = selected_position(previous) === null && selected_position(state) !== null
    const target_anchor_changed = chain_anchor_changed(
      selected_anchor(previous)?.anchor ?? null,
      selected_anchor(state)?.anchor ?? null
    )
    const world_changed = selected_world(state) !== selected_world(previous)
    if (world_changed && canvas) mount(canvas)
    else if (selection_changed || target_became_available || target_anchor_changed) sync_target(state)
    if (selection_changed || state.session.characters !== previous.session.characters) {
      sync_character(state)
      sync_pet(state)
      sync_presence(state)
      sync_spawns(state)
      sync_resources(state)
      sync_dungeon_scene(world, state)
      sync_fights(state)
    }
    if (selection_changed || state.world.players !== previous.world.players) sync_presence(state)
    if (
      selection_changed ||
      state.world.spawns !== previous.world.spawns ||
      state.world.zones !== previous.world.zones ||
      state.world.pending_engages !== previous.world.pending_engages
    )
      sync_spawns(state)
    if (selection_changed || state.world.spawns !== previous.world.spawns || state.world.zones !== previous.world.zones)
      sync_resources(state)
    if (selection_changed || state.world.spawns !== previous.world.spawns) sync_dungeon_scene(world, state)
    if (state.world.fights !== previous.world.fights || state.world.pending_engages !== previous.world.pending_engages)
      sync_fights(state)
  })
  signal.addEventListener('abort', () => {
    position_cache.flush()
    unsubscribe_pose()
    unsubscribe_owned_positions()
    unsubscribe_scene()
    dispose_world()
  })
}

export default Object.freeze({ name: 'engine', reduce, observe }) satisfies AppModule
