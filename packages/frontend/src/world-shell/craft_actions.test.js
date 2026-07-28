// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1494 — the craft action must pass each selected owned-item custody row to the SDK unchanged. A character/output
// kiosk is a separate concern; it must never replace either ingredient's own kiosk.

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { reset_auth_mock } from '../test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'

const composed = []
const fake_tx = { fake: 'craft-tx' }
const fake_sdk = {
  craft_ptb: (args) => {
    composed.push(args)
    return fake_tx
  },
}
const character_handle = {
  kiosk_id: '0xcharacter-kiosk',
  personal_kiosk_cap_id: '0xcharacter-cap',
}
const items = [
  {
    id: '0xore',
    item_type: 'iron_ore',
    amount: 2,
    kiosk_id: '0xore-kiosk',
    kiosk_cap_id: '0xore-cap',
  },
  {
    id: '0xwood',
    item_type: 'oak_wood',
    amount: 1,
    kiosk_id: '0xwood-kiosk',
    kiosk_cap_id: '0xwood-cap',
  },
]
const recipe = {
  recipe_id: '0xrecipe',
  output_template_id: '0xoutput',
  ingredients: [
    { id: 'iron_ore', qty: 2 },
    { id: 'oak_wood', qty: 1 },
  ],
}

const kiosk_resolve = await import('./kiosk_resolve.js')
const tx_seam = await import('./tx.js')
const roster = await import('../roster/load_roster.js')
const { craft_item } = await import('./craft_actions.js')

let spies = []

beforeEach(() => {
  composed.length = 0
  reset_auth_mock({ address: '0xowner', wallet_name: 'zklogin' })
  set_expedition_sdk_mock(async () => fake_sdk)
  const resolve_character = spyOn(kiosk_resolve, 'kiosk_for_character').mockResolvedValue(character_handle)
  const submit = spyOn(tx_seam, 'run_tx').mockResolvedValue({
    result: { digest: '0xdigest' },
  })
  const refresh = spyOn(roster, 'load_roster').mockResolvedValue(undefined)
  spies = [resolve_character, submit, refresh]
})

afterEach(() => {
  for (const test_spy of [...spies].reverse()) test_spy.mockRestore()
  spies = []
  reset_expedition_sdk_mock()
  reset_auth_mock()
})

describe('craft_item kiosk custody', () => {
  test('passes two ingredients in different kiosks as their own custody rows', async () => {
    await expect(
      craft_item({
        recipe,
        items,
        character_id: '0xcharacter',
      })
    ).resolves.toEqual({ digest: '0xdigest' })

    expect(kiosk_resolve.kiosk_for_character).toHaveBeenCalledWith(fake_sdk, '0xowner', '0xcharacter')
    expect(composed).toHaveLength(1)
    expect(composed[0]).toMatchObject({
      recipe_id: recipe.recipe_id,
      kiosk_id: character_handle.kiosk_id,
      personal_kiosk_cap_id: character_handle.personal_kiosk_cap_id,
      character_id: '0xcharacter',
      input_items: items,
      output_template_id: recipe.output_template_id,
    })
    expect(tx_seam.run_tx).toHaveBeenCalledWith('craft', fake_tx)
    expect(roster.load_roster).toHaveBeenCalledTimes(1)
  })
})
