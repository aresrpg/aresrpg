// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AP-AFFORDABILITY WASH GATE + TRAP DRAFT PAINT:
//  · "range highlight persists post-cast" — the cast wash must clear (and the idle MP wash return) the moment
//    the LIVE folded AP can't afford one more cast of the armed spell; wash_armed_spell is the pure verdict.
//  · "casting a trap paints its marker optimistically at cast" — the click-time fold + drop/fail/turn-boundary
//    rollback seams live in DungeonBoard; the wiring contract is pinned here (the fold home itself lives in
//    @aresrpg/fight my_traps_fold.test.js; the render/legality/receipt collapse in trap_home_collapse.test.js).

import { describe, expect, test } from 'bun:test'

import { wash_armed_spell } from './voxel_fight_folds.js'

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
  test('CONTRACT: the adapter renders the tackled beat (hit anim + pool-forfeit floater, design order law 2026-07-16)', async () => {
    // The producer (fight_render_events) orders 'tackled' strictly before any retry move beat — headless-pinned
    // in @aresrpg/fight test/tackle_beat_order.test.js. This row pins the RENDER binding: an unknown beat kind
    // no-ops silently in bind_render_turn, so a dropped branch would eat the flinch without failing anything.
    const source = await Bun.file(new URL('./voxel_fight_adapter.js', import.meta.url)).text()
    expect(source).toContain("spec.kind === 'tackled'")
    expect(source).toContain("anim: 'hit',") // the tackled runner flinches — hit-before-move, always
    expect(source).toMatch(/mp_lost > 0 \? `-\$\{payload\.mp_lost\} MP`/) // the forfeit floater voices the bite
    // the floater NAMES the tackle (it fires on the player's own turn, must not read as
    // enemy damage). fights.tackled parity across all 6 locales is pinned by i18n/locales/tackled_parity.test.js.
    expect(source).toContain("i18n.t('fights.tackled')")
  })

  test('CONTRACT: DungeonBoard gates the walk on the deterministic tackle — a bitten move taxes then walks (the toll)', async () => {
    // CONTRACT (tackle is deterministic, ruling #239 the toll): the optimistic move EXECUTION consults the SAME
    // seed contest the paint does. Headless-pinned end-to-end in @aresrpg/fight test/tackle_move_gate.test.js
    // (next_move_tackle → exact forfeit; the fold drops the pools + a tackled beat AND walks the survivor prefix).
    // This row pins the React WIRING those pure rows can't reach.
    const source = await Bun.file(new URL('../game/screens/hud/world/DungeonBoard.jsx', import.meta.url)).text()
    expect(source).toContain('const bite = next_move_tackle(fight_store.getState())')
    // bitten ⇒ predict_tackle(bite, cell) (forfeit + hit-anim + survivor walk); escaped ⇒ optimistic_walk — exclusive:
    expect(source).toMatch(/if \(bite\) predict_tackle\(bite, cell\)\s*\n\s*else optimistic_walk/)
    expect(source).toContain('synthetic_tackled_events') // predict_tackle rides the hit-anim + forfeit beat
    expect(source).toMatch(/intent: \{ kind: 'Tackled'/) // …folding the SAME action the receipt folds
    expect(source).toMatch(/intent: \{ kind: 'move', character: entity_id, to_cell: route\[walked\]/) // …then the toll walk
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
