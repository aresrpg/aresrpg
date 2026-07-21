// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { project_inventory_context_actions } from './inventory_context_actions'

describe('inventory context-menu action projection', () => {
  test('SEND joins equip and crush before the explorer escape hatch', () => {
    expect(project_inventory_context_actions(['equip', 'crush', 'explorer'])).toEqual([
      'equip',
      'crush',
      'send',
      'explorer',
    ])
  })

  test.each([
    ['pet', ['feed', 'explorer']],
    ['loot box', ['open', 'crush', 'explorer']],
    ['plain item', ['crush', 'explorer']],
  ] as const)('%s menus receive SEND exactly once', (_label, existing_actions) => {
    const actions = project_inventory_context_actions(existing_actions)

    expect(actions.filter((action) => action === 'send')).toHaveLength(1)
    expect(actions.at(-2)).toBe('send')
    expect(actions.at(-1)).toBe('explorer')
  })

  test('an already-projected list stays stable', () => {
    expect(project_inventory_context_actions(['equip', 'send', 'crush', 'explorer'])).toEqual([
      'equip',
      'crush',
      'send',
      'explorer',
    ])
  })

  test('a fast-slot item menu receives SEND without losing use or clear', () => {
    expect(project_inventory_context_actions(['use', 'clear'])).toEqual(['use', 'clear', 'send'])
  })
})
