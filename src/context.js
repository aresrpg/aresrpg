import { EventEmitter, on } from 'events'
import { PassThrough } from 'stream'

import { aiter } from 'iterator-helper'
import combineAsyncIterators from 'combine-async-iterators'

import { last_event_value, PlayerEvent } from './events.js'
import { floor1 } from './world.js'
import logger from './logger.js'
import player_login from './player/login.js'
import player_experience, {
  register as register_experience,
} from './player/experience.js'
import player_attributes from './player/attributes.js'
import player_health from './player/health.js'
import player_fall_damage from './player/fall_damage.js'
import player_position from './player/position.js'
import player_view_distance, { inside_view } from './player/view_distance.js'
import player_chat from './player/chat.js'
import player_resource_pack from './player/resource_pack.js'
import player_statistics from './player/statistics.js'
import player_held_item from './player/held_item.js'
import player_gamemode from './player/gamemode.js'
import player_scoreboard from './player/scoreboard.js'
import player_block_place from './player/block_placement.js'
import player_respawn from './player/respawn.js'
import player_bossbar from './player/boss_bar.js'
import player_action_bar from './player/action_bar.js'
import player_heartbeat from './player/heartbeat.js'
import player_bells from './player/bells.js'
import player_traders, {
  register as register_player_traders,
} from './player/traders.js'
import player_deal_damage, {
  register as register_player_deal_damage,
} from './player/damage.js'
import player_inventory from './player/inventory.js'
import player_teleportation_stones, {
  register as register_player_teleportation_stones,
} from './player/teleportation_stones.js'
import player_tablist from './player/tablist.js'
import player_sync from './player/sync.js'
import player_item_loot, {
  register as register_player_item_loot,
  ITEM_LOOT_MAX_COUNT,
} from './player/item_loot.js'
import player_class_selection from './player/class_selection.js'
import player_soul from './player/soul.js'
import finalization from './finalization.js'
import plugin_channels from './plugin_channels.js'
import chunk_update from './chunk/update.js'
import { register as register_mobs } from './mobs.js'
import mobs_dialog from './mobs/dialog.js'
import { register as register_mobs_position } from './mobs/position.js'
import mobs_spawn from './mobs/spawn.js'
import mobs_movements from './mobs/movements.js'
import mobs_damage from './mobs/damage.js'
import mobs_goto from './mobs/goto.js'
import mobs_target from './mobs/target.js'
import mobs_look_at from './mobs/look_at.js'
import mobs_wakeup from './mobs/wakeup.js'
import mobs_loot from './mobs/loot.js'
import mobs_attack from './mobs/attack.js'
import mobs_sound from './mobs/sound.js'
import commands_declare from './commands/declare.js'
import { abortable } from './iterator.js'
import Database from './database.js'
import { USE_RESSOURCE_PACK } from './settings.js'
import { GameMode } from './gamemode.js'

const log = logger(import.meta)

const initial_world = {
  ...floor1,
  // this eventEmitter is there to init typings
  // but it is replaced while creating a new server in server.js
  /** @type {NodeJS.EventEmitter} */
  events: new EventEmitter(),
  next_entity_id: 1,
  next_window_id: 1, // 0 is the player inventory
  /** @type {() => Object} Remove type to remove circular references */
  get: () => world,
  screens: {},
}

const world_reducers = [
  // Reducers that augment the world with extra properties
  register_mobs,
  register_mobs_position,
  register_player_traders,
  register_player_deal_damage,
  register_experience,
  register_player_teleportation_stones,
  register_player_item_loot,
]

export const world = /** @type {World} */ (
  world_reducers.reduce(
    (world, fn) => fn(world),
    /** @type {any} */ (initial_world)
  )
)

const initial_state = {
  nickname: undefined,
  position: floor1.spawn_position,
  teleport: null,
  view_distance: 0,
  inventory: Array.from({
    length: 46,
  }),
  looted_items: {
    pool: Array.from({ length: ITEM_LOOT_MAX_COUNT }),
    cursor: 0,
  },
  inventory_sequence_number: 0,
  inventory_cursor: null,
  inventory_cursor_index: 0,
  held_slot_index: 0,
  game_mode: GameMode.ADVENTURE,
  class_selection_open: false,
  selected_class: 0,
  experience: 0,
  health: 40,
  // player's energy, losing after each death
  soul: 100,
  // player's money
  kares: 0,
  // last time the player joined,
  // can be used for example to calcule regenerated soul while offline
  last_connection_time: undefined,
  last_disconnection_time: undefined,
}

// Add here all fields that you want to save in the database
const saved_state = ({
  nickname,
  position,
  inventory,
  held_slot_index,
  game_mode,
  experience,
  health,
  soul,
  last_disconnection_time,
  selected_class,
}) => ({
  nickname,
  position,
  inventory,
  held_slot_index,
  game_mode,
  experience,
  health,
  soul,
  last_disconnection_time,
  selected_class,
})

/** @template U
 ** @typedef {import('./types').UnionToIntersection<U>} UnionToIntersection */

/** @template U
 ** @typedef {import('./types').Await<U>} Await */

/** @typedef {Readonly<typeof initial_world>} InitialWorld */
/** @typedef {Readonly<ReturnType<typeof register_mobs>>} InitialWorldWithMobs */
/** @typedef {ReturnType<typeof world_reducers[number]>} WorldReducers */
/** @typedef {Readonly<UnionToIntersection<WorldReducers>>} ReducedWorld */
/** @typedef {InitialWorld & ReducedWorld} World */

/** @typedef {Readonly<typeof initial_state>} State */
/** @typedef {{ type: string, payload: any }} Action */
/** @typedef {Readonly<Await<ReturnType<typeof create_context>>>} Context */

/** @typedef {(state: State, action: Action) => State} Reducer */
/** @typedef {(action: Action) => Action} Transformer */
/** @typedef {(context: Context) => void} Observer */

/** @type Reducer */
function reduce_state(state, action) {
  return [
    /* Reducers that map the incomming actions (packet, ...)
     * to a new state */
    player_position.reduce,
    player_view_distance.reduce,
    plugin_channels.reduce,
    player_deal_damage.reduce,
    player_inventory.reduce,
    player_gamemode.reduce,
    player_held_item.reduce,
    player_item_loot.reduce,
    player_soul.reduce,
    player_health.reduce,
    player_experience.reduce,
    player_class_selection.reduce,
    chunk_update.reduce,
  ].reduce((intermediate, fn) => fn(intermediate, action), state)
}

/** @type Transformer */
function transform_action(action) {
  return [
    /* Map functions that are applied to all actions */
    plugin_channels.transform,
  ].reduce((intermediate, fn) => fn(intermediate), action)
}

export function observe_client({ mobs_position }) {
  /** @type Observer */
  return async context => {
    /* Observers that handle the protocol part.
     * They get the client and should map it to minecraft protocol */

    finalization.observe(context)

    if (USE_RESSOURCE_PACK) await player_resource_pack.observe(context)

    // login has to stay on top
    player_login.observe(context)

    player_attributes.observe(context)
    player_experience.observe(context)
    player_traders.observe(context)
    player_statistics.observe(context)
    player_fall_damage.observe(context)
    player_health.observe(context)
    player_attributes.observe(context)
    player_chat.observe(context)
    player_deal_damage.observe(context)
    player_inventory.observe(context)
    player_teleportation_stones.observe(context)
    player_tablist.observe(context)
    player_sync.observe(context)
    player_action_bar.observe(context)
    player_scoreboard.observe(context)
    player_block_place.observe(context)
    player_item_loot.observe(context)
    player_soul.observe(context)
    player_bossbar.observe(context)
    player_respawn.observe(context)
    player_heartbeat.observe(context)
    player_bells.observe(context)
    player_class_selection.observe(context)

    commands_declare.observe(context)

    mobs_position.observe(context)
    mobs_spawn.observe(context)
    mobs_movements.observe(context)
    mobs_goto.observe(context)
    mobs_dialog.observe(context)
    mobs_damage.observe(context)
    mobs_target.observe(context)
    mobs_look_at.observe(context)
    mobs_wakeup.observe(context)
    mobs_loot.observe(context)
    mobs_attack.observe(context)
    mobs_sound.observe(context)

    chunk_update.observe(context)
  }
}

/**
 * The following code handle the pipeline, it works as described below
 *
 * state = initial_state
 * on packets + on actions
 *   |> transform_action
 *   |> (state = reduce_state(state))
 *
 */
export async function create_context({ client, world }) {
  log.info(
    {
      username: client.username,
      uuid: client.uuid,
      id: client.id,
    },
    'Client connected'
  )

  const controller = new AbortController()
  const actions = new PassThrough({
    objectMode: true,
    signal: controller.signal,
  })

  client.once('end', () => {
    log.info(
      { username: client.username, uuid: client.uuid },
      'Client disconnected'
    )

    actions.end()
    controller.abort()
  })

  client.on('error', error => log.error(error, 'Client error'))

  const packets = aiter(
    on(client, 'packet', { signal: controller.signal })
  ).map(([payload, { name }]) => ({
    type: `packet/${name}`,
    payload,
  }))

  const save_state = state => {
    log.info(
      { username: client.username, uuid: client.uuid },
      'Saving to database'
    )
    Database.push({
      key: client.uuid.toLowerCase(),
      value: saved_state(state),
    })
  }

  /** @type {NodeJS.EventEmitter} */
  const events = new EventEmitter()
  const player_state = await Database.pull(client.uuid.toLowerCase())

  aiter(
    abortable(combineAsyncIterators(actions[Symbol.asyncIterator](), packets))
  )
    .map(transform_action)
    .reduce(
      (last_state, action) => {
        const state = reduce_state(last_state, action)
        events.emit(PlayerEvent.STATE_UPDATED, state)
        return state
      },
      // default nickname is the client username, and is overriden by the loaded player state
      {
        ...initial_state,
        nickname: client.username,
        ...player_state,
        last_connection_time: Date.now(),
      }
    )
    .then(state => ({
      ...state,
      last_disconnection_time: Date.now(),
    }))
    .then(save_state)
    .catch(error => {
      // TODO: what to do here if we can't save the client ?
      log.error(error, 'State error')
    })

  const get_state = last_event_value(events, PlayerEvent.STATE_UPDATED)

  return {
    client,
    world,
    events,
    signal: controller.signal,
    get_state,
    inside_view: inside_view(get_state),
    dispatch(type, payload) {
      actions.write({ type, payload })
    },
  }
}
