// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

const inventory_source = readFileSync(new URL('./Inventory.jsx', import.meta.url), 'utf8')

test('Accept drives equip through the standard pending-to-success promise toast', () => {
  expect(inventory_source).toMatch(
    /use_toast\.getState\(\)\.promise\([\s\S]*?equip_items\([\s\S]*?pending: t\('inventory\.tx_equip_pending'\)[\s\S]*?success: t\('inventory\.tx_equip_success'\)/
  )
  expect(inventory_source).not.toContain("use_toast.getState().add(t('inventory.tx_equip_success'), 'info')")
})

// #317 — the pending toast must exist before the preflight network leg, never behind it (the 429-backoff
// stall in rpc/client.ts's get_owner_items was the ~10s of silence). Ordering is textual, not simulated —
// matching this file's own established idiom for pinning an async function's call order.
test('on_accept shows pending feedback before the preflight fetch (#317)', () => {
  const accept_start = inventory_source.indexOf('const on_accept = async ()')
  const accept_end = inventory_source.indexOf('const on_cancel = ()')
  expect(accept_start).toBeGreaterThan(-1)
  expect(accept_end).toBeGreaterThan(accept_start)
  const body = inventory_source.slice(accept_start, accept_end)

  const pending_at = body.indexOf("add_persistent(t('inventory.tx_equip_pending')")
  const fetch_at = body.indexOf('await get_owner_items(')
  expect(pending_at).toBeGreaterThan(-1)
  expect(fetch_at).toBeGreaterThan(-1)
  expect(pending_at).toBeLessThan(fetch_at)
})

// A known-data equip refusal must never reach the stage/tx path. Since to_equip is
// built ONLY from staged `equipment` slots and equip_items() is the sole tx-composing call, refusing to
// EVER call dispatch_stage(equip_stage_action(...)) for a blocked item is itself the "no tx composition"
// proof — checked in both stage entry points (click + drag-drop).
test('on_grid_activate and on_drop run the shared equip pre-flight before an item ever stages', () => {
  const activate_start = inventory_source.indexOf('const on_grid_activate = ')
  const activate_end = inventory_source.indexOf('const on_accept = async ()')
  const drop_start = inventory_source.indexOf('on_drop: (')
  const drop_end = inventory_source.indexOf('on_hover_enter: on_item_hover')
  expect(activate_start).toBeGreaterThan(-1)
  expect(drop_start).toBeGreaterThan(-1)

  for (const [start, end] of [
    [activate_start, activate_end],
    [drop_start, drop_end],
  ]) {
    const body = inventory_source.slice(start, end)
    const gate_at = body.indexOf('equip_preflight({')
    const stage_at = body.indexOf('dispatch_stage(equip_stage_action(')
    expect(gate_at).toBeGreaterThan(-1)
    expect(stage_at).toBeGreaterThan(-1)
    expect(gate_at).toBeLessThan(stage_at)
  }
})
