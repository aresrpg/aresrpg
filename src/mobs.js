import { PassThrough } from 'stream'
import { EventEmitter } from 'events'

import { aiter } from 'iterator-helper'

import { last_event_value } from './events.js'
import mobs_goto from './mobs/goto.js'
import mobs_damage from './mobs/damage.js'
import { path_end } from './mobs/path.js'
import behavior_tree from './mobs/behavior_tree.js'

function reduce_mob(state, action, world) {
  return [
    //
    mobs_goto.reduce_mob,
    mobs_damage.reduce_mob,
    behavior_tree.reduce_mob,
  ].reduce(
    async (intermediate, fn) => fn(await intermediate, action, world),
    state
  )
}

function observe_mobs(mobs) {
  path_end(mobs)
}

export default {
  register(world) {
    const mobs = world.mobs.map(({ position, mob, level }, i) => {
      const initial_state = {
        path: [position],
        open: [],
        closed: [],
        start_time: 0,
        speed: 500 /* ms/block */,
        health: 20 /* halfheart */,
        blackboard: {},
      }

      const actions = new PassThrough({ objectMode: true })
      const events = new EventEmitter()

      aiter(actions).reduce(async (last_state, action) => {
        const state = await reduce_mob(last_state, action, {
          world: world.get(),
          mob,
        })
        events.emit('state', state)
        return state
      }, initial_state)

      setImmediate(() => events.emit('state', initial_state))

      return {
        entity_id: world.next_entity_id + i,
        mob,
        level,
        events,
        get_state: last_event_value(events, 'state'),
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
  },
}
