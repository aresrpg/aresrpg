import { on } from 'events'

import { aiter } from 'iterator-helper'

import { abortable } from '../core/iterator.js'
import { play_sound, Sound } from '../core/sound.js'
import logger from '../logger.js'
import { client_chat_msg } from '../core/chat.js'

const log = logger(import.meta)

/** @type {import('../server').Module} */
export default {
  name: 'player_spell',
  reduce(state, { type, payload }) {
    if (type === 'SWITCH_SPELL') {
      const selected_spell = Math.max(0, Math.min(payload, 7))

      log.info({ selected_spell }, 'switched spell')
      return {
        ...state,
        selected_spell,
      }
    }

    if (type === 'CAST_SPELL') {
      const { selected_spell } = payload
      const { spells } = state
      // a casted spell will always be defined
      const spell = spells[selected_spell]
      return {
        ...state,
        spells: [
          ...spells.slice(0, selected_spell),
          {
            ...spell,
            cast_time: Date.now(),
          },
          ...spells.slice(selected_spell + 1),
        ],
      }
    }
    return state
  },
  observe({ events, dispatch, client, signal, get_state }) {
    aiter(abortable(on(client, 'use_item', { signal })))
      .filter(([{ hand }]) => hand === 0)
      .forEach(() => {
        const { selected_spell, spells, position } = get_state()
        const spell = spells[selected_spell]

        if (spell) {
          const { couldown, cast_time } = spell
          if (cast_time + couldown < Date.now()) {
            dispatch('CAST_SPELL', { selected_spell })
            client_chat_msg({
              client,
              message: [{ text: `cast spell ${selected_spell}` }],
            })
          } else
            play_sound({
              client,
              sound: Sound.SPELL_FAILED,
              ...position,
            })
        }
      })

    aiter(abortable(on(client, 'held_item_slot', { signal })))
      .map(([{ slotId }]) => slotId)
      // ignore event if 0 (the client will send us 0 again when we force it)
      .filter(slot => slot !== 0)
      .reduce((last_slot, slot) => {
        // force weapon slot
        if (last_slot !== slot) {
          const { position } = get_state()
          play_sound({
            client,
            sound: Sound.SWITCH_SPELL,
            ...position,
          })
          dispatch('SWITCH_SPELL', slot - 1)
        }

        client.write('held_item_slot', {
          slot: 0,
        })
        return slot
      }, null)
  },
}
