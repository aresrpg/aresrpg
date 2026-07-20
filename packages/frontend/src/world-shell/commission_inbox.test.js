// D770a W3b regression — incoming commission nudges must reach the inbox THROUGH @aresrpg/world's presence atom
// (the WS-era `peer/commissionRequest` bus event is dead). Drives the real wire: wire_commission_p2p subscribes
// to the core's commission stream head; a `commission_received` row addressed to MY wallet lands as an inbox row,
// and a row for someone else is ignored.

import { afterEach, beforeEach, expect, test } from 'bun:test'

// mock.module('../auth') — the sanctioned auth double (no Enoki/window at import); reset_auth_mock sets my address.
import { reset_auth_mock } from '../test_helpers/auth_mock.js'
// Registers the '../chain/sdk' module mock before presence_adapter loads (its identity-executor chain edge).
import '../test_helpers/expedition_sdk_mock.js'

const { presence_store, presence_input } = await import('./presence_adapter.js')
const { use_commission_inbox, wire_commission_p2p } = await import('./commission_inbox.js')

// wire_commission_p2p is idempotent (module-scope `wired` latch) — arm the single core subscription once.
wire_commission_p2p()

beforeEach(() => {
  reset_auth_mock({ address: '0xARTISAN' })
  presence_store.getState().input({ type: 'reset' })
  use_commission_inbox.getState().clear()
})
afterEach(() => use_commission_inbox.getState().clear())

test('a commission_received row for MY wallet lands as an inbox row', () => {
  presence_input({
    type: 'commission_received',
    row: {
      to_address: '0xARTISAN',
      from_address: '0xCUST',
      from_name: 'Cust',
      recipe_id: 'sword',
      recipe_name: 'Sword',
      payment_mist: 1000,
    },
  })
  const reqs = use_commission_inbox.getState().requests
  expect(reqs).toHaveLength(1)
  expect(reqs[0]).toMatchObject({
    recipe_id: 'sword',
    recipe_name: 'Sword',
    customer_name: 'Cust',
    customer_address: '0xCUST',
    payment_mist: 1000,
    artisan_address: '0xARTISAN',
  })
})

test('a commission_received row addressed to someone else is ignored', () => {
  presence_input({ type: 'commission_received', row: { to_address: '0xSOMEONE_ELSE', recipe_id: 'shield' } })
  expect(use_commission_inbox.getState().requests).toHaveLength(0)
})
