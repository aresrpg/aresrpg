// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #487 — a wallet may own several personal kiosks. A loose item carries its ACTUAL source kiosk on the
// `/v1/owner-items` row; crush must compose against that kiosk/cap even when the active character lives in a
// sibling kiosk. This is the action-level PTB proof: values change, the SDK builder's argument SHAPE does not.

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { reset_auth_mock } from '../test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'

const fake_sdk = { get_rolled_stats: async () => null, grpc_client: {} }

const sdk_game = await import('@aresrpg/sdk/game')
const read_findables = await import('../chain/read_findables.js')
const kiosk_resolve = await import('./kiosk_resolve.js')
const tx_seam = await import('./tx.js')
const roster = await import('../roster/load_roster.js')

const item = {
  id: '0xitem',
  template_id: '0xtemplate',
  item_type: 'sword',
  kiosk_id: '0xitem-kiosk',
  level: 1,
}
const item_cap_id = '0xitem-cap'
const composed = []

const { crush_item } = await import('./crush_actions.js')

let item_cap_resolve
let submit
let refresh
let spies = []

beforeEach(() => {
  composed.length = 0
  reset_auth_mock({ address: '0xowner', wallet_name: 'zklogin' })
  set_expedition_sdk_mock(async () => fake_sdk)
  const template_map = spyOn(read_findables, 'get_template_map').mockResolvedValue(
    new Map([[item.template_id, { id: item.template_id, item_type: item.item_type, level: 1 }]])
  )
  const template_type_map = spyOn(read_findables, 'get_template_by_item_type_map').mockResolvedValue(new Map())
  const registry = spyOn(sdk_game, 'get_crush_registry').mockImplementation(() => async () => ({
    by_key: new Map(),
  }))
  const compose = spyOn(sdk_game, 'crush_ptb').mockImplementation(() => (args) => {
    composed.push(args)
    return { fake: 'tx' }
  })
  item_cap_resolve = spyOn(kiosk_resolve, 'cap_for_kiosk').mockResolvedValue(item_cap_id)
  // run_tx_random returns the submitted digest on timing; normalized result is the effects/event receipt.
  submit = spyOn(tx_seam, 'run_tx_random').mockResolvedValue({
    result: {},
    timing: { digest: '11111111111111111111111111111111' },
  })
  refresh = spyOn(roster, 'load_roster').mockResolvedValue(undefined)
  spies = [template_map, template_type_map, registry, compose, item_cap_resolve, submit, refresh]
})

afterEach(() => {
  for (const test_spy of [...spies].reverse()) test_spy.mockRestore()
  spies = []
  reset_expedition_sdk_mock()
  reset_auth_mock()
})

describe('crush_item kiosk resolution', () => {
  test("builds a sibling-kiosk item's PTB against the item's own kiosk and cap", async () => {
    await expect(crush_item({ item, character_id: '0xcharacter' })).resolves.toEqual({
      result: {},
      timing: { digest: '11111111111111111111111111111111' },
    })

    expect(item_cap_resolve).toHaveBeenCalledWith(fake_sdk, '0xowner', item.kiosk_id)
    expect(composed).toHaveLength(1)
    expect(composed[0]).toMatchObject({
      kiosk_id: item.kiosk_id,
      personal_kiosk_cap_id: item_cap_id,
      character_id: '0xcharacter',
      gear_item_ids: [item.id],
    })
    expect(submit).toHaveBeenCalledWith('crush', { fake: 'tx' })
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
