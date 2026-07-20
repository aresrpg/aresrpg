// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import i18n from '../../i18n'

import { humanize_abort, humanize_tx_error } from './abort_copy.js'

const grpc_abort = (module, code) => ({
  $kind: 'MoveAbort',
  MoveAbort: {
    abortCode: String(code),
    location: { package: '0x2476', module, function: 1, instruction: 1 },
  },
})

const abort_keys = [
  ['equipment', 103, 'errors.equip_not_equippable'],
  ['equipment', 104, 'errors.equip_slot_occupied'],
  ['equipment', 106, 'errors.equip_relic_duplicate'],
  ['equipment', 107, 'errors.equip_relic_slots_full'],
  ['equipment', 108, 'errors.equip_ring_slots_full'],
  ['equipment', 109, 'errors.equip_level_too_low'],
  ['equipment', 110, 'errors.equip_template_mismatch'],
  ['equipment', 111, 'errors.equip_unknown_class'],
  ['extract', 101, 'errors.item_state_mismatch'],
  ['extract', 102, 'errors.item_same_stack'],
  ['item', 101, 'errors.item_state_mismatch'],
  ['item', 102, 'errors.equip_level_too_low'],
  ['item', 103, 'errors.item_not_personal_kiosk'],
  ['item', 104, 'errors.item_not_stackable'],
  ['item', 105, 'errors.item_zero_quantity'],
  ['item', 106, 'errors.item_template_mismatch'],
  ['item', 107, 'errors.item_split_too_large'],
  ['loot_box', 101, 'errors.lootbox_no_table'],
  ['loot_box', 102, 'errors.lootbox_zero_weight'],
  ['loot_box', 103, 'errors.lootbox_not_box'],
  ['loot_box', 104, 'errors.lootbox_table_invalid'],
  ['loot_box', 105, 'errors.lootbox_table_invalid'],
  ['loot_box', 106, 'errors.lootbox_claim_mismatch'],
  ['gifting', 106, 'errors.lootbox_box_mismatch'],
  ['gifting', 107, 'errors.lootbox_stack_too_small'],
  ['gifting', 108, 'errors.lootbox_zero_quantity'],
  ['kiosk', 0, 'errors.item_wrong_kiosk'],
  ['kiosk', 4, 'errors.item_listed_for_sale'],
  ['kiosk', 9, 'errors.item_listed_for_sale'],
  ['kiosk', 11, 'errors.item_wrong_kiosk'],
  ['version', 101, 'errors.world_version_changed'],
  ['version', 102, 'errors.contracts_paused'],
  ['config', 101, 'errors.game_paused'],
  ['config', 104, 'errors.lootbox_brand_mismatch'],
]

describe('equip/open-box abort copy', () => {
  test('every declared code maps from structured and executed-string receipts', () => {
    for (const [module, code, key] of abort_keys) {
      const legacy = `MoveAbort(MoveLocation { module: ModuleId { name: Identifier("${module}") }, ... }, ${code}) ...`
      expect(humanize_abort(grpc_abort(module, code))).toBe(i18n.t(key))
      expect(humanize_abort(legacy)).toBe(i18n.t(key))
    }
  })

  test('dynamic_field:0 remains generic because a field collision does not prove a listing', () => {
    expect(humanize_abort(grpc_abort('dynamic_field', 0))).toBe(i18n.t('errors.tx_failed'))
  })

  test('executed generic copy names gas and removes the retry invitation', () => {
    const copy = humanize_tx_error(grpc_abort('actions', 999))
    expect(copy).toMatch(/gas was spent/i)
    expect(copy).toMatch(/don['’]t retry/i)
    expect(copy).not.toMatch(/try again/i)
  })

  test('known preflight copy remains separate and retryable', () => {
    // unmapped (actions/999) + preflight now carries a "Reason:" second line (2026-07-19 "must say why") — the
    // honest headline this test actually pins (zero gas, retryable) is untouched.
    const error = new Error('MoveAbort abort code 999 in actions::foo')
    error.name = 'SimulationError'
    const copy = humanize_tx_error(error)
    expect(copy).toContain(i18n.t('errors.tx_refused_preflight'))
    expect(copy).toMatch(/no gas was spent/i)
    expect(copy).toMatch(/try again|retry/i)
  })
})
