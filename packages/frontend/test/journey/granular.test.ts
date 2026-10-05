// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { create_character_source, create_fight_state } from '@aresrpg/fight'

import type { FightResult } from '../../src/modules/fight_result.ts'
import { initial_app_state } from '../../src/store.ts'
import { owned_quest_ids, action_quest_ids, quest_changes } from '../../src/journey/facts.ts'
import { relevant_quests, next_quest, journey_complete, JOURNEY_QUESTS } from '../../src/journey/model.ts'
import { content_catalog } from '../../src/content/catalog.ts'
import { to_mob_template } from '../../src/content/fight_sources.ts'
import { merge_checkpoint } from '../../src/modules/fight_result.ts'

const base = () => initial_app_state({ quality: 'medium', music_enabled: true, render_distance: null })

test('split existing stacks satisfy the materials step only when the recipe is complete', () => {
  const initial = base()
  const state = {
    ...initial,
    session: {
      ...initial.session,
      selected_character_id: 'hero',
      characters: [{ id: 'hero', kiosk: 'k', equipment: [] }] as never,
    },
  }
  const inventory = [
    { id: 'branch-a', kiosk: 'k', item_type: 'gnawed_branch', amount: 1 },
    { id: 'branch-b', kiosk: 'k', item_type: 'gnawed_branch', amount: 2 },
    { id: 'scrap', kiosk: 'k', item_type: 'salvaged_scrap', amount: 2 },
  ] as never
  expect(owned_quest_ids({ ...state, session: { ...state.session, inventory } })).toContain('hoe_materials')
  expect(
    owned_quest_ids({
      ...state,
      session: { ...state.session, inventory: [{ item_type: 'gnawed_branch', amount: 3 }] as never },
    })
  ).not.toContain('hoe_materials')
})

test('a certified failed craft completes practice once; a restored result never counts', () => {
  const before = base()
  const after = {
    ...before,
    session: {
      ...before.session,
      craft_result: { digest: 'attempt', attempts: 1, successes: 0, output_type: 'old_hoe' },
    },
  }
  expect(action_quest_ids(after, before)).toContain('first_craft')
  expect(action_quest_ids(after, after)).toEqual([])
})

test('a Tinker hunt requires an owned settled win; spectators, losses and duplicates do not count', () => {
  const before = base()
  const state = { ...before, session: { ...before.session, characters: [{ id: 'hero' }] as never } }
  const result = {
    fight: 'f',
    dungeon: null,
    winner: 0,
    settlement_confirmed: true,
    defeated_mob_types: ['tinker'],
    participants: [{ character_id: 'hero', team: 0, forfeited: false }],
  } as unknown as FightResult
  const won = { ...state, fight_result: { ...state.fight_result, current_by_character: { hero: result } } }
  expect(action_quest_ids(won, state)).toContain('first_hunt')
  const awaiting_roster = {
    ...won,
    fight_result: {
      ...won.fight_result,
      current_by_character: {
        hero: { ...result, defeated_mob_types: undefined },
      },
    },
  }
  expect(action_quest_ids(won, awaiting_roster)).toContain('first_hunt')
  expect(action_quest_ids(won, won)).toEqual([])
  expect(action_quest_ids({ ...won, session: { ...won.session, characters: [] } }, before)).toEqual([])
  expect(
    action_quest_ids(
      {
        ...won,
        fight_result: {
          ...won.fight_result,
          current_by_character: { hero: { ...won.fight_result.current_by_character.hero, winner: 1 } },
        },
      },
      state
    )
  ).toEqual([])
})

test('the Hoe milestone retires unfinished introductory steps without inventing completions', () => {
  expect(next_quest(['welcome'])?.id).toBe('map_travel')
  expect(next_quest(['welcome', 'map_travel'])?.id).toBe('first_hunt')
  expect(next_quest(['welcome', 'map_travel', 'first_hunt'])?.id).toBe('hoe_materials')
  expect(next_quest(['welcome', 'hoe'])?.id).toBe('wheat')
  expect(relevant_quests(['welcome', 'hoe']).some(({ id }) => id === 'first_craft')).toBeFalse()
  expect(
    journey_complete({
      ...base().journey,
      identity: 'old-account',
      ready: true,
      completed: JOURNEY_QUESTS.filter(({ superseded_by }) => !superseded_by).map(({ id }) => id),
    })
  ).toBeTrue()
})

test('buying the Hoe skips unnecessary preparation without celebrating actions the player did not perform', () => {
  const before = base()
  const owned = {
    ...before,
    journey: { ...before.journey, ready: true, completed: ['welcome'] },
    session: {
      ...before.session,
      roster_loaded: true,
      inventory: [
        { item_type: 'old_hoe', amount: 1 },
        { item_type: 'gnawed_branch', amount: 3 },
        { id: 'scrap', kiosk: 'k', item_type: 'salvaged_scrap', amount: 2 },
      ] as never,
    },
  }
  expect(quest_changes(owned, before)).toEqual(['hoe'])
})

test('terminal result projection retains enemy mob identities, excluding allied mobs', () => {
  const checkpoint = create_fight_state({
    players: [
      { character: 'hero', owner: 'owner', team: 0n, hp: 100n, source: create_character_source({ classe: 'senshi' }) },
    ],
    mobs: [
      { team: 1n, scalar: 50n, template: to_mob_template(content_catalog.mob('tinker')!.mob) },
      { team: 0n, scalar: 50n, template: to_mob_template(content_catalog.mob('nook')!.mob) },
    ],
  })
  const terminal = {
    ...checkpoint,
    contract: {
      ...checkpoint.contract,
      ended: true,
      winner: 0n,
      fighters: checkpoint.contract.fighters.map((fighter) => ({
        ...fighter,
        dead: fighter.kind.type === 'mob',
        settled: true,
      })),
    },
  }
  expect(merge_checkpoint(base(), 'hero', terminal, 1000, 0n)?.defeated_mob_types).toEqual(['tinker'])
})
