import { on } from 'events'
import { setInterval } from 'timers/promises'

import { aiter } from 'iterator-helper'

import { abortable } from '../iterator.js'
import UI from '../ui.js'
import { get_max_health } from '../characteristics.js'

export default {
  /** @type {import('../context.js').Observer} */
  observe({ events, dispatch, client, world, signal, get_state }) {
    const { display_health_profile, display_hotbar } = UI(client)

    // every half second to handle the spells couldown display
    // additionally to not letting fade the action bar
    aiter(abortable(setInterval(500, null, { signal })))
      .map(get_state)
      .filter(state => !!state)
      .forEach(display_hotbar)

    aiter(abortable(on(events, 'STATE_UPDATED', { signal })))
      .map(([state]) => state)
      .reduce(
        (
          {
            last_health,
            last_max_health,
            last_head_texture,
            last_experience,
            last_soul,
            last_top_left_ui_offset,
            last_selected_spell,
          },
          {
            experience,
            selected_spell,
            inventory,
            characteristics,
            health,
            soul,
            spells,
            user_interface: { head_texture },
            settings: { top_left_ui_offset },
          },
        ) => {
          const max_health = get_max_health({
            inventory,
            experience,
            characteristics,
          })

          if (
            last_experience !== experience ||
            last_selected_spell !== selected_spell
          )
            display_hotbar({ experience, selected_spell, spells })
          if (
            last_health !== health ||
            last_max_health !== max_health ||
            last_head_texture !== head_texture ||
            last_soul !== soul ||
            last_top_left_ui_offset !== top_left_ui_offset
          )
            display_health_profile({
              health,
              max_health,
              head_texture,
              soul,
              top_left_ui_offset,
            })

          return {
            last_health: health,
            last_max_health: max_health,
            last_head_texture: head_texture,
            last_experience: experience,
            last_soul: soul,
            last_top_left_ui_offset: top_left_ui_offset,
            last_selected_spell: selected_spell,
          }
        },
        {
          last_health: null,
          last_max_health: null,
          last_head_texture: null,
          last_experience: null,
          last_soul: null,
          last_top_left_ui_offset: null,
          last_selected_spell: null,
        },
      )
  },
}
