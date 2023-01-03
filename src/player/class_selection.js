import { on } from 'events'
import { setInterval } from 'timers/promises'

import combineAsyncIterators from 'combine-async-iterators'
import { aiter } from 'iterator-helper'

import { PlayerAction, PlayerEvent } from '../events.js'
import { abortable } from '../iterator.js'
import { delete_title, write_action_bar, write_title } from '../title.js'
import { GameMode } from '../gamemode.js'

const KITS_AMOUNT = 4

function send_selection_menu(client, selected) {
  const kits = Array.from({ length: KITS_AMOUNT }).map((_, i) => ({
    translate: `aresrpg.kits.kit.${i}`,
    font: 'kits:default',
  }))

  kits.splice(selected + 1, 0, {
    translate: 'space.-65',
    font: 'space:default',
    // @ts-ignore
    with: [
      {
        translate: 'aresrpg.kits.selected',
        font: 'kits:default',
      },
    ],
  })
  write_title({
    client,
    subtitle: kits,
    times: {
      fade_in: 0,
      fade_out: 0,
      stay: 5,
    },
    force_reset: false,
  })

  write_action_bar({
    client,
    text: { text: 'please select a class!' },
  })
}

function slot_motion_dir(curr_slot, prev_slot) {
  if (prev_slot === 8 && curr_slot === 0) return 1
  if (prev_slot === 0 && curr_slot === 8) return -1
  if (curr_slot - prev_slot === 0) return 0
  return curr_slot - prev_slot > 0 ? 1 : -1
}

function slot_next_value(curr_slot, prev_slot, val) {
  const new_val = val + slot_motion_dir(curr_slot, prev_slot)
  return ((new_val % KITS_AMOUNT) + KITS_AMOUNT) % KITS_AMOUNT
}

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === PlayerAction.OPEN_CLASS_SELECTION) {
      const { open } = payload
      return {
        ...state,
        class_selection_open: open,
      }
    }
    if (type === PlayerAction.SELECT_CLASS) {
      const { selected_class } = payload
      return {
        ...state,
        selected_class,
      }
    }
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe({ client, events, signal, dispatch }) {
    aiter(
      abortable(
        // @ts-ignore
        combineAsyncIterators(
          on(events, PlayerEvent.STATE_UPDATED, { signal }),
          setInterval(3000, [{ timer: true }], { signal })
        )
      )
    )
      .map(([state]) => state)
      .reduce(
        (
          state,
          {
            class_selection_open,
            held_slot_index,
            timer,
            game_mode,
            selected_class,
          }
        ) => {
          const { last_held_slot_index, last_open, last_selected_class } = state

          if (timer) {
            if (last_open) send_selection_menu(client, last_selected_class)
            return state
          }

          const new_selected_class = slot_next_value(
            held_slot_index,
            last_held_slot_index,
            selected_class
          )

          if (
            last_held_slot_index !== held_slot_index &&
            class_selection_open
          ) {
            send_selection_menu(client, new_selected_class)
            dispatch(PlayerAction.SELECT_CLASS, {
              selected_class: new_selected_class,
            })
          }

          if (last_open !== class_selection_open) {
            if (class_selection_open) {
              send_selection_menu(client, selected_class)
              client.write('game_state_change', {
                reason: 3, // @see https://wiki.vg/Protocol#Change_Game_State
                gameMode: GameMode.SPECTATOR,
              })
            } else {
              delete_title({ client })
              client.write('game_state_change', {
                reason: 3, // @see https://wiki.vg/Protocol#Change_Game_State
                gameMode: game_mode,
              })
            }
          }

          return {
            last_selected_class: new_selected_class,
            last_held_slot_index: held_slot_index,
            last_open: class_selection_open,
          }
        },
        {
          last_selected_class: 0,
          last_held_slot_index: 0,
          last_open: false,
        }
      )

    client.on('arm_animation', ({ hand }) => {
      events.once(
        PlayerEvent.STATE_UPDATED,
        ({ selected_class, class_selection_open }) => {
          if (class_selection_open && hand === 0) {
            dispatch(PlayerAction.OPEN_CLASS_SELECTION, { open: false })
            // TODO: give player the selected class
          }
        }
      )
    })
  },
}
