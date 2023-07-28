import { PassThrough } from 'stream'
import { EventEmitter } from 'events'

import minecraft_data from 'minecraft-data'
import { aiter } from 'iterator-helper'

import Entities from '../data/entities.json' assert { type: 'json' }

import { last_event_value } from './events.js'
import { path_end, path_position } from './mobs/path.js'
import mobs_goto from './mobs/goto.js'
import mobs_damage from './mobs/damage.js'
import mobs_target from './mobs/target.js'
import behavior_tree from './mobs/behavior_tree.js'
import { VERSION } from './settings.js'

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
/** @typedef {{ world: import('./context').World, type: string, entity_id: number }} MobContext */
/** @typedef {(state: MobState, action: Action, context?: MobContext) => Promise<MobState>} MobsReducer */

/** @type {MobsReducer} */
function reduce_mob(state, action, context) {
  return [
    mobs_goto.reduce_mob,
    mobs_damage.reduce_mob,
    behavior_tree.reduce_mob,
    mobs_target.reduce_mob,
  ].reduce(
    async (intermediate, fn) => fn(await intermediate, action, context),
    Promise.resolve(state),
  )
}

function observe_mobs(mobs) {
  path_end(mobs)
}

const DEFAULT_SPEED = 100 /* instant speed, 1ms/block */

const MOVEMENT_SPEED_TO_BLOCKS_PER_SECOND = 10

/** @param {import('./context.js').InitialWorld} world */
export function register(world) {
  const mobs = world.mob_positions.map(({ position, type, level }, i) => {
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
    events.setMaxListeners(Infinity)

    const entity_id = world.next_entity_id + i

    aiter(actions).reduce(async (last_state, action) => {
      const state = await reduce_mob(last_state, action, {
        world: world.get(),
        type,
        entity_id,
      })
      events.emit('STATE_UPDATED', state)
      return state
    }, mob_state)

    setImmediate(() => events.emit('STATE_UPDATED', mob_state))

    const get_state = last_event_value(events, 'STATE_UPDATED')

    return {
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
    }
  })

  observe_mobs(mobs)

  const { next_entity_id } = world

  return {
    ...world,
    next_entity_id: next_entity_id + mobs.length,
    mobs: {
      all: mobs,
      by_entity_id(id) {
        if (id >= next_entity_id && id <= next_entity_id + mobs.length)
          return mobs[id - next_entity_id]
        else return null
      },
    },
  }
}
