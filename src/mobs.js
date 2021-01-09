import { PassThrough } from 'stream'
import { EventEmitter } from 'events'

import { pipeline } from 'streaming-iterables'

import { scan } from './iterables.js'
import { reduce_goto } from './mobs/goto.js'
import { reduce_deal_damage } from './mobs/fight.js'
import { last_event_value } from './events.js'

function reduce_state(state, action, world) {
  return [
    //
    reduce_goto,
    reduce_deal_damage,
  ].reduce(
    async (intermediate, fn) => fn(await intermediate, action, world),
    state
  )
}

export function register_mobs(world) {
  const mobs = world.mobs.map(({ position, mob, level }, i) => {
    const initial_state = {
      path: [position],
      open: [],
      closed: [],
      start_time: 0,
      speed: 500 /* block/ms */,
      life: 20 /* halfheart */,
    }

    const actions = new PassThrough({ objectMode: true })
    const events = new EventEmitter()

    pipeline(
      () => actions,
      scan(
        (state, action) => reduce_state(state, action, world.get()),
        initial_state
      ),
      async (states) => {
        for await (const state of states) events.emit('state', state)
      }
    )

    return {
      entity_id: world.next_entity_id + i,
      mob,
      level,
      events,
      get_state: last_event_value(events, 'state'),
      dispatch(type, payload) {
        actions.write({ type, payload })
      },
    }
  })

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
