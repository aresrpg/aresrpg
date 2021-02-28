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

export const CommandNodeTypes = {
  ROOT_INDEX: 0,
  COMMAND: 1,
  ARGUMENT: 2,
}
