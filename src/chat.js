/**
 * Take a string or a chat component as an input and output a chat component
 */
export function normalize_chat_component(component) {
  if (!component) return [{ text: '' }]
  if (typeof component === 'string') return [{ text: component }]
  if (!Array.isArray(component)) return [component]
  return component
}

export const MAGIC_RESET = '§r'
