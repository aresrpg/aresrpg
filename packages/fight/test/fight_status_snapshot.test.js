// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  INVISIBILITY_STATUS_KIND,
  new_invisibility_statuses,
  read_fighter_statuses,
  status_snapshot_entities,
} from '../src/fight_status_snapshot.js'

describe('authoritative fight status snapshot', () => {
  test('reads ALL live status rows from raw Fight.fx json — every kind, with effect ints', () => {
    expect(
      read_fighter_statuses({
        fx: {
          statuses: [
            { fighter: '0', kind: String(INVISIBILITY_STATUS_KIND), remaining_turns: '2', effect: {} },
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
