import { setInterval } from 'timers/promises'

import { aiter } from 'iterator-helper'

import { set_flying } from '../core/attribute.js'
import { write_inventory } from '../core/inventory.js'
import { Sound, play_sound } from '../core/sound.js'
import { PLAYER_INVENTORY_ID } from '../settings.js'
import { abortable } from '../core/iterator.js'

const MANRACNI_DURATION = 67000

function reset_player_inventory(client) {
  write_inventory(client, { inventory: {} }) // clear inventory
  // set overlay
  client.write('set_slot', {
    windowId: PLAYER_INVENTORY_ID,
    slot: 5, // head slot
    item: { present: true, itemId: 217 /* carved_pumpkin */, itemCount: 1 },
  })
}

/** @type {import("../server").Module} */
export default {
  name: 'player_main_menu',
  observe({ client, events, signal }) {
    client.on('window_click', () => reset_player_inventory(client))

    events.once('STATE_UPDATED', state => {
      reset_player_inventory(client)
      set_flying(client, true)

      play_sound({ client, sound: Sound.MUSIC_MANRACNI, ...state.position })

      aiter(
        abortable(setInterval(MANRACNI_DURATION, null, { signal })),
      ).forEach(() =>
        play_sound({ client, sound: Sound.MUSIC_MANRACNI, ...state.position }),
      )
    })

    signal.addEventListener(
      'abort',
      () => {
        set_flying(client, false)
        client.write('stop_sound', {
          flags: 0 /* https://wiki.vg/index.php?title=Protocol&oldid=16907#Stop_Sound MASTER category */,
        })
      },
      { once: true },
    )
  },
}
