import { on } from 'events'

import { aiter } from 'iterator-helper'

import { abortable } from '../iterator.js'
import logger from '../logger.js'

import { experience_to_level, level_progress } from './experience.js'

const log = logger(import.meta)

const Positions = {
  LIST: 0,
  SIDEBAR: 1,
  BELOW_NAME: 2,
}

const Actions = {
  OBJECTIVE_CREATE: 0,
  OBJECTIVE_REMOVE: 1,
  OBJECTIVE_UPDATE: 2,
  SCORE_UPSERT: 0,
  SCORE_REMOVE: 1,
}

const INTEGER_TYPE = 0
const SCOREBOARD_NAME = 'aresrpg'
const PROGRESS_SQUARES_CHAR = '▀'
const PROGRESS_SQUARES_AMOUNT = 12
const KARES_FORMATER = Intl.NumberFormat('en', { notation: 'compact' })
const MAGIC_RESET = '§r'

const Formats = {
  CLASS: ({ name, level, progress }) =>
    `§f§l${name} §7[Lvl §2${level}§7] (§a${progress}§f%§7)`,
  PROGRESS: ({ progress }) => {
    const amount = (PROGRESS_SQUARES_AMOUNT * progress) / 100
    const full_squares = '§a' + PROGRESS_SQUARES_CHAR.repeat(amount)
    const empty_squares =
      '§8' + PROGRESS_SQUARES_CHAR.repeat(PROGRESS_SQUARES_AMOUNT - amount)
    return `${full_squares}${empty_squares}`
  },
  SOUL: ({ soul }) => `§7Ame: §d${soul}§f%`,
  KARES: ({ kares }) => {
    const formatted = KARES_FORMATER.formatToParts(kares).map(
      ({ value }) => value
    )
    const amount = formatted.slice(0, -1).join('')
    const compact = formatted.at(-1)
    return `§7kAres: §6${amount}§f${compact}`
  },
}

const Compose = {
  no_duplicate:
    (lines) =>
    ({ text, index }) => {
      const { length } = lines
        .slice(0, index)
        .filter((current_text) => current_text === text)

      return { text: `${text}${MAGIC_RESET.repeat(length)}`, index }
    },
  only_changes:
    (source) =>
    ({ text, index }) =>
      source.at(index) !== text,
  create_packet: ({ text, index }) => ({
    scoreName: SCOREBOARD_NAME,
    action: Actions.SCORE_UPSERT,
    itemName: text.slice(0, 40),
    value: index + 1,
  }),
  log: (identity) => {
    log.info(identity, 'scoreboard update')
    return identity
  },
}

const update_sidebar_with =
  (client) =>
  ({ last, next }) =>
    next
      .map((text, index) => ({ text, index }))
      .map(Compose.no_duplicates(next))
      .filter(Compose.only_changes(last))
      .map(Compose.log)
      .map(Compose.create_packet)
      .forEach((options) => client.write('scoreboard_score', options))

export default {
  /** @type {import('../index.js').Observer} */
  observe({ events, dispatch, signal, client, get_state }) {
    const update_sidebar = update_sidebar_with(client)

    events.once('state', (state) => {
      client.write('scoreboard_objective', {
        name: SCOREBOARD_NAME,
        action: Actions.OBJECTIVE_CREATE,
        displayText: JSON.stringify({ text: '§6Ares§lRPG §7[§oV1§r§7]' }),
        type: INTEGER_TYPE,
      })

      client.write('scoreboard_display_objective', {
        name: SCOREBOARD_NAME,
        position: Positions.SIDEBAR,
      })
    })

    aiter(abortable(on(events, 'state', { signal }))).reduce(
      (last, [{ total_experience }]) => {
        const { level, remaining_experience } =
          experience_to_level(total_experience)
        const progress = level_progress({ level, remaining_experience })
        const next = Array.from({
          length: 15,
          14: '',
          13: Formats.CLASS({ name: 'Sram', level, progress }),
          12: Formats.PROGRESS({ progress }),
          11: Formats.SOUL({ soul: 100 }),
          10: Formats.KARES({ kares: 0 }),
          9: '',
          8: '§7§nGroupe:',
          7: '§7-',
          6: '§7-',
          5: '§7-',
          4: '§7-',
          3: '§7-',
          2: '§7-',
          1: '',
          0: '§owww.aresrpg.fr',
        })

        update_sidebar({ last, next })
        return next
      },
      []
    )
  },
}
