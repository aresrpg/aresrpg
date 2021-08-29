import normalize from './normalize.js'

const Colors = {
  GREEN: '§a',
  AQUA: '§b',
  RED: '§c',
  LIGHT_PURPLE: '§d',
  YELLOW: '§e',
  WHITE: '§f',
  BLACK: '§0',
  DARK_BLUE: '§1',
  DARK_GREEN: '§2',
  DARK_AQUA: '§3',
  DARK_RED: '§4',
  DARK_PURPLE: '§5',
  GOLD: '§6',
  GRAY: '§7',
  DARK_GRAY: '§8',
  BLUE: '§9',
}

const Modifiers = {
  OBFUSCATED: '§k',
  BOLD: '§l',
  STRIKETHROUGH: '§m',
  UNDERLINE: '§n',
  ITALIC: '§o',
  RESET: '§r',
}

const extract_modifiers = ({ text, extra = [], color, ...modifiers }) => {
  const inline_modifiers = Object.entries(Modifiers).reduce(
    (combined, [key, value]) => {
      if (modifiers[key.toLowerCase()]) return `${combined}${value}`
      return combined
    },
    ''
  )

  return `${Colors[color?.toUpperCase()] ?? ''}${inline_modifiers}${text}${extra
    .map(extract_modifiers)
    .join('')}`
}

// sending chat components is great but it's adding extra reset chars
// between all components parts (even extra)
// which increase way too much the length of the scoreboard line
// makes the client crash, so we need to convert back to string
export default raw_component =>
  normalize(raw_component).map(extract_modifiers).join('')
