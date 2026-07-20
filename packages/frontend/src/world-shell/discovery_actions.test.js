// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

const source = readFileSync(new URL('./discovery_actions.js', import.meta.url), 'utf8')

test('search_zone routes through the terminal-random keep-budget door', () => {
  expect(source).toContain("import { run_tx_random } from './tx.js'")
  expect(source).toContain(".then((tx) => run_tx_random('search_zone', tx))")
  expect(source).not.toContain(".then((tx) => run_tx('search_zone', tx))")
})
