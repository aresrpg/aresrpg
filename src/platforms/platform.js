import EventEmitter, { on } from 'events'
import { setInterval } from 'timers/promises'
import { PassThrough } from 'stream'

import { aiter } from 'iterator-helper'
import combineAsyncIterators from 'combine-async-iterators'

import { abortable } from '../iterator.js'
import { block_center_position, position_equal } from '../position.js'
import position from '../player/position.js'
import { last_event_value, Platform, PlatformAction } from '../events.js'

import interaction from './interaction.js'
import move from './move.js'

export const ENTITIES_PER_PLATFORM_BLOCK = 3

function reduce_platform(state, action, context) {
  return [interaction.reduce_platform, move.reduce_platform].reduce(
    async (intermediate, fn) => fn(await intermediate, action, context),
    state
  )
}

const initial_state = {
  attached_entities: [],
}

/** @param {import('../context.js').InitialWorld} world */
export function register({ next_entity_id, platform_positions, ...world }) {
  const { cursor, platforms } = platform_positions.reduce(
    ({ platforms, cursor }, { size: [width, height], position }, id) => {
      const platform_state = {
        ...initial_state,
        position,
      }

      const actions = new PassThrough({ objectMode: true })
      const events = new EventEmitter()
      events.setMaxListeners(Infinity)

      aiter(actions).reduce(async (last_state, action) => {
        const state = await reduce_platform(last_state, action, {
          world: world.get(),
          id,
        })
        events.emit(Platform.STATE_UPDATED, state)
        return state
      }, platform_state)

      setImmediate(() => events.emit(Platform.STATE_UPDATED, platform_state))

      const get_state = last_event_value(events, Platform.STATE_UPDATED)

      return {
        cursor: cursor + width * height * ENTITIES_PER_PLATFORM_BLOCK,
        platforms: {
          ...platforms,
          [id]: {
            ...platforms[id],
            start_id: cursor,
            size: { width, height },
            platform_id: id,
            events,
            get_state,
            dispatch(action_type, payload, time = Date.now()) {
              actions.write({ type: action_type, payload, time })
            },
          },
        },
      }
    },
    { cursor: next_entity_id, platforms: {} }
  )

  return {
    ...world,
    platforms_start_id: next_entity_id,
    next_entity_id: cursor,
    platforms,
  }
}

export default {
  /** @type {import('../context.js').Observer} */
  observe(context) {
    const { client, world, signal } = context

    for (const platform of Object.values(world.platforms)) {
      const {
        start_id,
        dispatch,
        size: { width, height },
      } = platform

      aiter(
        abortable(
          // @ts-ignore
          combineAsyncIterators(
            on(platform.events, Platform.STATE_UPDATED, { signal }),
            setInterval(20, [{ timer: true }], { signal })
          )
        )
      )
        .map(([state]) => state)
        .reduce(
          (state, platform) => {
            const { can_move } = state
            const { timer, attached_entities } = platform
            if (attached_entities && attached_entities.length > 0) {
              return { ...state, can_move: true, last_position: position }
            }

            if (timer && can_move) {
              dispatch(PlatformAction.MOVE, { up: false })
              return { ...state, can_move: false }
            }

            return { ...state, last_position: position }
          },
          { last_position: null, can_move: false }
        )

      aiter(on(platform.events, Platform.STATE_UPDATED))
        .map(([state]) => state)
        .reduce(
          ({ prev_pos }, { position, attached_entities }) => {
            if (!position_equal(prev_pos, position)) {
              const { x, y, z } = position

              Array.from({ length: width * height }).forEach((_, i) => {
                client.write('entity_teleport', {
                  entityId: start_id + i * ENTITIES_PER_PLATFORM_BLOCK + 2,
                  ...{
                    ...block_center_position({
                      x: x + Math.floor(i % width),
                      y,
                      z: z + Math.floor(i / width),
                    }),
                    y,
                  },
                  yaw: 0,
                  pitch: 0,
                  onGround: false,
                })
              })
              if (prev_pos && position.y - prev_pos.y > 0) {
                // Platform is moving up

                // attached_entities -> array of entity uuid or id, depending on mob or player
                attached_entities.forEach(uuid => {
                  // TODO: move all attached entities with the platform
                })
              }
            }
            return { prev_pos: position }
          },
          { prev_pos: null }
        )
    }
  },
}
