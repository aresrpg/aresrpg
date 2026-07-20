// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = (relative_path) => readFileSync(new URL(relative_path, import.meta.url), 'utf8')

test('DungeonBoard own-cast path dispatches one composite predicted batch with no legacy fanout', () => {
  const board = source('./world/DungeonBoard.jsx')
  const start = board.indexOf('const optimistic_cast')
  const end = board.indexOf('\n  const ', start + 1)
  const cast_path = board.slice(start, end)

  expect(start).toBeGreaterThan(-1)
  expect(cast_path.match(/type:\s*['"]predicted['"]/g) ?? []).toHaveLength(1)
  expect(cast_path).not.toContain('predict_cast_effects')
  expect(cast_path).not.toContain('synthetic_cast_events')
  expect(cast_path.match(/type:\s*['"]intent['"]/g) ?? []).toHaveLength(0)
})

test('live fight projection cannot import either legacy spell feed', () => {
  const fight_module = source('../../core/modules/fight.js')
  const eslint_config = source('../../../../../../eslint.config.js')

  expect(fight_module).not.toContain('@aresrpg/sdk/spells')
  expect(fight_module).not.toContain('spellbook-seed.json')
  expect(eslint_config).toContain("name: '@aresrpg/sdk/spells'")
})
