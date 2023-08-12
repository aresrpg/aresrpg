import { on } from 'events'

import { aiter } from 'iterator-helper'

import { abortable } from '../core/iterator.js'
import package_json from '../../package.json' assert { type: 'json' }
import { update_sidebar_for } from '../core/scoreboard.js'

const SCOREBOARD_NAME = 'aresrpg'
const CREATE_OBJECTIVE_ACTION = 0
const INTEGER_TYPE = 0
const SIDEBAR_POSITION = 1
const KARES_FORMATER = Intl.NumberFormat('en', { notation: 'compact' })

const Slots = {
  EMPTY_GROUP_SLOT: { color: 'gray', text: '-' },
  CLASS: ({ name }) => [
    { text: `${name} `, color: 'white', bold: true },
    { text: '(', color: 'gray' },
    { text: 'none', color: 'white', italic: true }, // faction
    { text: ')', color: 'gray' },
  ],

  PROGRESS: ({ level, progress }) => [
    { text: 'Lvl: ', color: 'gray' },
    { text: `${level}`, color: 'dark_green', reset: false },
    { text: ' (', color: 'gray' },
    { text: `${Math.round(progress * 100)}`, color: 'green' },
    { text: '%', color: 'white' },
    { text: ')', color: 'gray' },
  ],

  SOUL: ({ soul }) => [
    { text: 'Ame: ', color: 'gray' },
    { text: `${soul}`, color: 'light_purple' },
    { text: '%', color: 'white' },
  ],

  KARES({ kares }) {
    const formatted = KARES_FORMATER.formatToParts(kares).map(
      ({ value }) => value,
    )
    const amount = formatted.slice(0, -1).join('')
    const compact = formatted.at(-1)
    return [
      { text: 'kAres: ', color: 'gray' },
      { text: `${amount}`, color: 'gold' },
      { text: `${compact}`, color: 'white' },
    ]
  },
}

/** @type {import('../server').Module} */
export default {
  name: 'player_scoreboard',
  observe({ events, dispatch, signal, client, get_state }) {
    const update_sidebar = update_sidebar_for({
      client,
      scoreboard_name: SCOREBOARD_NAME,
    })

    events.once('STATE_UPDATED', state => {
      client.write('scoreboard_objective', {
        name: SCOREBOARD_NAME,
        action: CREATE_OBJECTIVE_ACTION,
        displayText: JSON.stringify([
          { text: 'Ares', color: 'gold' },
          { text: 'RPG ', bold: true },
          {
            text: `v${package_json.version}`,
            italic: true,
            color: 'dark_gray',
          },
        ]),
        type: INTEGER_TYPE,
      })

      client.write('scoreboard_display_objective', {
        name: SCOREBOARD_NAME,
        position: SIDEBAR_POSITION,
      })
    })

    aiter(abortable(on(events, 'STATE_UPDATED', { signal }))).reduce(
      (last, [{ soul, kares }]) => {
        const next = Array.from({
          length: 15,
          14: '',
          13: Slots.CLASS({ name: '<Classe>' }),
          // 12: Slots.PROGRESS({ level, progress }),
          11: Slots.SOUL({ soul }),
          10: Slots.KARES({ kares }),
          9: '',
          8: { color: 'gray', underline: true, text: 'Groupe:' },
          7: Slots.EMPTY_GROUP_SLOT,
          6: Slots.EMPTY_GROUP_SLOT,
          5: Slots.EMPTY_GROUP_SLOT,
          4: Slots.EMPTY_GROUP_SLOT,
          3: Slots.EMPTY_GROUP_SLOT,
          2: Slots.EMPTY_GROUP_SLOT,
          1: '',
          0: { italic: true, text: '   www.aresrpg.fr   ' },
        })

        update_sidebar({ last, next })
        return next
      },
      [],
    )
  },
}
