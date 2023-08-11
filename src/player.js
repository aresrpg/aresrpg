import { EventEmitter, on } from 'events'
import { PassThrough } from 'stream'

import { aiter, iter } from 'iterator-helper'
import combineAsyncIterators from 'combine-async-iterators'
import { pino } from 'pino'

import items from '../data/items.json' assert { type: 'json' }

import { last_event_value } from './core/events.js'
import Database from './database.js'
import { generate_item } from './core/items.js'
import logger from './logger.js'
import plugin_channels from './core/plugin_channels.js'
import player_modules from './modules/player_modules.js'
import { inside_view } from './core/view_distance.js'
import { GameMode } from './core/gamemode.js'
import { abortable, unfazed } from './core/iterator.js'
import { Worlds } from './world.js'

const log = logger(import.meta)

/** @typedef {import('minecraft-protocol').Client} Client */

/** @typedef {Readonly<typeof initial_state>} State */
/** @typedef {import('./types').PlayerAction} Action */
/** @typedef {Omit<Readonly<ReturnType<typeof create_context>>, 'actions' | 'controller'>} Context */

/** @typedef {(state: State, action: Action, client: Client) => State} Reducer */
/** @typedef {(action: Action) => Action} Transformer */
/** @typedef {Record<import("./types").GameState, import("./server").Module[]>} Observables */
/** @typedef {(context: Context, observables?: Observables) => void} Observer */

const initial_state = {
  position: Worlds.floor1.spawn_position,
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
  /** @type {import('./types').GameState} */
  game_state: 'GAME:ALIVE',
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

/** @type Transformer */
function transform_action(action) {
  return [
    /* Map functions that are applied to all actions */
    plugin_channels.transform,
  ].reduce((intermediate, fn) => fn(intermediate), action)
}

/**
 * @param {Object} options
 * @param {Client} options.client
 * @param {import("./server").World} options.world
 */
function create_context({ client, world }) {
  /** @type {import('./types').PlayerEvents} */
  const events = new EventEmitter()
  const controller = new AbortController()
  /** @type {() => State} */
  const get_state = last_event_value(events, 'STATE_UPDATED')
  const actions = new PassThrough({
    objectMode: true,
    signal: controller.signal,
  })
  return {
    actions,
    controller,
    client,
    world,
    events,
    signal: controller.signal,
    on_unload(unload_handler) {
      controller.signal.addEventListener('abort', unload_handler, {
        once: true,
      })
    },
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

/** @param {Object} options
 * @param {import("./server").Module[]} options.mandatory_modules
 * @param {Observables} options.optional_modules
 * @param {import("./server").World} options.world
 */
export function create_client_handler({
  mandatory_modules,
  optional_modules,
  world,
}) {
  return async ({
    client,
    server: {
      mcversion: { minecraftVersion, version },
    },
  }) => {
    try {
      // check protocol versions
      if (client.protocolVersion !== version) {
        client.end(
          'Wrong minecraft version',
          JSON.stringify([
            { text: 'Currently only the version ', color: 'yellow' },
            { text: minecraftVersion, color: 'red' },
            { text: ' is supported.', color: 'yellow' },
            { text: '\n\n' },
            {
              text: 'Try restarting your game with this version.',
              color: 'gray',
            },
          ]),
        )
        log.info(
          {
            username: client.username,
            uuid: client.uuid,
          },
          'Client refused: wrong minecraft version',
        )
        return
      }

      log.info(
        {
          username: client.username,
          uuid: client.uuid,
          id: client.id,
        },
        'Client connected',
      )

      const { actions, controller, ...context } = create_context({
        client,
        world,
      })
      const player_state = await Database.pull(client.uuid.toLowerCase())
      const { events, signal } = context

      client.once('end', () => {
        log.info(
          { username: client.username, uuid: client.uuid },
          'Client disconnected',
        )

        actions.end()
        controller.abort()
      })

      const packets = aiter(unfazed(on(client, 'packet', { signal }))).map(
        ([payload, { name }]) => ({
          type: `packet/${name}`,
          payload,
        }),
      )

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

      // handling actions and packets
      aiter(
        abortable(
          combineAsyncIterators(actions[Symbol.asyncIterator](), packets),
        ),
      )
        .map(transform_action)
        .reduce(
          (last_state, action) => {
            // computing the latest state thhrough current selected modules
            const current_modules = [
              ...mandatory_modules,
              ...optional_modules[last_state.game_state],
              player_modules,
            ]
            const state = current_modules
              .map(({ reduce }) => reduce)
              // all modules may not include a reducer
              .filter(Boolean)
              .reduce(
                (intermediate, fn) => fn(intermediate, action, client),
                last_state,
              )
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

      log.warn(
        { modules: mandatory_modules.length },
        'Loading mandatory modules',
      )

      // those modules are always present and doesn't depend on the game state
      // so we can observe them right away
      iter(mandatory_modules)
        .filter(({ observe }) => !!observe)
        .forEach(({ observe }) => observe(context))

      // this last module is a bit special, he's responsible for
      // switching between modules depending on the game state
      player_modules.observe(context, optional_modules)
    } catch (error) {
      // if there was an error while creating the context
      log.error(
        {
          username: client.username,
          uuid: client.uuid,
          error: pino.stdSerializers.err(error),
        },
        'Create context error',
      )
      client.end(
        'There was a problem while initializing your character, please retry or contact us',
      )
    }
  }
}
