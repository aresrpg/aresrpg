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

// #88 — old PetPowerKey values can exceed item_stats' new 60-feed denominator. The direct-chain guard must
// run after the staged rows exist but before either the bag mutation or the sole PTB composer; its refusal
// branch returns before both, leaving the pet visibly and on-chain in its kiosk.
test('Accept refuses legacy pet power before optimistic mutation or equip PTB composition (#88)', () => {
  const accept_start = inventory_source.indexOf('const on_accept = async ()')
  const accept_end = inventory_source.indexOf('const on_cancel = ()')
  const body = inventory_source.slice(accept_start, accept_end)

  const guard_at = body.indexOf('await legacy_pet_equip_guard(to_equip)')
  const bag_remove_at = body.indexOf('remove_bag_items(')
  const bag_add_at = body.indexOf('add_bag_items(')
  const composer_at = body.indexOf('equip_items({')
  expect(guard_at).toBeGreaterThan(-1)
  expect(bag_remove_at).toBeGreaterThan(guard_at)
  expect(bag_add_at).toBeGreaterThan(guard_at)
  expect(composer_at).toBeGreaterThan(guard_at)
  expect(body.slice(guard_at, Math.min(bag_remove_at, bag_add_at))).toMatch(/if \(legacy_pet\)[\s\S]*?return/)
})

// #590 — a reconcile that FAILS after a successful equip/unequip tx must never leave the equipment panel
// locked. Root cause: on_accept committed the optimistic stage (`stage.committed = true`) and the panel LOCK
// keyed on it (`pending: committing || !!stage.committed`); reconcile_equip_state throws on ordinary /v1
// indexer lag, and its catch cleared nothing — so `equip_lock` stayed "Updating equipment…" forever, and
// every later unequip double-click hit the equip_lock guard (a silent info toast, no tx, no digest, retries
// stacking frozen toasts). Two structural invariants close it, in this file's on_accept source-contract idiom:
//   (1) the panel LOCK is the tx-in-flight signal ONLY — `stage.committed` is optimistic DISPLAY state
//       (it drives which map the doll paints), never a lock reason.
//   (2) `set_committing(false)` runs in a `finally`, so a FAILED reconcile unlocks exactly like a success.
test('a failed post-tx reconcile can never strand the equipment panel locked (#590)', () => {
  // (1) the lock never keys on the optimistic-display flag
  const lock_start = inventory_source.indexOf('equip_lock_of({')
  expect(lock_start).toBeGreaterThan(-1)
  const lock_call = inventory_source.slice(lock_start, inventory_source.indexOf('})', lock_start))
  expect(lock_call).toContain('pending:')
  expect(lock_call).not.toContain('stage.committed')

  // (2) the reconcile await clears the in-flight lock in a finally — success AND failure both unlock
  const commit_at = inventory_source.indexOf("dispatch_stage({ type: 'commit' })")
  const cancel_at = inventory_source.indexOf('const on_cancel = ()')
  expect(commit_at).toBeGreaterThan(-1)
  expect(cancel_at).toBeGreaterThan(commit_at)
  const reconcile_block = inventory_source.slice(commit_at, cancel_at)
  expect(reconcile_block).toContain('await reconcile_equip_state(')
  expect(reconcile_block).toMatch(/finally\s*\{[\s\S]*?set_committing\(false\)[\s\S]*?\}/)
})

test('equipped totals render the shared quiet unavailable marker for an unresolved contributor', () => {
  const totals_start = inventory_source.indexOf('<div className="inv__totals">')
  const totals_end = inventory_source.indexOf('</div>', totals_start)
  expect(totals_start).toBeGreaterThan(-1)
  expect(totals_end).toBeGreaterThan(totals_start)
  const totals_markup = inventory_source.slice(totals_start, totals_end)

  expect(totals_markup).toMatch(/totals === null[\s\S]*?inv__totals-empty[\s\S]*?t\('stats\.unavailable'\)/)
  expect(totals_markup.indexOf('totals === null')).toBeLessThan(totals_markup.indexOf('totals.length === 0'))
})
