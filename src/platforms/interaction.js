import { on } from 'events'

import { aiter } from 'iterator-helper'

import { PlatformAction, PlayerEvent } from '../events.js'
import { abortable } from '../iterator.js'

import { is_inside_platform } from './utils.js'

export default {
  reduce_platform(state, { type, payload }, context) {
    if (type === PlatformAction.PLAYER_ENTER_PLATFORM) {
      const { attached_entities } = state
      const { entity } = payload
      return {
        ...state,
        attached_entities: attached_entities.includes(entity)
          ? attached_entities
          : [...attached_entities, entity],
      }
    }
    if (type === PlatformAction.PLAYER_LEAVE_PLATFORM) {
      const { attached_entities } = state
      const { entity } = payload
      const index = attached_entities.indexOf(entity)
      return {
        ...state,
        attached_entities: [
          ...attached_entities.slice(0, index),
          ...attached_entities.slice(index + 1),
        ],
      }
    }
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe(context) {
    const { events, client, world, signal } = context
    aiter(abortable(on(events, PlayerEvent.STATE_UPDATED, { signal })))
      .map(([{ position }]) => ({ position }))
      .reduce(({ was_on_platform }, { position }) => {
        const onPlatform = Object.values(world.platforms).find(platform =>
          is_inside_platform(platform, position)
        )
        if (was_on_platform && !onPlatform) {
          was_on_platform.dispatch(PlatformAction.PLAYER_LEAVE_PLATFORM, {
            entity: client.uuid,
          })
        }

        if (!was_on_platform && onPlatform) {
          onPlatform.dispatch(PlatformAction.PLAYER_ENTER_PLATFORM, {
            entity: client.uuid,
          })
        }

        return { was_on_platform: onPlatform }
      })
  },
}
