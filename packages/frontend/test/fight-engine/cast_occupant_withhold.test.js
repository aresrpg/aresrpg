// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1741 — AN EMPTY CELL WAS CASTABLE. A zero-area single-target DAMAGE spell aimed one cell off a mob drafted
// happily, burned its AP, resolved `act_cast` on chain with no `Hit` event, and damaged nobody: a whiff that read
// byte-identical to a hit. The ruling ports the donor-era rule — single-target damage REFUSES an empty cell —
// symmetric with `free_cell`'s existing occupied-cell withhold, in the SAME castability derivation
// (`cast_range_set_dungeon`, the one home the gate, the wash and the hover all read).
//
// RIDER 2 (no invisibility leak): "unoccupied" is the PROJECTED/VISIBLE occupancy only. If the withhold read true
// chain occupancy, refusing a cast on a secretly-held cell would REVEAL the invisible entity. So the derivation is
// fed `visible_occupant_cells` (the projection's own `invisible` flag) and the castable set must be BYTE-IDENTICAL
// whether a cell is genuinely empty or invisibly held.

import { describe, expect, test } from 'bun:test'
import { visible_occupant_cells } from '@aresrpg/fight/occupancy'

import { cast_range_set_dungeon, encode } from '../../src/fight-engine/overlay_intents.js'
import { cast_requires_occupant } from '../../src/game/screens/hud/fight-spells-core.js'

const grid = { width: 10, height: 10 }
const caster = { cell: { x: 5, y: 5 } }
const sorted = (set) => [...set].sort((a, b) => a - b)

/** A projected fighter row, the shape project_views emits (cell + dead + invisible). */
const fighter = (id, x, y, extra = {}) => [id, { id, cell: { x, y }, dead: false, invisible: false, ...extra }]

describe('#1741 (b) — single-target damage withholds unoccupied cells', () => {
  test('an in-range EMPTY cell is not castable while the occupied one is', () => {
    const mob = encode(5, 7)
    const empty = encode(5, 3)
    const castable = cast_range_set_dungeon([1, 4], caster, grid, [], { occupant_cells: new Set([mob]) })

    expect(castable.has(mob)).toBe(true)
    expect(castable.has(empty)).toBe(false)
  })

  test('EVERY castable cell holds a visible occupant (no void aim survives the derivation)', () => {
    const occupants = new Set([encode(5, 7), encode(3, 5)])
    const castable = cast_range_set_dungeon([1, 4], caster, grid, [], { occupant_cells: occupants })

    expect(sorted(castable)).toEqual(sorted(occupants))
  })

  test('no occupant_cells input ⇒ today’s permissive set (AoE/traps/free_cell keep empty aims)', () => {
    const open = cast_range_set_dungeon([1, 4], caster, grid, [])

    expect(open.has(encode(5, 3))).toBe(true)
  })

  test('the withhold composes with LOS and the range band, never replaces them', () => {
    const behind = encode(5, 8)
    const wall = encode(5, 6)
    const far = encode(5, 0) // manhattan 5 — outside [1,4]
    const occupants = new Set([behind, far])
    const castable = cast_range_set_dungeon([1, 4], caster, grid, [wall], { occupant_cells: occupants })

    expect(castable.size).toBe(0)
  })
})

describe('#1741 rider 2 — the withhold never leaks an invisible occupant', () => {
  const visible_mob = fighter('mob-0', 5, 7)
  const hidden_mob = fighter('mob-1', 5, 3, { invisible: true })
  const corpse = fighter('mob-2', 4, 5, { dead: true })

  test('visible_occupant_cells drops the invisible and the dead', () => {
    const cells = visible_occupant_cells(new Map([visible_mob, hidden_mob, corpse]))

    expect(sorted(cells)).toEqual([encode(5, 7)])
  })

  test('an invisibly-held cell withholds EXACTLY like an empty one (identical castable sets)', () => {
    const with_hidden = cast_range_set_dungeon([1, 4], caster, grid, [], {
      occupant_cells: visible_occupant_cells(new Map([visible_mob, hidden_mob])),
    })
    const without_hidden = cast_range_set_dungeon([1, 4], caster, grid, [], {
      occupant_cells: visible_occupant_cells(new Map([visible_mob])),
    })

    expect(sorted(with_hidden)).toEqual(sorted(without_hidden))
    expect(with_hidden.has(encode(5, 3))).toBe(false)
  })
})

describe('cast_requires_occupant — WHICH spells the withhold binds (the ruled scope)', () => {
  const point = (kind, over = {}) => ({ kind, area_shape: 'POINT', area_size: 0, ...over })

  test('a zero-area single-target damage spell requires an occupant', () => {
    expect(cast_requires_occupant({ effects: [point('DAMAGE')] })).toBe(true)
  })

  test('an AoE damage spell keeps its empty-cell aim (a vacant centre is a real tactic)', () => {
    expect(cast_requires_occupant({ effects: [point('DAMAGE', { area_shape: 'CIRCLE', area_size: 2 })] })).toBe(false)
  })

  test('a free_cell spell (trap/glyph/teleport) is never bound by it', () => {
    expect(cast_requires_occupant({ free_cell: true, effects: [point('PLACE_TRAP')] })).toBe(false)
  })

  test('a cell-semantics effect riding along (teleport) keeps the empty aim legal', () => {
    expect(cast_requires_occupant({ effects: [point('DAMAGE'), point('TELEPORT')] })).toBe(false)
  })

  test('a non-damage spell (pure buff/debuff) is out of the ruled scope', () => {
    expect(cast_requires_occupant({ effects: [point('APPLY_STATE')] })).toBe(false)
  })

  test('an unresolved level row never withholds anything', () => {
    expect(cast_requires_occupant(null)).toBe(false)
    expect(cast_requires_occupant({ effects: [] })).toBe(false)
  })
})
