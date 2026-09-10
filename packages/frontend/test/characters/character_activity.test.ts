// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { CharacterRow } from '@aresrpg/protocol'

import { editable_character } from '../../src/characters/character_activity.ts'
import { initial_app_state } from '../../src/store.ts'

const idle = { id: '0xa', custody: 'kiosk', kiosk: '0xk', at_ms: 0 } as CharacterRow
const state_for = (character = idle) => {
  const state = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  return { ...state, session: { ...state.session, characters: [character], selected_character_id: character.id } }
}

test('fight custody, indexed seats, gathering roots and protectors make progression read-only', () => {
  for (const fields of [
    { custody: 'fight' },
    { active_fight: { id: '0xf', seat: 0 } },
    { at_ms: 2000 },
    { ambush: { protector: 'fuwa' } },
  ])
    expect(editable_character(state_for({ ...idle, ...fields } as CharacterRow), idle.id, 1000)).toBeNull()
  expect(editable_character(state_for(), 'missing', 1000)).toBeNull()
  expect(editable_character(state_for(), idle.id, 1000)).toBe(idle)
})

test('between-room preparation is available while the dungeon travel root remains active', () => {
  const character = { ...idle, dungeon_run: { dungeon: 'temple', room: 2 }, at_ms: 3_153_600_000_000 }
  expect(editable_character(state_for(character), character.id, 1000)).toBe(character)
  for (const fields of [{ custody: 'fight' }, { active_fight: { id: '0xf', seat: 0 } }, { ambush: {} }])
    expect(editable_character(state_for({ ...character, ...fields } as CharacterRow), character.id, 1000)).toBeNull()
})

test('optimistic gathering and dungeon/arena operations block before the chain projection catches up', () => {
  const state = state_for()
  expect(
    editable_character({ ...state, world: { ...state.world, gathering: { [idle.id]: {} as never } } }, idle.id, 1000)
  ).toBeNull()
  expect(
    editable_character(
      { ...state, dungeon: { ...state.dungeon, pending_by_character: { [idle.id]: 'enter' } } },
      idle.id,
      1000
    )
  ).toBeNull()
  expect(
    editable_character(
      { ...state, kolizeum: { ...state.kolizeum, pending_by_character: { [idle.id]: 'join' } } },
      idle.id,
      1000
    )
  ).toBeNull()
})

test('availability follows the displayed character, and a completed root unlocks progression', () => {
  const state = state_for({ ...idle, at_ms: 1000 })
  const other = { ...idle, id: '0xb', custody: 'fight' } as CharacterRow
  const multiple = {
    ...state,
    session: { ...state.session, characters: [...state.session.characters, other], selected_character_id: other.id },
  }
  expect(editable_character(multiple, idle.id, 1000)).toBe(state.session.characters[0]!)
  expect(editable_character(multiple, other.id, 1000)).toBeNull()
})
