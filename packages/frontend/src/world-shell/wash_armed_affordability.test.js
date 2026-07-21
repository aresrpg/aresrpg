// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AP-AFFORDABILITY WASH GATE + TRAP DRAFT PAINT:
//  · "range highlight persists post-cast" — the cast wash must clear (and the idle MP wash return) the moment
//    the LIVE folded AP can't afford one more cast of the armed spell; wash_armed_spell is the pure verdict.
//  · "casting a trap paints its marker optimistically at cast" — the click-time fold + drop/fail/turn-boundary
//    rollback seams live in DungeonBoard; the wiring contract is pinned here (the fold home itself lives in
//    @aresrpg/fight my_traps_fold.test.js; the render/legality/receipt collapse in trap_home_collapse.test.js).

import { describe, expect, test } from 'bun:test'

import { wash_armed_spell, tackle_float_payloads } from './voxel_fight_folds.js'

describe('wash_armed_spell — the cast wash paints only while one more cast is affordable', () => {
  test('the weapon sentinel gates on the escrow ap_cost: affordable paints, spent clears', () => {
    const inputs = { armed_spell_id: '__weapon_attack', is_weapon: true, weapon_ap_cost: 4 }
    expect(wash_armed_spell({ ...inputs, active_ap: 6 })).toBe('__weapon_attack')
    expect(wash_armed_spell({ ...inputs, active_ap: 3 })).toBeNull() // one strike short — the blue wash clears
  })

  test('nothing armed ⇒ null (the idle MP default owns the board)', () => {
    expect(wash_armed_spell({ armed_spell_id: null, active_ap: 6 })).toBeNull()
  })

  test('an unresolvable spell id costs 0 — honestly paints rather than silently gating', () => {
    expect(wash_armed_spell({ armed_spell_id: 'not_a_seeded_spell', active_ap: 0 })).toBe('not_a_seeded_spell')
  })
})

describe('trap draft paint — click-time fold + rollback semantics (the fold my_traps is the one client trap home)', () => {
  test('CONTRACT: the adapter renders the tackled beat (hit anim + LABEL-FREE AP/MP floats, #239 presentation ruling)', async () => {
    // The producer (fight_render_events) orders 'tackled' strictly before any retry move beat — headless-pinned
    // in @aresrpg/fight test/tackle_beat_order.test.js. This row pins the RENDER binding: an unknown beat kind
    // no-ops silently in bind_render_turn, so a dropped branch would eat the flinch without failing anything.
    const source = await Bun.file(new URL('./voxel_fight_adapter.js', import.meta.url)).text()
    expect(source).toContain("spec.kind === 'tackled'")
    expect(source).toContain("anim: 'hit',") // the tackled runner flinches — hit-before-move, always
    // #239 owner ruling: the floater NEVER prints a mechanic label — tackle_float_payloads (voxel_fight_folds.js)
    // is the ONE home for the numeric-only, house-colored AP/MP payload shape; the adapter only spawns it.
    expect(source).toContain('tackle_float_payloads(payload.ap_lost, payload.mp_lost)')
    // the KEY (not the exact call syntax — the i18n-coverage scanner's static-key regex false-positives on
    // that literal call text sitting in THIS assertion otherwise) must not appear at all: the mechanic label
    // is GONE, not just hidden.
    expect(source).not.toContain("'fights.tackled'")
  })

  describe('tackle_float_payloads — #239: numeric AP/MP floats only, never a mechanic label', () => {
    test('both pools bitten: MP then AP, bare signed numbers, house kinds (never a label)', () => {
      expect(tackle_float_payloads(1, 2)).toEqual([
        { text: '-2', kind: 'mp' },
        { text: '-1', kind: 'ap' },
      ])
    })

    test('one pool already at 0 costs 0 of itself (tackle_losses ceils its own fraction) — filtered, never a bare -0', () => {
      expect(tackle_float_payloads(0, 3)).toEqual([{ text: '-3', kind: 'mp' }])
      expect(tackle_float_payloads(2, 0)).toEqual([{ text: '-2', kind: 'ap' }])
    })

    test('both pools at 0: no floats at all (never a bare label fallback)', () => {
      expect(tackle_float_payloads(0, 0)).toEqual([])
    })

    test('RED-FIRST (#239): every entry is numeric-only — no entry ever carries "TACKLED" or a unit suffix', () => {
      for (const float of tackle_float_payloads(4, 5)) {
        expect(float.text).toMatch(/^-\d+$/)
        expect(float.text).not.toContain('TACKLED')
        expect(float.text).not.toMatch(/[A-Za-z]/)
      }
    })
  })

  test('CONTRACT: DungeonBoard gates the walk on the deterministic tackle — a bitten move predicts, never walks', async () => {
    // CONTRACT (tackle is deterministic, so the walk must never be allowed to proceed speculatively): the optimistic
    // move EXECUTION consults the SAME seed contest the paint does. Headless-pinned end-to-end in @aresrpg/fight
    // test/tackle_move_gate.test.js (next_move_tackle → exact forfeit; the fold drops the pools + a tackled beat +
    // NO move beat). This row pins the React WIRING those pure rows can't reach.
    const source = await Bun.file(new URL('../game/screens/hud/world/DungeonBoard.jsx', import.meta.url)).text()
    expect(source).toContain('const bite = next_move_tackle(fight_store.getState())')
    // bitten ⇒ predict_tackle (forfeit + hit-anim, NO walk); escaped ⇒ optimistic_walk — the exclusive branch:
    expect(source).toMatch(/if \(bite\) predict_tackle\(bite\)\s*\n\s*else optimistic_walk/)
    expect(source).toContain('synthetic_tackled_events') // predict_tackle rides the hit-anim + forfeit beat
    expect(source).toMatch(/intent: \{ kind: 'Tackled'/) // …folding the SAME action the receipt folds
  })

  test('CONTRACT: DungeonBoard folds the click-time trap into my_traps and rolls back through drop_traps', async () => {
    const source = await Bun.file(new URL('../game/screens/hud/world/DungeonBoard.jsx', import.meta.url)).text()
    // the draft click folds the trap optimistically (at cast, not at commit) — place_traps into my_traps …
    expect(source).toContain('place_traps: prediction.placed_traps ?? []')
    expect(source).toContain('pending_trap_cells.current.add(cell)')
    // … a DROPPED trap draft is collected for rollback at flush …
    expect(source).toContain('trap_dropped.push(entry.cell)')
    // … a failed commit rolls every drafted cell back through the fold …
    expect(source).toContain("input({ type: 'drop_traps', cells: store_dropped })")
    // … and a turn boundary rolls back whatever never committed, through the same fold home — filtered to
    // cells NO LONGER live (register hygiene: a cell the flush already committed must not be re-dropped by
    // the boundary net; the version-gated drop_traps input is the structural backstop regardless).
    expect(source).toContain('const drop = [...pending_trap_cells.current].filter((cell) => !live.has(cell))')
    expect(source).toContain("input({ type: 'drop_traps', cells: drop })")
  })
})
