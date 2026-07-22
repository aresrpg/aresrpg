// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { project_inventory_context_actions } from './inventory_context_actions'

describe('inventory context-menu action projection', () => {
  test('a single stack hides both split and merge even when a matching sibling exists', () => {
    const stack = { id: '0xstack', template_id: '0xtemplate', amount: 1, stackable: true }
    const matching_stack = { id: '0xsibling', template_id: '0xtemplate', amount: 4, stackable: true }

    expect(
      project_inventory_context_actions(['split', 'merge', 'explorer'], {
        stack,
        stacks: [stack, matching_stack],
      })
    ).toEqual(['send', 'explorer'])
  })

  test('a non-stackable item never offers split', () => {
    const stack = { id: '0xgear', template_id: '0xgear-template', amount: 2, stackable: false }

    expect(project_inventory_context_actions(['split', 'explorer'], { stack, stacks: [stack] })).toEqual([
      'send',
      'explorer',
    ])
  })

  test('merge requires another stackable object from the exact same template', () => {
    const stack = { id: '0xstack', template_id: '0xtemplate', amount: 2, stackable: true }
    const wrong_template = { id: '0xwrong', template_id: '0xother-template', amount: 3, stackable: true }
    const non_stackable = { id: '0xgear', template_id: '0xtemplate', amount: 1, stackable: false }
    const matching_stack = { id: '0xmatching', template_id: '0xtemplate', amount: 4, stackable: true }

    expect(
      project_inventory_context_actions(['split', 'merge', 'explorer'], {
        stack,
        stacks: [stack, wrong_template, non_stackable],
      })
    ).toEqual(['split', 'send', 'explorer'])
    expect(
      project_inventory_context_actions(['split', 'merge', 'explorer'], {
        stack,
        stacks: [stack, matching_stack],
      })
    ).toEqual(['split', 'merge', 'send', 'explorer'])
  })

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
