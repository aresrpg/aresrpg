import { PassThrough } from 'stream'
import { EventEmitter } from 'events'

import minecraft_data from 'minecraft-data'
import { aiter, iter } from 'iterator-helper'

import Entities from '../data/entities.json' assert { type: 'json' }

import { last_event_value } from './core/events.js'
import { VERSION } from './settings.js'
import single_use_function from './core/single_use_function.js'
import { path_position } from './core/entity_path.js'

const { entitiesByName } = minecraft_data(VERSION)

const initial_state = {
  path: [],
  open: [],
  closed: [],
  start_time: 0,
  speed: 0,
  health: 0,
  blackboard: {},
  attack_sequence_number: 0,
  wakeup_at: 0,
  sleep_id: null,
  look_at: { player: false, yaw: 0, pitch: 0 },
  first_damager: null,
  last_damager: null,
  last_hit: 0,
  target: null,
  target_position: null,
  /** last damage taken by this mob was a critical hit */
  last_hit_was_critical: false,
}

/** @typedef {Readonly<typeof initial_state>} MobState */
/** @typedef {import('./types').MobAction} Action */
/** @typedef {ReturnType<ReturnType<ReturnType<typeof create_mob_handler>>>} Mob */
/** @typedef {{ world: import('./server').World, type: string, entity_id: number }} MobContext */
/** @typedef {(state: MobState, action: Action, context?: MobContext) => Promise<MobState>} MobsReducer */
/** @typedef {(mob: Mob) => void} MobObserver */
/** @typedef {ReturnType<typeof create_mob_handler>} CreateMob */

const DEFAULT_SPEED = 100 /* instant speed, 1ms/block */

const MOVEMENT_SPEED_TO_BLOCKS_PER_SECOND = 10

export function create_mob_handler(modules) {
  /** @param {import("./world").InitialWorld} world */
  return world =>
    ({ position, type, level }, index) => {
      const { speed = DEFAULT_SPEED, health } = Entities[type]
      const mob_state = {
        ...initial_state,
        path: [position],
        speed:
          (1 / (speed * MOVEMENT_SPEED_TO_BLOCKS_PER_SECOND)) *
          1000 /* ms/block */,
        health /* halfheart */,
      }

      const actions = new PassThrough({ objectMode: true })

      /** @type {import('./types').MobEvents} */
      const events = new EventEmitter()
      // events.setMaxListeners(Infinity)
      const entity_id = world.next_entity_id + index
      const get_state = last_event_value(events, 'STATE_UPDATED')

      const mob = {
        entity_id,
        type,
        level,
        events,
        get_state,
        constants: entitiesByName[Entities[type].minecraft_entity],
        position(time = Date.now()) {
          const { path, start_time, speed } = get_state()
          return path_position({ path, time, start_time, speed })
        },
        /**
         * @template {keyof import('./types').MobActions} K
         * @param {K} action_type
         * @param {import('./types').MobActions[K]} [payload] */
        dispatch(action_type, payload, time = Date.now()) {
          actions.write({ type: action_type, payload, time })
        },
        /** @type {(world: import("./server").World) => void}
         * this is used as a replacement to the world.get() trick
         * it seems more appropriate to me to pass objects when they exists
         * rather than relying on their future refference
         */
        wake: single_use_function(world => {
          aiter(actions).reduce(async (last_state, action) => {
            const context = {
              world,
              type,
              entity_id,
            }
            /** @type {MobState} */
            const state = await modules
              .map(({ reduce_mob }) => reduce_mob)
              .filter(Boolean)
              .reduce(
                async (intermediate, reduce) =>
                  reduce(await intermediate, action, context),
                Promise.resolve(last_state),
              )
            events.emit('STATE_UPDATED', state)
            return state
          }, mob_state)
          setImmediate(() => events.emit('STATE_UPDATED', mob_state))
        }),
      }

      iter(modules)
        .filter(({ observe_mob }) => !!observe_mob)
        .forEach(({ observe_mob }) => observe_mob(mob))

      return mob
    }
}
