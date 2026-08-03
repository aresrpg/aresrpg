// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1993 WP7 RED — NO FABRICATED TERMINAL HP.
//
// Audit row `fight_report_roster.js:27`: the end-fight cards convert liveness into a BINARY hp percentage
// (`alive ? 100 : 0`), discarding the exact final HP the recap already holds. A party member who survived the
// last room on 7 of 40 hp is drawn with a FULL bar — the card states a number the fight never produced.
//
// The record's answer (the row's own ask): carry the exact final vitals, or label liveness WITHOUT an HP bar.
// A missing vitals block therefore reads `hp_pct: null` — no bar — and never a fabricated 100.

import { describe, expect, test } from 'bun:test'

import {
  fight_report_enemy_rows,
  fight_report_party_rows,
} from '../../../../src/game/screens/hud/fight_report_roster.js'

const survivor = {
  id: 'mob-0',
  name: 'Razkin',
  team: 1,
  level: 8,
  is_player: false,
  alive: true,
  final_hp: 7,
  max_hp: 40,
}

describe('#1993 WP7 — terminal cards carry exact final vitals, never a fabricated bar', () => {
  test('a survivor that ended on 7/40 is not drawn at full health', () => {
    const [row] = fight_report_enemy_rows([survivor], 0)
    expect(row.hp_pct, 'the exact final fraction the fight produced').toBe(17.5)
  })

  test('a roster row with NO final vitals labels liveness without an HP bar', () => {
    const [row] = fight_report_enemy_rows([{ ...survivor, final_hp: undefined, max_hp: undefined }], 0)
    expect(row.alive, 'liveness is still stated').toBe(true)
    expect(row.hp_pct, 'no vitals ⇒ no bar — never a fabricated 100').toBeNull()
  })

  test('the party card follows the same law, including the synthesized local row', () => {
    const { party_rows } = fight_report_party_rows({
      roster: [{ id: 'ally', name: 'Ally', team: 0, level: 9, is_player: true, alive: true, final_hp: 3, max_hp: 60 }],
      me_id: 'me',
      me_name: 'Hero',
      my_level: 12,
      my_class: 'senshi',
      self_alive: true,
      fallback_name: 'You',
    })
    const ally = party_rows.find((row) => row.id === 'ally')
    const me = party_rows.find((row) => row.is_me)
    expect(ally.hp_pct, 'an ally that limped out is drawn at its real 5%').toBe(5)
    expect(me.hp_pct, 'the synthesized local row has no vitals to draw — so it draws none').toBeNull()
  })
})
