// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

const source = readFileSync(new URL('./discovery_actions.js', import.meta.url), 'utf8')
const prompts_source = readFileSync(new URL('../game/screens/hud/world/DiscoveryPrompts.jsx', import.meta.url), 'utf8')

test('search_zone routes through the terminal-random keep-budget door', () => {
  expect(source).toContain("import { run_tx_random } from './tx.js'")
  expect(source).toContain("run_tx_random('search_zone', tx, undefined, {")
  expect(source).toContain('on_executed:')
  expect(source).toContain("spawns_input({ type: 'zone_rows'")
  const executed_at = source.indexOf('on_executed:')
  const finality_at = source.indexOf("type: 'zone_searched'")
  expect(executed_at).toBeGreaterThan(-1)
  expect(finality_at).toBeGreaterThan(executed_at)
  expect(source).not.toContain(".then((tx) => run_tx('search_zone', tx))")
})

test('search progress is visible from press while the executed projection races finality', () => {
  expect(prompts_source).toContain('push_progress_toast')
  expect(source).toContain("spawns_input({ type: 'search_intent', x, z })")
  expect(prompts_source.indexOf('push_progress_toast')).toBeLessThan(prompts_source.indexOf('await search_zone'))
})
