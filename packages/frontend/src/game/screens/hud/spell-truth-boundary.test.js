// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = (relative_path) => readFileSync(new URL(relative_path, import.meta.url), 'utf8')

test('DungeonBoard own-cast path dispatches one composite predicted batch with no legacy fanout', () => {
  const board = source('./world/DungeonBoardInput.jsx')
  const start = board.indexOf('const optimistic_cast')
  const end = board.indexOf('\n  const ', start + 1)
  const cast_path = board.slice(start, end)

  expect(start).toBeGreaterThan(-1)
  expect(cast_path.match(/type:\s*['"]predicted['"]/g) ?? []).toHaveLength(1)
  expect(cast_path).not.toContain('predict_cast_effects')
  expect(cast_path).not.toContain('synthetic_cast_events')
  expect(cast_path.match(/type:\s*['"]intent['"]/g) ?? []).toHaveLength(0)
})

// The sdk's generated spell corpus is DELETED (#2220) and kept dead as a class by
// packages/sdk/test/spell_truth_one_home.test.js — no bundled corpus, no package door, no ingesting file. What
// stays this file's business is the OTHER legacy feed: the checked-in `spellbook-seed.json` fixture, which the
// live fight projection must never read (it resolves through the served corpus blob alone).
test('live fight projection cannot import the legacy spellbook seed', () => {
  const fight_module = source('../../core/modules/fight.js')

  expect(fight_module).not.toContain('spellbook-seed.json')
})
