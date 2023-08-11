import equals from 'fast-deep-equal'

import { normalize_chat_component, MAGIC_RESET } from './chat.js'

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

const Action = {
  UPSERT: 0,
  REMOVE: 1,
}

const component_to_legacy = ({ text, extra = [], color, ...modifiers }) => {
  const inline_modifiers = Object.entries(Modifiers).reduce(
    (combined, [key, value]) => {
      if (modifiers[key.toLowerCase()]) return `${combined}${value}`
      return combined
    },
    '',
  )

  return `${Colors[color?.toUpperCase()] ?? ''}${inline_modifiers}${text}${extra
    .map(components_to_legacy)
    .join('')}`
}

export function components_to_legacy(raw_component) {
  return normalize_chat_component(raw_component)
    .map(component_to_legacy)
    .join('')
}

function no_duplicates(components) {
  return ({ component, index }) => {
    const { length } = components
      .slice(0, index)
      .map(normalize_chat_component)
      .filter(current_component => equals(current_component, component))

    const [first, ...tail] = component

    return {
      component: [
        { ...first, text: `${MAGIC_RESET.repeat(length)}${first.text ?? ''}` },
        ...tail,
      ],
      index,
    }
  }
}

function only_changes(components) {
  return ({ component, index }) =>
    !equals(components.map(normalize_chat_component)[index], component)
}

function create_packets(scoreName, last) {
  return ({ component, index }) => [
    {
      scoreName,
      action: Action.REMOVE,
      itemName: components_to_legacy(last[index]).slice(0, 40),
      value: index + 1,
    },
    {
      scoreName,
      action: Action.UPSERT,
      itemName: components_to_legacy(component).slice(0, 40),
      value: index + 1,
    },
  ]
}

function write_packets(client) {
  return packet => client.write('scoreboard_score', packet)
}

export function update_sidebar_for({ client, scoreboard_name }) {
  return ({ last, next }) =>
    next
      .map(normalize_chat_component)
      .map((component, index) => ({ component, index }))
      .filter(only_changes(last))
      .map(no_duplicates(next))
      .flatMap(create_packets(scoreboard_name, last))
      .forEach(write_packets(client))
}
