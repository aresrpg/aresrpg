// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'
import { K_INVISIBILITY } from '@aresrpg/sim/spell_effect'

import {
  MOB_FIGHTER_ID_BASE,
  new_invisibility_statuses,
  read_fighter_statuses,
  status_snapshot_entities,
} from '../src/fight_status_snapshot.js'

test('the mob fighter-id base stays pinned to the Move chain home', () => {
  const retro_effects = readFileSync(new URL('../../move/engine/sources/retro_effects.move', import.meta.url), 'utf8')
  const mob_fid_match = /const MOB_FID_BASE: u64 = ([0-9_]+);/.exec(retro_effects)
  expect(mob_fid_match, 'retro_effects.move no longer declares MOB_FID_BASE').not.toBeNull()
  expect(Number(mob_fid_match[1].replaceAll('_', ''))).toBe(MOB_FIGHTER_ID_BASE)
})

describe('authoritative fight status snapshot', () => {
  test('reads ALL live status rows from raw Fight.fx json — every kind, with effect ints', () => {
    expect(
      read_fighter_statuses({
        fx: {
          statuses: [
            { fighter: '0', kind: String(K_INVISIBILITY), remaining_turns: '2', effect: {} },
            { fighter: '1001', kind: 4, remaining_turns: 3, effect: { element: 2, value: 5 } }, // non-27 now KEPT
            { fields: { fighter: '1', remaining_turns: '1', effect: { fields: { kind: 27 } } } },
            { fighter: '2', kind: 27, remaining_turns: 0, effect: {} }, // #2000: LAST covered turn → still read
          ],
        },
      })
    ).toEqual([
      { fighter: 0, kind: 27, remaining_turns: 2, element: null, value: null, stat: null, chance: null, source: null },
      { fighter: 1001, kind: 4, remaining_turns: 3, element: 2, value: 5, stat: null, chance: null, source: null },
      { fighter: 1, kind: 27, remaining_turns: 1, element: null, value: null, stat: null, chance: null, source: null },
      { fighter: 2, kind: 27, remaining_turns: 0, element: null, value: null, stat: null, chance: null, source: null },
    ])
  })

  test('maps player seats and mob fighter ids, preserving EACH status row (no collapse)', () => {
    expect(
      status_snapshot_entities(
        [
          { fighter: 1, kind: 27, remaining_turns: 1 },
          { fighter: 1, kind: 9, remaining_turns: 3, stat: 2 },
          { fighter: 1000, kind: 27, remaining_turns: 2 },
          { fighter: 1004, kind: 27, remaining_turns: 2 }, // mob idx 4 ≥ mob_count → dropped
        ],
        ['hero', 'ally'],
        2
      )
    ).toEqual([
      {
        entity_id: 'ally',
        kind: 27,
        remaining_turns: 1,
        element: null,
        value: null,
        stat: null,
        chance: null,
        source: null,
      },
      {
        entity_id: 'ally',
        kind: 9,
        remaining_turns: 3,
        element: null,
        value: null,
        stat: 2,
        chance: null,
        source: null,
      },
      {
        entity_id: 'mob-0',
        kind: 27,
        remaining_turns: 2,
        element: null,
        value: null,
        stat: null,
        chance: null,
        source: null,
      },
    ])
  })

  test('detects first application and duration refresh, but not ordinary expiry', () => {
    const before = [
      { entity_id: 'hero', remaining_turns: 3 },
      { entity_id: 'ally', remaining_turns: 1 },
    ]
    expect(
      new_invisibility_statuses(
        [
          { entity_id: 'hero', remaining_turns: 2 },
          { entity_id: 'ally', remaining_turns: 3 },
          { entity_id: 'remote', remaining_turns: 2 },
        ],
        before
      )
    ).toEqual([
      { entity_id: 'ally', remaining_turns: 3 },
      { entity_id: 'remote', remaining_turns: 2 },
    ])
  })
})
