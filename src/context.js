import { EventEmitter, on } from 'events'
import { PassThrough } from 'stream'

import { aiter } from 'iterator-helper'
import combineAsyncIterators from 'combine-async-iterators'

import items from '../data/items.json' assert { type: 'json' }

import { last_event_value } from './events.js'
import { floor1 } from './world.js'
import logger from './logger.js'
import player_login from './player/login.js'
import player_experience, {
  register as register_player_experience,
} from './player/experience.js'
import player_attributes from './player/attributes.js'
import player_health from './player/health.js'
import player_fall_damage from './player/fall_damage.js'
import player_position from './player/position.js'
import player_view_distance from './player/view_distance.js'
import player_chat from './player/chat.js'
import player_resource_pack from './player/resource_pack.js'
import player_statistics from './player/statistics.js'
import player_spell from './player/spell.js'
import player_gamemode from './player/gamemode.js'
import player_block_place from './player/block_placement.js'
import player_respawn from './player/respawn.js'
import player_heartbeat from './player/heartbeat.js'
import player_bells from './player/bells.js'
import player_environmental_damage from './player/environmental_damage.js'
import player_settings from './player/settings.js'
import player_ui from './player/ui.js'
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
import { USE_RESOURCE_PACK } from './settings.js'
import { GameMode } from './gamemode.js'
import { inside_view } from './view_distance.js'
import { generate_item } from './items.js'

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
  register_player_experience,
  register_player_teleportation_stones,
]

export const world = /** @type {World} */ (
  world_reducers.reduce(
    (world, fn) => fn(world),
    /** @type {any} */ (initial_world),
  )
)

const initial_state = {
  position: floor1.spawn_position,
  teleport: null,
  view_distance: 0,
  inventory: {
    head: null,
    neck: null,
    chest: null,
    rings: Array.from({ length: 2 }),
    belt: null,
    legs: null,
    feet: null,
    pet: null,
    weapon: generate_item(items.default_axe),
    // off hand
    consumable: null,
    relics: Array.from({ length: 6 }),
    crafting_output: null,
    crafting_input: Array.from({ length: 4 }),
    main_inventory: Array.from({
      length: 27,
      10: generate_item(items.default_helmet),
      11: generate_item(items.default_boots),
      12: generate_item(items.default_ring),
    }),
  },
  inventory_sequence_number: 0,
  inventory_cursor: null,
  inventory_cursor_index: 0,
  game_mode: GameMode.ADVENTURE,
  experience: 0,
  health: 25,
  // player's energy, losing after each death
  soul: 100,
  // player's money
  kares: 0,
  // represents the base stats increased by the player
  // (not equipments bonuses)
  characteristics: {
    vitality: 0,
    mind: 0,
    strength: 0,
    intelligence: 0,
    chance: 0,
    agility: 0,
  },
  // last time the player joined,
  // can be used for example to calcule regenerated soul while offline
  last_connection_time: undefined,
  last_disconnection_time: undefined,
  // variables handling the user interface
  user_interface: {
    // using a IO call to fetch the player head texture
    head_texture: undefined,
    // we should fetch again when the cache is expired (/login.js)
    head_texture_expiration: -1,
  },
  settings: {
    // top left ui offset
    // depending on the player screen size, he may want to adjust this position of the UI
    top_left_ui_offset: -350,
  },
  selected_spell: 0,
  spells: Array.from({
    length: 8,
    0: {
      name: 'test',
      couldown: 8000,
      // storing the last cast time because we need to be able to display the reloading UI
      // at any moment from the state only (no reducers)
      cast_time: 0,
    },
    // 1: {
    //   name: 'test',
    //   couldown: 5000,
    //   // storing the last cast time because we need to be able to display the reloading UI
    //   // at any moment from the state only (no reducers)
    //   cast_time: 0,
    // },
  }),
}

// Add here all fields that you want to save in the database
const saved_state = ({
  position,
  inventory,
  selected_spell,
  game_mode,
  experience,
  health,
  soul,
  kares,
  characteristics,
  last_connection_time,
  last_disconnection_time,
  user_interface,
  settings,
}) => ({
  position,
  inventory,
  selected_spell,
  game_mode,
  experience,
  health,
  soul,
  kares,
  characteristics,
  last_connection_time,
  last_disconnection_time,
  user_interface,
  settings,
})

/** @template U
 * @typedef {import('./types').UnionToIntersection<U>} UnionToIntersection */

/** @typedef {import('minecraft-protocol').Client} Client */

/** @template U
 * @typedef {import('./types').Await<U>} Await */

/** @typedef {Readonly<typeof initial_world>} InitialWorld */
/** @typedef {Readonly<ReturnType<typeof register_mobs>>} InitialWorldWithMobs */
/** @typedef {ReturnType<typeof world_reducers[number]>} WorldReducers */
/** @typedef {Readonly<UnionToIntersection<WorldReducers>>} ReducedWorld */
/** @typedef {InitialWorld & ReducedWorld} World */

/** @typedef {Readonly<typeof initial_state>} State */
/** @typedef {import('./types').PlayerAction} Action */
/** @typedef {Readonly<Await<ReturnType<typeof create_context>>>} Context */

/** @typedef {(state: State, action: Action, client: Client) => State} Reducer */
/** @typedef {(action: Action) => Action} Transformer */
/** @typedef {(context: Context) => void} Observer */

/** @type {Reducer} */
function reduce_state(state, action, client) {
  return [
    /**
     * Reducers that map the incomming actions (packet, ...)
     * to a new state */
    player_position.reduce,
    player_view_distance.reduce,
    plugin_channels.reduce,
    player_inventory.reduce,
    player_gamemode.reduce,
    player_soul.reduce,
    player_health.reduce,
    player_experience.reduce,
    player_login.reduce,
    player_settings.reduce,
    player_spell.reduce,
    chunk_update.reduce,
  ].reduce((intermediate, fn) => fn(intermediate, action, client), state)
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
      They get the client and should map it to minecraft protocol */

    finalization.observe(context)

    if (USE_RESOURCE_PACK) player_resource_pack.observe(context)

    // login has to stay on top
    player_login.observe(context)

    player_attributes.observe(context)
    player_experience.observe(context)
    player_traders.observe(context)
    player_statistics.observe(context)
    player_fall_damage.observe(context)
    player_health.observe(context)
    player_chat.observe(context)
    player_deal_damage.observe(context)
    player_inventory.observe(context)
    player_teleportation_stones.observe(context)
    player_tablist.observe(context)
    player_sync.observe(context)
    player_spell.observe(context)
    player_block_place.observe(context)
    player_soul.observe(context)
    player_ui.observe(context)
    player_respawn.observe(context)
    player_heartbeat.observe(context)
    player_bells.observe(context)
    player_position.observe(context)
    player_environmental_damage.observe(context)

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
 * @param {{client:Client, world: World}} options.client
 */
export async function create_context({ client, world }) {
  log.info(
    {
      username: client.username,
      uuid: client.uuid,
      id: client.id,
    },
    'Client connected',
  )

  const controller = new AbortController()
  const actions = new PassThrough({
    objectMode: true,
    signal: controller.signal,
  })

  client.once('end', () => {
    log.info(
      { username: client.username, uuid: client.uuid },
      'Client disconnected',
    )

    actions.end()
    controller.abort()
  })

  client.on('error', error => {
    if (error.message !== 'This socket has been ended by the other party')
      log.error(error, 'Client error')
  })

  const packets = aiter(
    on(client, 'packet', { signal: controller.signal }),
  ).map(([payload, { name }]) => ({
    type: `packet/${name}`,
    payload,
  }))

  const save_state = state => {
    log.info(
      { username: client.username, uuid: client.uuid },
      'Saving to database',
    )
    Database.push({
      key: client.uuid.toLowerCase(),
      value: saved_state(state),
    })
  }

  /** @type {import('./types').PlayerEvents} */
  const events = new EventEmitter()
  const player_state = await Database.pull(client.uuid.toLowerCase())

  aiter(
    abortable(combineAsyncIterators(actions[Symbol.asyncIterator](), packets)),
  )
    .map(transform_action)
    .reduce(
      (last_state, action) => {
        const state = reduce_state(last_state, action, client)
        events.emit('STATE_UPDATED', state)
        return state
      },
      {
        ...initial_state,
        ...player_state,
        last_connection_time: Date.now(),
      },
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

  /** @type {() => State} */
  const get_state = last_event_value(events, 'STATE_UPDATED')

  return {
    client,
    world,
    events,
    signal: controller.signal,
    get_state,
    inside_view: inside_view(get_state),
    /**
     * @template {keyof import('./types').PlayerActions} K
     * @param {K} type
     * @param {import('./types').PlayerActions[K]} [payload] */
    dispatch(type, payload) {
      actions.write({ type, payload })
    },
  }
}
