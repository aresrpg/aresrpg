import { EventEmitter, on } from 'events'
import { PassThrough } from 'stream'

import { aiter } from 'iterator-helper'
import combineAsyncIterators from 'combine-async-iterators'

import { last_event_value } from './events.js'
import { floor1 } from './world.js'
import player_screen, { register_screen } from './player/screen.js'
import logger from './logger.js'
import player_login from './player/login.js'
import player_experience from './player/experience.js'
import player_attributes from './player/attributes.js'
import player_health from './player/health.js'
import player_fall_damage from './player/fall_damage.js'
import player_position from './player/position.js'
import player_view_distance, { inside_view } from './player/view_distance.js'
import player_chat from './player/chat.js'
import player_resource_pack from './player/resource_pack.js'
import player_statistics from './player/statistics.js'
import player_held_item from './player/held_item.js'
import player_traders, {
  register as register_player_traders,
} from './player/traders.js'
import player_deal_damage, {
  DAMAGE_INDICATORS_AMMOUNT,
  register as register_player_deal_damage,
} from './player/deal_damage.js'
import player_inventory from './player/inventory.js'
import player_teleportation_stones, {
  register as register_player_teleportation_stones,
} from './player/teleportation_stones.js'
import player_tablist from './player/tablist.js'
import player_sync from './player/sync.js'
import finalization from './finalization.js'
import plugin_channels from './plugin_channels.js'
import chunk_update from './chunk/update.js'
import { register as register_mobs } from './mobs.js'
import mobs_dialog from './mobs/dialog.js'
import mobs_position_factory, {
  register as register_mobs_position,
} from './mobs/position.js'
import mobs_spawn from './mobs/spawn.js'
import mobs_movements from './mobs/movements.js'
import mobs_damage from './mobs/damage.js'
import mobs_goto from './mobs/goto.js'
import mobs_target from './mobs/target.js'
import mobs_look_at from './mobs/look_at.js'
import mobs_wakeup from './mobs/wakeup.js'
import commands_declare from './commands/declare.js'
import start_debug_server from './debug.js'
import observe_performance from './performance.js'
import { abortable } from './iterator.js'
import Database from './database.js'

const log = logger(import.meta)

export const PLAYER_ENTITY_ID = 0
export const PLAYER_INVENTORY_ID = 0
export const SERVER_UUID = '00000000000000000000000000000000'

const initial_world = {
  ...floor1,
  /** @type {NodeJS.EventEmitter} */
  events: new EventEmitter(),
  next_entity_id: 1,
  next_window_id: 1, // 0 is the player inventory
  /** @type {() => Object} Remove type to remove circular references */
  get: () => world,
}

const world_reducers = [
  // Reducers that augment the world with extra properties
  register_mobs,
  register_mobs_position,
  register_player_traders,
  register_player_deal_damage,
  register_screen({
    id: 'player_screen',
    size: { width: 8, height: 4 },
  }),
  register_player_teleportation_stones,
]

/** @type {World} */
const world = world_reducers.reduce((world, fn) => fn(world), initial_world)

const initial_state = {
  position: world.spawn_position,
  teleport: null,
  view_distance: 0,
  inventory: Array.from({
    length: 46,
    36: { type: 'spellbook', count: 1 },
    37: { type: 'bronze_coin', count: 10 },
    38: { type: 'menitrass_100', count: 1 },
  }),
  damage_indicators: {
    pool: Array.from({ length: DAMAGE_INDICATORS_AMMOUNT }),
    cursor: -1,
  },
  inventory_sequence_number: 0,
  inventory_cursor: null,
  inventory_cursor_index: 0,
  /** @type {0|1|2|3|4|5|6|7|8} */
  held_slot_index: 0,
  game_mode: 2,
  experience: 0,
  health: 40,
}

// Add here all fields that you want to save in the database
const saved_state = ({
  position,
  inventory,
  game_mode,
  experience,
  health,
  held_slot_index,
}) => ({
  position,
  inventory,
  game_mode,
  experience,
  health,
  held_slot_index,
})

/** @template U
 ** @typedef {import('./types').UnionToIntersection<U>} UnionToIntersection */

/** @template U
 ** @typedef {import('./types').Await<U>} Await */

/** @typedef {Readonly<typeof initial_world>} InitialWorld */
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
    player_fall_damage.reduce,
    player_deal_damage.reduce,
    player_inventory.reduce,
    player_held_item.reduce,
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

const mobs_position = mobs_position_factory(world)

/** @type Observer */
export async function observe_client(context) {
  /* Observers that handle the protocol part.
   * They get the client and should map it to minecraft protocol */

  finalization.observe(context)

  await player_resource_pack.observe(context)

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
  player_screen.observe(context)
  player_deal_damage.observe(context)
  player_inventory.observe(context)
  player_teleportation_stones.observe(context)
  player_tablist.observe(context)
  player_sync.observe(context)

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

  chunk_update.observe(context)
}

/**
 * The following code handle the pipeline, it works as following
 *
 * state = initial_state
 * on packets + on actions
 *   |> transform_action
 *   |> (state = reduce_state(state))
 *
 * @param {import('minecraft-protocol').Client} client
 */
export async function create_context(client) {
  log.info(
    {
      username: client.username,
      uuid: client.uuid,
      id: client.id,
    },
    'Client connected'
  )

  const controller = new AbortController()
  const actions = new PassThrough({ objectMode: true })

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
    abortable(on(client, 'packet', { signal: controller.signal }))
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

  aiter(combineAsyncIterators(actions[Symbol.asyncIterator](), packets))
    .map(transform_action)
    .reduce(
      (last_state, action) => {
        const state = reduce_state(last_state, action)
        events.emit('state', state)
        return state
      },
      { ...initial_state, ...player_state }
    )
    .then(save_state)
    .catch(error => {
      // TODO: what to do here if we can't save the client ?
      log.error(error, 'State error')
    })

  const get_state = last_event_value(events, 'state')

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

observe_performance()
export const debug = start_debug_server({ world })
