// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { CharacterRow } from '@aresrpg/protocol'

import type { AuthSession } from '../../src/auth.ts'
import { character_deletion_blockers } from '../../src/characters/character_deletion.ts'
import { initial_app_state, reduce_app_state, type AppState } from '../../src/store.ts'
import { copy_text, load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'

const character = (overrides: Partial<CharacterRow> = {}): CharacterRow => ({
  id: '0xchar',
  name: 'Nox',
  classe: 'senshi',
  sex: 'male',
  experience: '0',
  level: 10,
  color_1: 0,
  color_2: 0,
  color_3: 0,
  vitality: 10,
  wisdom: 0,
  strength: 5,
  intelligence: 0,
  chance: 0,
  agility: 0,
  available_points: 12,
  spells: {},
  available_spell_points: 9,
  jobs: {},
  kiosk: '0xkiosk',
  equipment: [],
  ...overrides,
})

const wallet = { address: 'owner' } as AuthSession
const ready = (rows: readonly CharacterRow[] = [character()]): AppState => {
  const state = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  return {
    ...state,
    session: {
      ...state.session,
      wallet,
      characters: rows,
      selected_character_id: rows[0]?.id ?? null,
      link_status: 'ready',
      game_frozen: false,
      indexing_lag: 0,
    },
  }
}

test('blocks all equipment slots, fight custody, Party, dungeon, protector and listings', () => {
  const row = character({
    equipment: [{ slot: 'cosmetic_hat' } as never],
    custody: 'fight',
    dungeon_run: { dungeon: 'temple', room: 0 },
    ambush: {} as never,
  })
  const state = ready([row])
  const blocked = {
    ...state,
    party: { ...state.party, party_by_character: { [row.id]: 'party' } },
    marketplace: { ...state.marketplace, own_listings: [{ id: row.id } as never] },
  }
  expect(character_deletion_blockers(blocked, row.id)).toEqual([
    'delete_equipment',
    'delete_fight',
    'delete_party',
    'delete_dungeon',
    'delete_ambush',
    'delete_listing',
  ])
  expect(character_deletion_blockers(ready(), row.id)).toEqual([])
  expect(character_deletion_blockers(ready(), 'missing')).toEqual(['delete_unavailable'])
})

test('disabled while frozen, disconnected or waiting on indexing', () => {
  const state = ready()
  for (const patch of [{ game_frozen: true }, { indexing_lag: null }, { indexing_lag: 301 }, { wallet: null }]) {
    expect(character_deletion_blockers({ ...state, session: { ...state.session, ...patch } }, '0xchar')).toContain(
      'delete_unavailable'
    )
  }
})

test('confirmed deletion selects a survivor and stale snapshots cannot resurrect it', () => {
  const rows = [character(), character({ id: 'survivor' })]
  const deleted = reduce_app_state(ready(rows), { type: 'character/deleted', character_id: rows[0]!.id, wallet })
  expect(deleted.session.selected_character_id).toBe('survivor')
  const stale = reduce_app_state(deleted, {
    type: 'server/packet',
    packet: { type: 'packet/characters', characters: rows },
  })
  expect(stale.session.characters.map(({ id }) => id)).toEqual(['survivor'])
  const empty = reduce_app_state(stale, { type: 'character/deleted', character_id: 'survivor', wallet })
  expect(empty.session.characters).toEqual([])
  expect(empty.session.selected_character_id).toBeNull()
})

test('old wallet completions cannot delete the new session roster', () => {
  const state = ready()
  const next = reduce_app_state(state, { type: 'character/deleted', character_id: '0xchar', wallet: { ...wallet } })
  expect(next.session).toBe(state.session)
  const disconnected = reduce_app_state(
    reduce_app_state(state, { type: 'character/deleted', character_id: '0xchar', wallet }),
    { type: 'auth/disconnected' }
  )
  expect(disconnected.session.deleted_character_ids).toEqual([])
})

test('every locale discloses permanent deletion and the non-refundable creation fee', async () => {
  for (const { code } of LOCALES) {
    const { characters_page: copy } = await load_app_copy(code)
    expect(typeof copy.delete_warning).toBe('string')
    expect(copy.delete_warning).not.toBe('')
    expect(copy_text(copy)('delete_no_refund', { amount: '1' })).toContain('1 SUI')
    for (const key of [
      'delete_character',
      'delete_equipment',
      'delete_fight',
      'delete_party',
      'delete_dungeon',
      'delete_ambush',
      'delete_listing',
      'delete_unavailable',
      'delete_pending',
    ]) {
      expect(typeof copy[key]).toBe('string')
      expect(copy[key]).not.toBe('')
    }
  }
})
