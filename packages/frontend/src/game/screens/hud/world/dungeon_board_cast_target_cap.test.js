// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ① #1045 — A SPENT TARGET SAYS SO. Patient Venom ships `casts_per_turn: 255` (unlimited) with
// `casts_per_target: 1` (the published spell_corpus row): after one cast at a mob, the SPELL is still castable
// (any other cell is legal — the bar is right to keep it armable) but THAT CELL is spent for the turn, and the
// chain aborts ECastsPerTarget on a repeat. The board's `castable` drops the cell — so the re-armed click landed
// on a non-targetable cell and did the ONE thing the no-silent-failure law forbids: it disarmed and said nothing
// ("the second cast folded nothing"). The per-target rule now has ONE home (@aresrpg/fight draft_budget
// `target_cap_reached`) and the click NAMES it.
//
// DungeonBoard.jsx imports the 3D engine (not headless-importable, no jsdom in this repo), so this follows the
// house pattern of its neighbours (dungeon_board_self_click.test.js): (A) the REAL rule over the REAL published
// spell shape, (B) a source-contract on the click path — red at HEAD.
import { describe, expect, test } from 'bun:test'

import { cap_of, casts_at_cell, target_cap_reached } from '@aresrpg/fight/draft_budget'

// the published corpus row for `yajin_patient_venom` (assets.aresrpg.world/data/spell_corpus.json), level 1
const PATIENT_VENOM = { casts_per_turn: 255, casts_per_target: 1, cooldown_turns: 0 }
const SPELL = 'yajin_patient_venom'
const MOB_CELL = 120

describe('① a per-target-capped cell is refused by name, not silently', () => {
  // (A) THE DEAD-END, over the real published limits: the spell is NOT exhausted for the turn (255 = unlimited,
  //     no cooldown) — the bar keeps it armable, correctly — while the mob's cell IS spent after one cast. That
  //     gap is exactly the reported "armed it again, the second cast folded nothing".
  test('(A) the spell stays armable while the already-hit cell is spent', () => {
    const cast_path = [{ cell: MOB_CELL, spell_key: SPELL }]
    const per_turn_cap = PATIENT_VENOM.cooldown_turns > 0 ? 1 : cap_of(PATIENT_VENOM.casts_per_turn)
    const queued = cast_path.filter((entry) => entry.spell_key === SPELL).length
    expect(queued >= per_turn_cap, 'the per-TURN cap never binds — arming is legal, other cells still are').toBe(
      false
    )
    expect(casts_at_cell(cast_path, SPELL, MOB_CELL)).toBe(1)
    expect(target_cap_reached(cast_path, SPELL, MOB_CELL, PATIENT_VENOM.casts_per_target)).toBe(true)
    // an untouched cell keeps its whole allowance, and an unlimited (255) per-target spell never caps
    expect(target_cap_reached(cast_path, SPELL, MOB_CELL + 1, PATIENT_VENOM.casts_per_target)).toBe(false)
    expect(target_cap_reached(cast_path, SPELL, MOB_CELL, 255)).toBe(false)
  })

  // (B) THE FIX, source-contract (red at HEAD): the armed board click resolves a spent cell through the ONE
  //     per-target home and surfaces the existing chain-abort copy instead of a mute disarm.
  test('(B) the armed click path names the per-target refusal', async () => {
    const src = await Bun.file(new URL('./DungeonBoardInput.jsx', import.meta.url)).text()
    const start = src.indexOf('const on_cell_click = (cell, cast_only) =>')
    const end = src.indexOf('// Relay: a click / spell-drop on the rich 3D board', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const body = src.slice(start, end)
    expect(body, 'the click reads the ONE per-target home').toMatch(/target_cap_reached\s*\(/)
    expect(body, 'and says why — the copy the chain abort already ships in all six locales').toMatch(
      /errors\.cast_per_target_limit/
    )
    // the per-target rule is derived, never re-implemented at the call site
    expect(body).not.toMatch(/casts_at_cell\s*\(/)
  })
})
