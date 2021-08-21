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

const ChatColor = {
  DARK_RED: '§4',
  RED: '§c',
  GOLD: '§6',
  YELLOW: '§e',
  DARK_GREEN: '§2',
  GREEN: '§a',
  AQUA: '§b',
  DARK_AQUA: '§3',
  DARK_BLUE: '§1',
  BLUE: '§9',
  LIGHT_PURPLE: '§d',
  DARK_PURPLE: '§5',
  WHITE: '§f',
  GRAY: '§7',
  DARK_GRAY: '§8',
  BLACK: '§0',
  OBFUSCATED: '§k',
  BOLD: '§l',
  STRIKETHROUGH: '§m',
  UNDERLINE: '§n',
  ITALIC: '§o',
  RESET: '§r',
}

const Slots = {
  CLASS: 13,
  PROGRESS: 12,
  SOUL: 11,
  KARES: 10,
}

const Lines = {
  CLASS: ({ name, level, progress }) =>
    `§f§l${name} §7[Lvl §2${level}§7] (§a${progress}§f%§7)`,
  PROGRESS: ({ progress }) => {
    const amount = (PROGRESS_SQUARES_AMOUNT * progress) / 100
    const full_squares = ChatColor.GREEN + PROGRESS_SQUARES_CHAR.repeat(amount)
    const empty_squares =
      ChatColor.DARK_GRAY +
      PROGRESS_SQUARES_CHAR.repeat(PROGRESS_SQUARES_AMOUNT - amount)
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

const no_duplicates = (lines) => (text, index) => {
  const { length } = lines
    .slice(0, index)
    .filter((current_text) => current_text === text)

  return `${text}${ChatColor.RESET.repeat(length)}`
}

const format_score_upsert = ({ line, slot }) => ({
  scoreName: SCOREBOARD_NAME,
  action: Actions.SCORE_UPSERT,
  itemName: line.slice(0, 40),
  value: slot + 1,
})

const write_scores_with = (write) => (schema) =>
  schema
    .map(no_duplicates(schema))
    .map((item, index) => format_score_upsert({ line: item, slot: index }))
    .forEach(write)

export default {
  /** @type {import('../index.js').Observer} */
  observe({ events, dispatch, signal, client, get_state }) {
    const write_scores = write_scores_with((options) =>
      client.write('scoreboard_score', options)
    )

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

      write_scores(
        Array.from({
          length: 15,
          14: '',
          [Slots.CLASS]: Lines.CLASS({
            name: 'Sram',
            level: 196,
            progress: 22,
          }),
          [Slots.PROGRESS]: Lines.PROGRESS({ progress: 22 }),
          [Slots.SOUL]: Lines.SOUL({ soul: 100 }),
          [Slots.KARES]: Lines.KARES({ kares: 0 }),
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
      )
    })

    // we don't check for duplicates here, that may be a flaw
    events.on('player/experience', ({ level, progress }) => {
      client.write(
        'scoreboard_score',
        format_score_upsert({
          line: Lines.CLASS({ name: 'Stram', level, progress }),
          slot: Slots.CLASS,
        })
      )
      client.write(
        'scoreboard_score',
        format_score_upsert({
          line: Lines.PROGRESS({ progress }),
          slot: Slots.PROGRESS,
        })
      )
    })
  },
}
