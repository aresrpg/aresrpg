// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { existsSync } from 'node:fs'

import { expect, test } from 'bun:test'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'

import { initial_app_state, reduce_app_state, type AppState } from '../../src/store.ts'
import journey from '../../src/modules/journey.ts'
import {
  complete_quests,
  completed_quests_from,
  initial_journey_state,
  JOURNEY_QUESTS,
  next_quest,
} from '../../src/journey/model.ts'
import { action_quest_ids, owned_quest_ids, won_dungeon } from '../../src/journey/facts.ts'
import { content_catalog } from '../../src/content/catalog.ts'
import { LOCALES } from '../../src/i18n/locale.ts'
import { copy_text, load_app_copy } from '../../src/i18n/copy.ts'
import type { FightResult } from '../../src/modules/fight_result.ts'

const base = (): AppState =>
  initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
const item = (item_type: string, amount = 1): ItemRow => ({
  id: item_type,
  item_type,
  amount,
  kiosk: 'kiosk',
  name: item_type,
  category: 'resource',
  level: 1,
})
const character = { id: 'hero', equipment: [] } as unknown as CharacterRow
const connect = (state: AppState, address: string): AppState =>
  reduce_app_state(
    reduce_app_state(reduce_app_state(state, { type: 'auth/disconnected' }), { type: 'auth/connecting' }),
    {
      type: 'auth/connected',
      session: { address } as never,
    }
  )
const scoped = (): AppState => connect(base(), 'account-a')
const loaded = (): AppState => {
  const state = scoped()
  return journey.reduce(state, {
    type: 'journey/loaded',
    identity: state.journey.identity!,
    generation: state.journey.generation,
    completed: ['welcome'],
  })
}

test('malformed saved IDs are discarded; completion is ordered, permanent, and replay-safe', () => {
  expect(completed_quests_from(null)).toEqual([])
  expect(completed_quests_from(['suize', 'hoe', 'hoe', {}, 'unknown'])).toEqual(['hoe', 'suize'])
  const state = complete_quests(initial_journey_state(), ['hoe'])
  expect(complete_quests(state, ['hoe'])).toBe(state)
  expect(state.celebrations).toEqual(['hoe'])
  expect(next_quest(['welcome', 'hoe'])?.id).toBe('wheat')
  expect(next_quest(JOURNEY_QUESTS.map(({ id }) => id))).toBeNull()
})

test('late hydration cannot overwrite reset or another account; loading never celebrates old achievements', () => {
  const state = loaded()
  expect(state.journey.celebrations).toEqual([])
  const done = journey.reduce(state, { type: 'journey/completed', ids: ['hoe', 'token'] })
  expect(done.journey.celebrations).toEqual(['hoe', 'token'])
  const reset = journey.reduce(done, { type: 'journey/reset' })
  expect(reset.journey.completed).toEqual([])
  expect(reset.journey.celebrations).toEqual([])
  expect(
    journey.reduce(reset, {
      type: 'journey/loaded',
      identity: state.journey.identity!,
      generation: state.journey.generation,
      completed: ['hoe'],
    })
  ).toBe(reset)
  const switched = connect(done, 'account-b')
  expect(
    journey.reduce(switched, {
      type: 'journey/loaded',
      identity: state.journey.identity!,
      generation: state.journey.generation,
      completed: ['hoe'],
    })
  ).toBe(switched)
})

test('completion requires a started journey; Continue opens the journal without changing completion', () => {
  expect(journey.reduce(scoped(), { type: 'journey/start' }).journey.completed).toEqual([])
  const state = loaded()
  const done = journey.reduce(state, { type: 'journey/completed', ids: ['hoe'] })
  const acknowledged = journey.reduce(done, { type: 'journey/acknowledged' })
  expect(acknowledged.journey.completed).toEqual(['welcome', 'hoe'])
  expect(acknowledged.journey.celebrations).toEqual([])
  expect(acknowledged.journey.journal_open).toBe(true)
})

test('ownership counts inventory and equipped items, but purchased resources never count as harvesting', () => {
  const state = base()
  const owned = {
    ...state,
    session: {
      ...state.session,
      inventory: [item('old_hoe'), item('wheat'), item('croissant', 0)],
      characters: [{ ...character, equipment: [{ ...item('rootglass_token'), slot: 'amulet' }] }],
    },
  }
  expect(owned_quest_ids(owned)).toEqual(['hoe', 'token'])
  expect(action_quest_ids(owned, state)).toEqual([])
})

test('only a newly confirmed positive harvest completes wheat or Suize; duplicates and failures do not', () => {
  const state = { ...base(), session: { ...base().session, characters: [character] } }
  const gathering = {
    attempt_id: 'a',
    character_id: 'hero',
    item_type: 'wheat_suize',
    protector: '',
    started_at_ms: 0,
    duration_ms: 1,
    ends_at_ms: 1,
    confirmed: false,
    authoritative: false,
    ambushed: false,
    quantity: null,
  }
  const pending = { ...state, world: { ...state.world, gathering: { hero: gathering } } }
  expect(action_quest_ids(pending, state)).toEqual([])
  const confirmed = {
    ...pending,
    world: { ...pending.world, gathering: { hero: { ...gathering, confirmed: true, quantity: 1 } } },
  }
  expect(action_quest_ids(confirmed, pending)).toEqual(['suize'])
  expect(action_quest_ids(confirmed, confirmed)).toEqual([])
  expect(
    action_quest_ids(
      {
        ...confirmed,
        world: { ...confirmed.world, gathering: { hero: { ...gathering, confirmed: true, quantity: 0 } } },
      },
      pending
    )
  ).toEqual([])
})

test('dungeon completion requires a settled final-room win by an owned, non-forfeiting participant', () => {
  const result = {
    fight: 'fight',
    dungeon: { dungeon: 'gilded_lorito', room: content_catalog.dungeon('gilded_lorito')!.rooms.length },
    winner: 0,
    settlement_confirmed: true,
    participants: [{ character_id: 'hero', team: 0, forfeited: false }],
  } as unknown as FightResult
  expect(won_dungeon({ ...result, settlement_confirmed: false }, ['hero'])).toBeNull()
  expect(won_dungeon({ ...result, winner: 1 }, ['hero'])).toBeNull()
  expect(won_dungeon({ ...result, dungeon: { dungeon: 'gilded_lorito', room: 1 } }, ['hero'])).toBeNull()
  expect(won_dungeon(result, ['spectator'])).toBeNull()
  expect(
    won_dungeon({ ...result, participants: [{ ...result.participants[0]!, forfeited: true }] }, ['hero'])
  ).toBeNull()
  expect(won_dungeon(result, ['hero'])).toBe('gilded_lorito')
  const state = { ...base(), session: { ...base().session, characters: [character] } }
  const won = { ...state, fight_result: { ...state.fight_result, current_by_character: { hero: result } } }
  expect(action_quest_ids(won, state)).toEqual(['lorito'])
  expect(action_quest_ids(won, won)).toEqual([])
})

test('authored quest IDs, referenced items, HD art, and all supported translations are complete', async () => {
  expect(new Set(JOURNEY_QUESTS.map(({ id }) => id)).size).toBe(JOURNEY_QUESTS.length)
  for (const quest of JOURNEY_QUESTS) {
    expect(content_catalog.item(quest.item)).not.toBeNull()
    expect(existsSync(`${import.meta.dir}/../../../../seed/icons/items/${quest.item}_hd.png`)).toBe(true)
  }
  const copies = await Promise.all(LOCALES.map(({ code }) => load_app_copy(code)))
  for (const copy of copies) {
    const text = copy_text(copy.journey)
    expect(text('count', { count: 1, total: 10 })).toBe('1 / 10')
    expect(text('hoe_objective', { item: 'Scrap Hoe' })).toContain('Scrap Hoe')
    expect(Object.keys(copy.journey).sort()).toEqual(Object.keys(copies[0]!.journey).sort())
    for (const { id, chapter, kind } of JOURNEY_QUESTS) {
      expect(copy.journey[`${id}_title`]).toBeTruthy()
      expect(copy.journey[`${id}_body`]).toBeTruthy()
      expect(copy.journey[`chapter_${chapter}`]).toBeTruthy()
      if (kind !== 'start') expect(copy.journey[`${id}_objective`]).toBeTruthy()
    }
  }
})

test('resetting completed quests stops automation in the same app fold', () => {
  const state = loaded()
  const completed = reduce_app_state(state, {
    type: 'journey/loaded',
    identity: state.journey.identity!,
    generation: state.journey.generation,
    completed: JOURNEY_QUESTS.map(({ id }) => id),
  })
  const running = {
    ...completed,
    automation: {
      ...completed.automation,
      run: {
        id: 'run',
        character_id: 'hero',
        world: 'nauvis',
        item_type: 'wheat',
        scope: { type: 'world' },
        visited: {},
        step: { type: 'planning' },
      },
    },
  } as AppState
  expect(reduce_app_state(running, { type: 'journey/reset' }).automation.run).toBeNull()
})
