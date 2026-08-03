// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1803 — the JS half of the WEAPON FAMILY LINE parity fixture (see the fixture's own `_doc` for the contract).
// The Move half is packages/move/engine/tests/weapon_line_table_tests.move; a tuning edit on one twin breaks the
// other. This reader also pins the two DEGRADATION doors the chain has: an unknown slug and no slug at all both
// resolve bare hands rather than aborting a fight (§7).

import { describe, expect, test } from 'bun:test'

import { UNARMED_WEAPON, WEAPON_FAMILIES, weapon_line_of } from '../src/weapon_lines.js'
import FIXTURE from '../../sim/test/fixtures/weapon_family_lines.json' with { type: 'json' }
// #387 leg ② — the five categories that had a zone but no line (wand/hammer/scythe/shovel/pickaxe) land as a
// SECOND fixture file, settled evidence untouched. The two files are ONE vocabulary: their concatenation, in
// order, is the family table, and a slug may live in exactly one of them.
import FIXTURE_387 from '../../sim/test/fixtures/weapon_family_lines_387.json' with { type: 'json' }

const ALL_ROWS = [...FIXTURE.families, ...FIXTURE_387.families]

describe('§17.27 weapon family lines — the JS twin reads the parity fixture', () => {
  test("the family vocabulary is the fixtures', in order", () => {
    expect(WEAPON_FAMILIES).toEqual(ALL_ROWS.map((row) => row.family))
  })

  test('the two fixture files never claim the same family', () => {
    const older = new Set(FIXTURE.families.map((row) => row.family))
    expect(FIXTURE_387.families.filter((row) => older.has(row.family))).toEqual([])
    expect(new Set(ALL_ROWS.map((row) => row.family)).size).toBe(ALL_ROWS.length)
  })

  test.each(ALL_ROWS)('$family swings its own line, plain and with affinity', (row) => {
    expect(weapon_line_of(row.family, false)).toEqual(row.line)
    expect(weapon_line_of(row.family, true)).toEqual(row.affinity_line)
  })

  test.each(FIXTURE_387.families)('$family is no longer BARE-HANDED', (row) => {
    // The reported dimension: these five resolved the unarmed line whatever they were. A row that merely
    // existed would pass `$family swings its own line`; this one fails on any table that still degrades them.
    expect(weapon_line_of(row.family, false)).not.toEqual(FIXTURE.unarmed)
    expect(weapon_line_of(row.family, false).category).toBe(row.family)
  })

  test('bare hands: no slug, a tool slug, and a junk slug all fall to the unarmed line', () => {
    expect(weapon_line_of(null)).toEqual(FIXTURE.unarmed)
    expect(weapon_line_of('tool_miner')).toEqual(FIXTURE.unarmed)
    expect(weapon_line_of('')).toEqual(FIXTURE.unarmed)
    // affinity is never applied to bare hands — an unarmed hit has no class.
    expect(weapon_line_of('tool_miner', true)).toEqual(FIXTURE.unarmed)
    expect(FIXTURE.unarmed).toMatchObject(UNARMED_WEAPON)
  })
})
