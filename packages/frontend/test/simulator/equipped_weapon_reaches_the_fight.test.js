// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1803 — THE EQUIPPED WEAPON REACHES THE FIGHT BUILD. A chain-backed seat gets its `Weapon` from
// `participant::weapon_line_of` at fight entry and the client only decodes it; the SIMULATOR has no such door,
// so its own build path must resolve the same line — and it did not, which is why an equipped weapon showed the
// BARE HANDS card (AP 3 · dmg 4 · reach 1 · Earth = `unarmed_line`).
//
// The seam under test is the one the row named first: the family slug surviving the fight build all the way to
// `weapon_line_of(family, affinity)`. Seam ② (a vocabulary mismatch) is disproven by construction here — the
// item's `category` IS the family slug on both sides (equipment.move `WEAPON_FAMILIES` ≡ participant.move
// `WL_FAMILIES` ≡ `@aresrpg/fight/weapon_lines` `WEAPON_FAMILIES`) — and the per-family sweep below walks all 11
// through the real build so a future vocabulary drift breaks here.

import { describe, expect, test } from 'bun:test'
import { WEAPON_FAMILIES, weapon_line_of } from '@aresrpg/fight/weapon_lines'

import { build_seat } from '../../src/simulator/content.js'
import { seat_entity } from '../../src/simulator/fight_setup.js'

const CHARACTER = { id: '0xseat', name: 'Test', class_id: 'senshi', level: 20, stat_alloc: {} }

/** A minimal catalog row for one weapon family — the picker hands `build_seat` exactly these fields. */
const weapon_item = (category) => ({
  id: `0xitem_${category}`,
  name: category,
  category,
  level: 1,
  item_type: category,
  stats: {},
  damages: [],
})

const built = (character, items) =>
  seat_entity({
    character,
    seat: build_seat(character, items),
    spell_ids: [],
    cell: { x: 1, y: 1 },
  })

describe('#1803 — the equipped weapon survives the simulator fight build', () => {
  test('bare hands still fight bare-handed (the fixture discriminates)', () => {
    expect(built(CHARACTER, []).weapon).toEqual(weapon_line_of(null))
  })

  test('a gathering tool in the weapon slot is not a weapon', () => {
    expect(built(CHARACTER, [weapon_item('tool_miner')]).weapon).toEqual(weapon_line_of(null))
  })

  test("an equipped longsword swings the longsword line, with the senshi's own-class affinity", () => {
    const { weapon } = built(CHARACTER, [weapon_item('longsword')])
    expect(weapon).toEqual(weapon_line_of('longsword', true))
    expect(weapon.category).toBe('longsword')
    expect(weapon).not.toEqual(weapon_line_of(null))
  })

  test('the seat build ignores non-weapon gear when resolving the family', () => {
    const { weapon } = built(CHARACTER, [weapon_item('helmet'), weapon_item('bow')])
    expect(weapon).toEqual(weapon_line_of('bow', false)) // a senshi wields a bow with no affinity
  })

  // THE #387 MATRIX'S FIRST COLUMN: every family resolves ITS own line through the one real build path.
  test.each(WEAPON_FAMILIES)('family %s resolves its own line through the build', (family) => {
    const character = { ...CHARACTER, class_id: 'senshi' }
    const { weapon } = built(character, [weapon_item(family)])
    expect(weapon).toEqual(weapon_line_of(family, family === 'longsword'))
  })
})
