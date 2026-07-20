// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, it } from 'bun:test'

import {
  DUNGEON_CEREMONY_FINISHED,
  DUNGEON_CEREMONY_STARTED,
  dungeon_dimension_reduce,
} from './dungeon_dimension_reducer.js'

const initial_state = (overrides = {}) => ({
  spawned_for: 'dungeon-1#0',
  ceremony_id: null,
  ...overrides,
})

describe('dungeon dimension ceremony input door', () => {
  it('folds a timeout rollback once and ignores its duplicate', () => {
    const started = dungeon_dimension_reduce(initial_state(), {
      type: DUNGEON_CEREMONY_STARTED,
      ceremony_id: 1,
    })
    const restored = dungeon_dimension_reduce(started, {
      type: DUNGEON_CEREMONY_FINISHED,
      ceremony_id: 1,
      restore: true,
      restore_key: 'dungeon-1#0',
    })

    expect(restored).toEqual({ spawned_for: null, ceremony_id: null })
    expect(
      dungeon_dimension_reduce(restored, {
        type: DUNGEON_CEREMONY_FINISHED,
        ceremony_id: 1,
        restore: true,
        restore_key: 'dungeon-1#0',
      })
    ).toBe(restored)
  })

  it('does not let a late timeout clear a newer ceremony or roster', () => {
    const current = initial_state({ spawned_for: 'dungeon-1#1', ceremony_id: 2 })

    expect(
      dungeon_dimension_reduce(current, {
        type: DUNGEON_CEREMONY_FINISHED,
        ceremony_id: 1,
        restore: true,
        restore_key: 'dungeon-1#0',
      })
    ).toBe(current)
  })
})
