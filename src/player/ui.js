import { on } from 'events'

import { aiter } from 'iterator-helper'

import { abortable } from '../iterator.js'
import { PlayerEvent } from '../events.js'
import { update_top } from '../ui.js'
import { get_max_health } from '../characteristics.js'
import { level_progression } from '../experience.js'

export default {
  /** @type {import('../context.js').Observer} */
  observe({ events, dispatch, client, world, signal }) {
    aiter(abortable(on(events, PlayerEvent.STATE_UPDATED, { signal })))
      .map(([state]) => state)
      .reduce(
        (
          {
            last_health,
            last_max_health,
            last_head_texture,
            last_experience,
            last_top_left_ui_offset,
          },
          {
            experience,
            inventory,
            characteristics,
            health,
            user_interface: { head_texture },
            settings: { top_left_ui_offset },
          }
        ) => {
          const max_health = get_max_health({
            inventory,
            experience,
            characteristics,
          })

          if (
            last_health !== health ||
            last_max_health !== max_health ||
            last_head_texture !== head_texture ||
            last_experience !== experience ||
            last_top_left_ui_offset !== top_left_ui_offset
          ) {
            const {
              experience_of_level,
              experience_of_next_level,
              experience_percent,
            } = level_progression(experience)
            const health_percent = (100 * health) / max_health

            update_top(client, {
              top_left_ui_offset,
              health,
              max_health,
              health_perten: Math.round(health_percent / 10),
              experience_of_level,
              experience_of_next_level,
              experience_percent,
              experience_perten: Math.round(experience_percent / 10),
              head_texture,
            })
          }

          return {
            last_health: health,
            last_max_health: max_health,
            last_head_texture: head_texture,
            last_experience: experience,
            last_top_left_ui_offset: top_left_ui_offset,
          }
        },
        {
          last_health: null,
          last_max_health: null,
          last_head_texture: null,
          last_experience: null,
          last_top_left_ui_offset: null,
        }
      )
  },
}
