// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { equip_preflight, project_inventory_context_actions } from './inventory_context_actions'

const item_template_map = (id: string, level: number) => new Map([[id, { id, level }]])

describe('equip pre-flight mirrors the executable equipment.move door', () => {
  test('refuses a category that Move cannot map to an equipment kind', () => {
    expect(
      equip_preflight({
        item: { id: '0xore', item_category: 'resource', template_id: '0xore-template' },
        character_level: 200,
        template_id_map: item_template_map('0xore-template', 1),
      })
    ).toEqual({ allowed: false, reason: 'errors.equip_not_equippable' })
  })

  test('refuses a client target slot that disagrees with Move-derived category placement', () => {
    const helmet = { id: '0xhelmet', item_category: 'helmet', template_id: '0xhelmet-template' }
    const common = {
      item: helmet,
      character_level: 10,
      template_id_map: item_template_map('0xhelmet-template', 1),
    }

    expect(equip_preflight({ ...common, slot: 'boots' })).toEqual({
      allowed: false,
      reason: 'errors.equip_wrong_slot',
    })
    expect(equip_preflight({ ...common, slot: 'helmet' })).toEqual({ allowed: true, reason: null })
  })

  test('reads required level from the exact authenticated template, never the scribed instance display level', () => {
    const item = {
      id: '0xsword',
      item_category: 'longsword',
      item_type: 'longsword',
      template_id: '0xsword-template',
      level: 1,
    }

    expect(
      equip_preflight({
        item,
        character_level: 5,
        template_id_map: item_template_map('0xsword-template', 6),
      })
    ).toEqual({ allowed: false, reason: 'errors.equip_level_too_low' })
    expect(
      equip_preflight({
        item: { ...item, level: 99 },
        character_level: 6,
        template_id_map: item_template_map('0xsword-template', 6),
      })
    ).toEqual({ allowed: true, reason: null })
  })

  test('an unknown character level fails open instead of inventing a level refusal', () => {
    expect(
      equip_preflight({
        item: { id: '0xsword', item_category: 'longsword', template_id: '0xsword-template' },
        character_level: null,
        template_id_map: item_template_map('0xsword-template', 6),
      })
    ).toEqual({ allowed: true, reason: null })
  })

  test('an unresolved exact template fails open instead of borrowing a same-type sibling level', () => {
    expect(
      equip_preflight({
        item: {
          id: '0xsword',
          item_category: 'longsword',
          item_type: 'longsword',
          template_id: '0xmissing-template',
        },
        character_level: 1,
        template_id_map: new Map(),
        template_map: new Map([['longsword', { id: '0xsibling-template', level: 200 }]]),
      })
    ).toEqual({ allowed: true, reason: null })
  })

  test('refuses a duplicate relic template that would remain equipped after this staged placement', () => {
    const equipped_relic = {
      id: '0xequipped-relic',
      item_category: 'relic',
      template_id: '0xrelic-template',
    }
    const next_relic = { id: '0xnext-relic', item_category: 'relic', template_id: '0xrelic-template' }
    const common = {
      item: next_relic,
      character_level: 10,
      template_id_map: item_template_map('0xrelic-template', 1),
      equipment: { relic_1: equipped_relic, relic_2: null },
    }

    expect(equip_preflight(common)).toEqual({ allowed: false, reason: 'errors.equip_relic_duplicate' })
    expect(equip_preflight({ ...common, slot: 'relic_1' })).toEqual({ allowed: true, reason: null })
  })

  test('cross-class weapons stay legal because Move intentionally makes weapon families universal', () => {
    expect(
      equip_preflight({
        item: { id: '0xclub', item_category: 'club', template_id: '0xclub-template' },
        character_class: 'senshi',
        character_level: 1,
        template_id_map: item_template_map('0xclub-template', 1),
      })
    ).toEqual({ allowed: true, reason: null })
  })
})

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
