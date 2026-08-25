// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { initial_app_state, reduce_app_state } from '../../src/store.ts'

test('a board-only chain-tail removal enables the admin write operation', () => {
  const initial = initial_app_state({
    quality: 'medium',
    flat_mode: false,
    music_enabled: true,
    render_distance: null,
  })
  const ready = Object.freeze({ ...initial, admin: Object.freeze({ ...initial.admin, status: 'ready' as const }) })
  const checked = reduce_app_state(ready, {
    type: 'admin/changes_checked',
    changes: {
      new_count: 0,
      changed: Object.freeze([]),
      board_removals: Object.freeze(['board #2']),
      removed: Object.freeze([]),
      fixed: Object.freeze([]),
      unchanged: 2,
      errors: Object.freeze([]),
    },
  })

  expect(reduce_app_state(checked, { type: 'admin/apply_changes' }).admin.operation).toEqual({ type: 'changes' })
})
