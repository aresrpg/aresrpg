import { ChatColor } from './enums.js'

export const to_array = (value) => (Array.isArray(value) ? value : [value])

/**
 * Convert chat component to string
 * @param {chats: Chat[]} chat
 */
export function chat_to_text(chat) {
  return to_array(chat)
    .map((part) => {
      if (typeof part !== 'object') {
        return part
      }

      const modifiers = [
        ChatColor[part.color?.toUpperCase()] ?? part.color,
        part.obfuscated ? ChatColor.OBFUSCATED : '',
        part.bold ? ChatColor.BOLD : '',
        part.strikethrough ? ChatColor.STRIKETHROUGH : '',
        part.underline ? ChatColor.UNDERLINE : '',
        part.italic ? ChatColor.ITALIC : '',
      ]

      const extra = part.extra ? chat_to_text(part.extra) : ''

      return `${modifiers.join('')}${part.text ?? ''}${extra}${ChatColor.RESET}`
    })
    .join('')
}

/**
 * Compare effect of two chat components
 * @param {componentA: ChatComponent} componentA
 * @param {componentB: ChatComponent} componentB
 */
export function compare_effect_chat_component(componentA, componentB) {
  const modifiers = [
    'obfuscated',
    'bold',
    'strikethrough',
    'underline',
    'italic',
    'color',
    'reset',
  ]
  return modifiers.every((item) => componentA[item] === componentB[item])
}

/**
 * Split chat component
 * @param {component: ChatComponent | ChatComponent[]} components
 * @param {separator: string} separator
 */
export function split_chat_component(components, separator) {
  return to_array(components).flatMap((component) => {
    return component.text
      .split(separator)
      .map((item) => ({ ...component, text: item }))
  })
}

/**
 * Optimize chat components
 * @param {components: ChatComponent[]} component
 * @returns {ChatComponent[]}
 */
export function optimize_chat_component(components) {
  let last = null

  return components.reduce((acc, current) => {
    if (
      last &&
      typeof last === 'object' &&
      typeof current === 'object' &&
      compare_effect_chat_component(last, current)
    ) {
      last.text += current.text
    } else {
      acc.push(current)
      last = current
    }

    return acc
  }, [])
}
