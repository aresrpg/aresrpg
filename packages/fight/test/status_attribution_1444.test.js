// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1444 — a fresh level-1 character (starter kit, NO damage-buff spell) showed "+20% Damage · 1 turn" on its own
// HUD row mid-fight against Runt Piglets. The badge itself is real chain content: mob templates author exactly
// that family of self-buff (the live capture in fight_status_snapshot.js pins Razkin's +25% damage row). What
// was wrong was WHOSE row it landed on.
//
// ROOT, in the attribution seam the row names: a `FighterStatus.fighter` is the ONLY statement of ownership on
// a status row (a seat index, or 1000 + mob index — cast.move `fid_of`). Both doors that read it — the wire
// decode and the entity mapper — did `Number(row.fighter)`, and `Number(null)` / `Number('')` / `Number(false)`
// are all **0**. So any row that reached either door without a readable owner was silently attributed to
// PARTICIPANT SEAT 0 — which in a solo fight is the player, on their own card. A mob's self-buff on the player's
// HUD is precisely that coercion's output.
//
// The fix is the class, not an instance: absence is DROPPED, never guessed (a status nobody can attribute is not
// a status). RED-FIRST — every "owner-less" case below landed on seat 0 before `fighter_fid` existed.
//
// EVIDENCE NOTE, stated honestly: the fight journal capture the row asks for does not exist, so the TRIGGER that
// produced an owner-less row on that particular fight is not proven here. What is proven is that this seam could
// manufacture the reported symptom out of nothing, and can no longer.

import { describe, expect, test } from 'bun:test'

import {
  MOB_FIGHTER_ID_BASE,
  fighter_fid,
  read_fighter_statuses,
  status_snapshot_entities,
} from '../src/fight_status_snapshot.js'

const PLAYER = '0xyajin' // the level-1 character, seat 0 — the row's victim
const MOBS = 3 // a Runt Piglet pack

/** A raw json:true Fight document carrying one `fx.statuses` row, exactly as the read layer serves it. */
const fight_json = (row) => ({ fx: { statuses: [row] } })

/** The mob self-buff the report saw: +20% damage for one turn, authored by (and owned by) mob 0. */
const damage_buff = (fighter) => ({
  fighter,
  kind: 9, // K_ALTER_STAT — the signed family the +N% damage rows ride
  remaining_turns: 1,
  effect: { kind: 9, turns: 1, value: 32768 + 20, stat: 4, chance: 100, element: 255 },
  source: MOB_FIGHTER_ID_BASE + 0,
})

const map_rows = (rows) => status_snapshot_entities(rows, [PLAYER], MOBS)

describe('#1444 — a status row with no readable owner is dropped, never pinned on seat 0', () => {
  test('the HONEST path is untouched: a mob-owned row still lands on that mob', () => {
    const rows = read_fighter_statuses(fight_json(damage_buff(MOB_FIGHTER_ID_BASE + 0)))
    expect(rows).toHaveLength(1)
    expect(rows[0].value, 'the 32768 centering is still stripped exactly once').toBe(20)
    expect(map_rows(rows)[0].entity_id).toBe('mob-0')
  })

  test('a real seat-0 row still lands on the player — the guard drops absence, not zero', () => {
    const rows = read_fighter_statuses(fight_json(damage_buff(0)))
    expect(map_rows(rows)[0].entity_id).toBe(PLAYER)
    // …and the string form the wire actually uses for a u64 is the same fact, not a different one
    expect(map_rows(read_fighter_statuses(fight_json(damage_buff('0'))))[0].entity_id).toBe(PLAYER)
    expect(map_rows(read_fighter_statuses(fight_json(damage_buff(String(MOB_FIGHTER_ID_BASE + 2)))))[0].entity_id).toBe(
      'mob-2'
    )
  })

  test('THE BUG: an owner-less row no longer becomes the player’s buff', () => {
    for (const missing of [null, '', false]) {
      const rows = read_fighter_statuses(fight_json(damage_buff(missing)))
      expect(rows, `fighter=${JSON.stringify(missing)} must not decode as an owned status`).toHaveLength(0)
      // and through the mapper directly (the sim-projected door reaches it without the wire decode)
      expect(map_rows([{ ...damage_buff(missing), value: 20 }])).toHaveLength(0)
    }
  })

  test('the owner reader is the ONE home for the fid, and it refuses every unreadable shape', () => {
    expect(fighter_fid(0)).toBe(0)
    expect(fighter_fid('1000')).toBe(MOB_FIGHTER_ID_BASE)
    for (const bad of [null, undefined, '', false, true, {}, [], 'mob-0', -1, 1.5, NaN])
      expect(fighter_fid(bad), `${JSON.stringify(bad)} is not a fighter id`).toBeNull()
  })

  test('an out-of-range owner is still dropped — a fid nobody seats attributes to nobody', () => {
    expect(map_rows(read_fighter_statuses(fight_json(damage_buff(7))))).toHaveLength(0) // seat 7 of 1
    expect(map_rows(read_fighter_statuses(fight_json(damage_buff(MOB_FIGHTER_ID_BASE + MOBS))))).toHaveLength(0)
  })
})
