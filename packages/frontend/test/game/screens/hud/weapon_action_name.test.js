// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2279 RED-FIRST — the weapon attack is the ITEM: an equipped, named weapon must reach the fight bar's slot-0
// label under its own name, derived from the paper doll's ONE name home (real_equipment_of → projected_item),
// never a second string. Before the fix the socket rendered the generic `fight.weapon_attack` for every weapon.

import { describe, expect, test } from 'bun:test'

import { equipped_weapon_name } from '../../../../src/game/screens/hud/inventory-equip.js'
import { weapon_action_name, weapon_socket_projection } from '../../../../src/game/screens/hud/deck-weapon-socket.js'

const t = (key) => ({ 'fight.weapon_bare': 'Bare Hands', 'fight.weapon_attack': 'Weapon Attack' })[key] ?? key

// A /v1 character projection carrying one equipped longsword, plus the owner-items doc that names it — the
// exact pair the Inventory paints the doll from.
const character = {
  id: '0xchar',
  equipment: [{ item_id: '0xsword', template: '0xtpl', category: 'longsword' }],
}
const item_docs = [{ id: '0xsword', name: 'Gobball Cutter', item_category: 'longsword', level: 12 }]

// The escrow weapon line (board_state.normalize_weapon) — a real, non-bare-hands strike.
const weapon = {
  element: 0,
  damage: 12,
  damage_max: 12,
  crit_damage: 19,
  crit_rate: 5,
  ap_cost: 4,
  reach: 3,
  lines: [],
}
const bare_hands_weapon = {
  element: 2,
  damage: 4,
  damage_max: 4,
  crit_damage: 6,
  crit_rate: 30,
  ap_cost: 3,
  reach: 1,
  lines: [],
}

describe('#2279 — the weapon attack bears its item name', () => {
  test('the equipped weapon slot yields the item doc name, from the paper doll home', () => {
    expect(equipped_weapon_name(character, item_docs)).toBe('Gobball Cutter')
  })

  test('slot 0 labels the action with that item name instead of the generic string', () => {
    const view = weapon_socket_projection({
      weapon,
      item_name: equipped_weapon_name(character, item_docs),
      glow: false,
      clock: null,
      t,
    })
    expect(view.name).toBe('Gobball Cutter')
    expect(view.name).not.toBe('Weapon Attack')
  })

  test('an unnamed / unread equipment feed keeps the honest generic labels', () => {
    expect(equipped_weapon_name(null, [])).toBe('')
    expect(weapon_action_name('', false, t)).toBe('Weapon Attack')
    expect(weapon_action_name('', true, t)).toBe('Bare Hands')
    // bare hands never wear an item name — nothing is equipped in that slot
    expect(
      weapon_socket_projection({ weapon: bare_hands_weapon, item_name: '', glow: false, clock: null, t }).name
    ).toBe('Bare Hands')
  })
})
