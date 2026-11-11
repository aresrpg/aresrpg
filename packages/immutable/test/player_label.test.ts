// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import {
  application_suins_name,
  canonical_suins_name,
  chat_suins_prefix,
  display_suins_name,
} from '../src/player_label.ts'

test.each([
  ['sceat.sui', '@sceat'],
  ['child.sceat.sui', '@child.sceat'],
  ['sceat.sceat.sui', '@sceat.sceat'],
  ['child@sceat', '@child.sceat'],
  ['aresrpg.child.sceat.sui', '@child.sceat'],
  ['aresrpgagent.child.sceat.sui', '@child.sceat'],
  ['otheraresrpg.sceat.sui', '@otheraresrpg.sceat'],
  ['@Sceat', '@sceat'],
])('display preserves full relative names: %s', (name, expected) => {
  expect(display_suins_name(name)).toBe(expected)
})
test('application namespace classification is exact and needs no membership state', () => {
  expect(application_suins_name('aresrpgagent.child@sceat')).toEqual({ kind: 'agent', parent: 'child.sceat.sui' })
  expect(application_suins_name('aresrpg.sceat.sui')).toEqual({ kind: 'player', parent: 'sceat.sui' })
  expect(application_suins_name('otheraresrpgagent.sceat.sui')).toBeNull()
  expect(canonical_suins_name(' CHILD@SCEAT ')).toBe('child.sceat.sui')
  expect(chat_suins_prefix('aresrpg.child.sceat.sui')).toBe('(@child.sceat) ')
  expect(chat_suins_prefix(null)).toBe('')
})
