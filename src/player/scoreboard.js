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

export const ChatColor = {
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

const Schema = Array.from({
  length: 15,
  14: '',
  13: '§f§lSram §7[Lvl §2196§7] (§a22§f%§7)',
  12: '§a▀▀▀§8▀▀▀▀▀▀▀▀▀',
  11: '§7Ame: §d100§f%',
  10: '§7kAres: §61.1§fM',
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

const no_duplicates = lines => (text, index) => {
  const { length } = lines
    .slice(0, index)
    .filter(current_text => current_text === text)

  return `${text}${ChatColor.RESET.repeat(length)}`
}

const write_scores_with = write => schema =>
  schema
    .map(no_duplicates(schema))
    .map((item, index) => ({
      scoreName: SCOREBOARD_NAME,
      action: Actions.SCORE_UPSERT,
      itemName: item.slice(0, 40),
      value: index + 1,
    }))
    .forEach(write)

export default {
  /** @type {import('../index.js').Observer} */
  observe({ events, dispatch, signal, client }) {
    const write_scores = write_scores_with(options =>
      client.write('scoreboard_score', options)
    )

    events.once('state', state => {
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

      write_scores(Schema)
    })
  },
}
