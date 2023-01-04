// https://wiki.vg/Command_Data#Properties
export const ParserProperties = {
  string: {
    SINGLE_WORD: 0, // Reads a single word
    QUOTABLE_PHRASE: 1, // If it starts with a ", keeps reading until another " (allowing escaping with \). Otherwise behaves the same as SINGLE_WORD
    GREEDY_PHRASE: 2, // Reads the rest of the content after the cursor. Quotes will not be removed.
  },
  entity: {
    ALL: 0x01, // If set, only allows a single entity/player
    PLAYER: 0x02, // If set, only allows players
  },
}

// https://wiki.vg/Command_Data#Graph_Structure
export const CommandNodeTypes = {
  ROOT: 0,
  LITERAL: 1,
  ARGUMENT: 2,
}

export function literal({ value, flags = {}, children = [] }) {
  return {
    flags: {
      command_node_type: CommandNodeTypes.LITERAL,
      ...flags,
    },
    extraNodeData: { name: value },
    children,
  }
}

export function string({ name, properties, flags = {}, children = [] }) {
  return {
    flags: {
      command_node_type: CommandNodeTypes.ARGUMENT,
      ...flags,
    },
    extraNodeData: {
      name,
      parser: 'brigadier:string',
      properties,
    },
    children,
  }
}

export function entity({ name, properties, flags = {}, children = [] }) {
  return {
    flags: {
      command_node_type: CommandNodeTypes.ARGUMENT,
      ...flags,
    },
    extraNodeData: {
      name,
      parser: 'minecraft:entity',
      properties,
    },
    children,
  }
}

const number =
  type =>
  ({ name, min = null, max = null, flags = {}, children = [] }) => ({
    flags: {
      command_node_type: CommandNodeTypes.ARGUMENT,
      ...flags,
    },
    extraNodeData: {
      name,
      parser: `brigadier:${type}`,
      properties: {
        flags: { min_present: min !== null, max_present: max !== null },
        min,
        max,
      },
    },
    children,
  })

export const double = number('double')
export const float = number('float')
export const integer = number('integer')
export const long = number('long')
