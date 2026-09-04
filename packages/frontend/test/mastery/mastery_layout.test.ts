// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

test('mastery offers use an equal-height shop grid without timeline dressing', () => {
  const source = readFileSync(new URL('../../src/mastery/MasteryPage.tsx', import.meta.url), 'utf8')

  expect(source).toContain('data-mastery-shop=""')
  expect(source).toContain('sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4')
  expect(source).toContain('data-mastery-offer={state.item_type}')
  expect(source).toContain('flex h-full min-h-56 flex-col')
  expect(source).toContain("type: 'path/open', pathname: encyclopedia_item_path(state.item_type)")
  expect(source).toContain("text('quest_objective_before')")
  expect(source).toContain("text('quest_objective_after')")
  expect(source).toContain('border-gold/55 bg-gold/12 px-3 py-1')
  expect(source).toContain('style={world_art_style(quest_world_card?.art)}')
  expect(source).not.toContain("text('progression')")
  expect(source).not.toContain("text('unlock")
  expect(source).not.toContain('md:left-1/2')
  expect(source).not.toContain('index % 2')
})
