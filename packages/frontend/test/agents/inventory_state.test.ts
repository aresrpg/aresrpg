// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { InventoryPacket, ItemRow } from '@aresrpg/protocol'

import { reduce_app_state } from '../../src/store.ts'
import { inventory_subscription } from '../../src/agents/inventory_state.ts'
import { automation_fixture } from '../modules/automation_fixture.ts'

const pairing = { address: 'agent', multisig_public_key: 'key', signer_mode: 'host-persistent' as const }
const item: ItemRow = {
  id: 'ore',
  version: '1',
  kiosk: 'agent-kiosk',
  item_type: 'ore',
  category: 'resource',
  name: 'Ore',
  amount: 3,
  level: 1,
}
const fixture = () => {
  const initial = automation_fixture()
  return reduce_app_state(initial, { type: 'agent/inventory_target', wallet: initial.session.wallet!, pairing })
}
const packet = (
  state: ReturnType<typeof fixture>,
  value: InventoryPacket | null,
  id = state.session.agent_inventory.serial
) =>
  reduce_app_state(state, { type: 'server/packet', packet: { type: 'packet/inventory_observed', id, packet: value } })

test('agent item deltas reuse version and deletion reconciliation without changing player ownership', () => {
  const source = fixture()
  const baseline = packet(source, { type: 'packet/inventory', items: [item] })
  const updated = packet(baseline, { type: 'packet/item_updated', item: { ...item, version: '3', amount: 9 } })
  const stale = packet(updated, { type: 'packet/inventory', items: [item] })
  expect(stale.session.agent_inventory.inventory).toEqual([{ ...item, version: '3', amount: 9 }])
  const removed = packet(stale, { type: 'packet/item_removed', item: item.id, version: '4' })
  const restored = packet(removed, { type: 'packet/item_updated', item: { ...item, version: '3' } })
  expect(restored.session.agent_inventory.inventory).toEqual([])
  expect(restored.session.inventory).toBe(source.session.inventory)
})

test('target replacement rejects stale inventory and balance replies', () => {
  const initial = fixture()
  const replacement = reduce_app_state(initial, {
    type: 'agent/inventory_target',
    wallet: initial.session.wallet!,
    pairing: { ...pairing, address: 'second' },
  })
  const late = packet(replacement, { type: 'packet/inventory', items: [item] }, initial.session.agent_inventory.serial)
  expect(late.session.agent_inventory.inventory).toEqual([])
  const balances = reduce_app_state(late, {
    type: 'agent/inventory_balances',
    wallet: initial.session.wallet!,
    pairing,
    sui_balance_mist: 10n,
    kares_balance: 20n,
  })
  expect(balances.session.agent_inventory.sui_balance_mist).toBeNull()
})

test('refresh preserves tombstones and stale replies cannot revive an earlier account', () => {
  let state = fixture()
  for (let index = 0; index < 4; index++) state = reduce_app_state(state, { type: 'agent/inventory_refresh' })
  state = packet(state, { type: 'packet/item_removed', item: item.id, version: '5' })
  const refreshed = reduce_app_state(state, { type: 'agent/inventory_refresh' })
  expect(packet(refreshed, { type: 'packet/inventory', items: [item] }).session.agent_inventory.inventory).toEqual([])
  const ended = reduce_app_state(refreshed, { type: 'auth/disconnected' })
  expect(ended.session.agent_inventory.serial).toBeGreaterThan(refreshed.session.agent_inventory.serial)
  expect(ended.session.agent_inventory.sui_balance_mist).toBeNull()
})

test('subscription waits for readiness and reconnects without changing player character selection', () => {
  const state = fixture().session
  expect(inventory_subscription({ ...state, link_status: 'connecting' }, state)).toBeNull()
  expect(inventory_subscription({ ...state, link_status: 'ready' }, { ...state, link_status: 'connecting' })).toEqual({
    id: state.agent_inventory.serial,
    pairing: state.inventory_pairing,
  })
  expect(inventory_subscription(state, state)).toBeNull()
  const failed = packet({ ...fixture(), session: state }, null)
  expect(failed.session.agent_inventory.phase).toBe('failed')
  expect(failed.session.selected_character_id).toBe(state.selected_character_id)
})
