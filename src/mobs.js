import { PassThrough } from 'stream'
import { EventEmitter } from 'events'

import minecraft_data from 'minecraft-data'
import { aiter } from 'iterator-helper'

import { Types } from './mobs/types.js'
import { last_event_value, Mob } from './events.js'
import { path_end, path_position } from './mobs/path.js'
import mobs_goto from './mobs/goto.js'
import mobs_damage from './mobs/damage.js'
import mobs_target from './mobs/target.js'
import behavior_tree from './mobs/behavior_tree.js'
import { VERSION } from './settings.js'

const { entitiesByName } = minecraft_data(VERSION)

function reduce_mob(state, action, world) {
  return [
    //
    mobs_goto.reduce_mob,
    mobs_damage.reduce_mob,
    behavior_tree.reduce_mob,
    mobs_target.reduce_mob,
  ].reduce(
    async (intermediate, fn) => fn(await intermediate, action, world),
    state
  )
}

function observe_mobs(mobs) {
  path_end(mobs)
}

const DEFAULT_SPEED = 100 /* instant speed, 1ms/block */

const MOVEMENT_SPEED_TO_BLOCKS_PER_SECOND = 10

/** @param {import('./context.js').InitialWorld} world */
export function register(world) {
  const mobs = world.mob_positions.map(({ position, mob, level }, i) => {
    const { speed = DEFAULT_SPEED, health } = Types[mob]
    const initial_state = {
      path: [position],
      open: [],
      closed: [],
      start_time: 0,
      speed:
        (1 / (speed * MOVEMENT_SPEED_TO_BLOCKS_PER_SECOND)) *
        1000 /* ms/block */,
      health /* halfheart */,
      blackboard: {},
      attack_sequence_number: 0,
      wakeup_at: 0,
      sleep_id: null,
      look_at: { player: false, yaw: 0, pitch: 0 },
    }

    const actions = new PassThrough({ objectMode: true })
    const events = new EventEmitter()
    events.setMaxListeners(Infinity)

    const entity_id = world.next_entity_id + i

    aiter(actions).reduce(async (last_state, action) => {
      const state = await reduce_mob(last_state, action, {
        world: world.get(),
        mob,
        entity_id,
      })
      events.emit(Mob.STATE, state)
      return state
    }, initial_state)

    setImmediate(() => events.emit(Mob.STATE, initial_state))

    const get_state = last_event_value(events, Mob.STATE)

    return {
      entity_id,
      mob,
      level,
      events,
      get_state,
      constants: entitiesByName[Types[mob].mob],
      position(time = Date.now()) {
        const { path, start_time, speed } = get_state()

        return path_position({ path, time, start_time, speed })
      },
      dispatch(type, payload, time = Date.now()) {
        actions.write({ type, payload, time })
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
