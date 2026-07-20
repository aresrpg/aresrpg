import { beforeEach, describe, expect, it } from 'bun:test'

import { character_cast_clock, use_dungeon_turn } from './dungeon-turn.js'

beforeEach(() => use_dungeon_turn.getState().reset_character_cast_clocks())

// The seat-turn counter (my_turn_no) moved to the fight core; this store keeps only the per-character last-cast
// record. A shared spell's cooldown must stay independent per controlled character (char-a casting it does not
// put char-b's copy on cooldown).
describe('character-keyed last-cast record', () => {
  it('keeps same-spell last-cast turns independent across two controlled characters', () => {
    const state = use_dungeon_turn.getState()
    state.record_character_cast_turns('char-a', { shared_spell: 2 })

    expect(character_cast_clock(use_dungeon_turn.getState(), 'char-a')).toEqual({
      last_cast_turn: { shared_spell: 2 },
    })
    // char-b never cast it → its own record stays empty (the cooldown is per-character).
    expect(character_cast_clock(use_dungeon_turn.getState(), 'char-b')).toEqual({
      last_cast_turn: {},
    })
  })

  it('updates only the named character and resets all records at a fresh fight boundary', () => {
    const state = use_dungeon_turn.getState()
    state.record_character_cast_turns('char-b', { spell_b: 1 })
    expect(character_cast_clock(use_dungeon_turn.getState(), 'char-a').last_cast_turn).toEqual({})

    state.reset_character_cast_clocks()
    expect(character_cast_clock(use_dungeon_turn.getState(), 'char-b').last_cast_turn).toEqual({})
  })
})
