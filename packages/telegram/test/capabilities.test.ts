// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { ZONE_RESEARCH_TTL_MS } from '@aresrpg/protocol'

import { select_owned_item } from '../../bot/src/behavior_items.ts'
import { validate_gameplay } from '../../bot/src/gameplay.ts'
import { select_discovery } from '../../bot/src/behavior_world.ts'
import { profession_context, item } from '../../bot/test/helpers/profession_fixture.ts'
import items from '../../../seed/content/items.json'

// Capability evidence for the unavailable adaptive preset; these do not submit a partial strategy.
test('canonical owned-item selector equips available tools across every gathering job, and respects custody', () => {
  for (const category of ['tool_farmer', 'tool_herbalist', 'tool_miner']) {
    const tool = items.find((row) => row.category === category)!
    const context = profession_context()
    const character = { ...context.snapshot.characters[0]!, level: 200, equipment: [] }
    const owned = { ...item(tool.item_type, 1), category, level: tool.level }
    const ready = {
      ...context,
      snapshot: {
        ...context.snapshot,
        characters: [character],
        inventory: { ...context.snapshot.inventory!, items: [owned] },
      },
    }
    const action = {
      type: 'equip_owned' as const,
      character_id: character.id,
      item_type: tool.item_type,
      slot: 'tool' as const,
      order: 'lowest_id' as const,
    }
    const selected = select_owned_item(action, ready)
    expect(selected.status).toBe('action')
    if (selected.status !== 'action') throw new Error('expected equipment action')
    expect(validate_gameplay({ ...ready, command: { ...ready.command, ...selected.action } }).kind).toBe('equip_item')
    const equipped = {
      ...ready,
      snapshot: {
        ...ready.snapshot,
        characters: [{ ...character, equipment: [{ ...owned, slot: 'tool' as const }] }],
        inventory: { ...ready.snapshot.inventory, items: [] },
      },
    }
    expect(select_owned_item(action, equipped)).toEqual({ status: 'success' })
    const foreign = {
      ...ready,
      snapshot: {
        ...ready.snapshot,
        inventory: { ...ready.snapshot.inventory, items: [{ ...owned, kiosk: 'other' }] },
      },
    }
    expect(select_owned_item(action, foreign)).toEqual({ status: 'failure', code: 'item_unavailable' })
  }
})

test('existing nearest discovery can research the same exhausted tracked zone and does not express an onward frontier', () => {
  const context = profession_context()
  const character = context.snapshot.characters[0]!
  const zone = context.snapshot.zones['fixture:97:97']!
  const now = ZONE_RESEARCH_TTL_MS + 1
  const exhausted = {
    ...context,
    now,
    snapshot: {
      ...context.snapshot,
      clock: { chain_ms: now, observed_at: now },
      observed_at: now,
      zones: {
        'fixture:97:97': { ...zone, spawns: { ...zone.spawns!, resources: [], mobs: [] } },
      },
    },
  }
  const discovery = {
    type: 'discover' as const,
    character_id: character.id,
    world: 'fixture',
    region: { min_zx: 0, max_zx: 4294967295, min_zz: 0, max_zz: 4294967295 },
    order: 'nearest' as const,
  }
  const selected = select_discovery(discovery, exhausted)
  expect(selected).toMatchObject({
    status: 'action',
    action: { kind: 'world_search', payload: { x: 49920, z: 49920 } },
  })
  const outside = { ...discovery, region: { min_zx: 98, max_zx: 98, min_zz: 97, max_zz: 97 } }
  expect(select_discovery(outside, exhausted)).toEqual({ status: 'failure', code: 'region_outside_tracked_window' })
})
