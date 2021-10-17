import { normalize_chat_component } from '../chat.js'

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

const component_to_legacy = ({ text, extra = [], color, ...modifiers }) => {
  const inline_modifiers = Object.entries(Modifiers).reduce(
    (combined, [key, value]) => {
      if (modifiers[key.toLowerCase()]) return `${combined}${value}`
      return combined
    },
    ''
  )

  return `${Colors[color?.toUpperCase()] ?? ''}${inline_modifiers}${text}${extra
    .map(components_to_legacy)
    .join('')}`
}

export default function components_to_legacy(raw_component) {
  return normalize_chat_component(raw_component)
    .map(component_to_legacy)
    .join('')
}
