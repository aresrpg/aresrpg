// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #2000 RED-FIRST — THE DECODE DOOR DELETED A ROW THE CHAIN SAYS EXISTS.
//
// `read_fighter_statuses` is the wire door: a raw `json:true` Fight document in, the fighter-status rows the
// whole HUD/fold/prediction stack reads out. It refused every row whose `remaining_turns` failed `> 0` — the
// superseded decrement law. Under D42 the counter is the bearer's turns STILL TO COME, so a 0 is a row on its
// LAST covered turn: on chain it is live, it ticks, it modifies stats, and `decrement_fighter_statuses` only
// removes it at the START of the bearer's next turn. A poll landing inside that window therefore made the badge,
// the buff and the invisibility haze VANISH a full turn early — and a decode door that silently drops rows the
// chain states is the instruments-throw failure, not a filter.

import { describe, expect, test } from 'bun:test'

import * as SE from '../../sim/src/spell_effect.js'
import { read_fighter_statuses } from '../src/fight_status_snapshot.js'

/** A raw chain status row exactly as `Fight.fx.statuses` carries it (value still 32768-CENTERED on the wire). */
const wire_row = (over = {}) => ({
  fighter: 0,
  kind: SE.K_ALTER_STAT,
  remaining_turns: 2,
  source: 0,
  effect: { kind: SE.K_ALTER_STAT, stat: SE.STAT_STRENGTH, value: 32768 + 20, element: 255, chance: 100, turns: 2 },
  ...over,
})

const fight_json = (rows) => ({ fx: { statuses: rows } })

describe('#2000 · the decode door states every row the chain holds, 0-counter included', () => {
  test('RED: a row on its last covered turn survives the wire decode with its counter intact', () => {
    const rows = read_fighter_statuses(fight_json([wire_row({ remaining_turns: 0 })]))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      fighter: 0,
      kind: SE.K_ALTER_STAT,
      remaining_turns: 0,
      stat: SE.STAT_STRENGTH,
      value: 20, // decoded off the wire's 32768 centering, exactly as a live row is
    })
  })

  test('RED: an invisibility row on its last covered turn is still read — the haze holds to the end', () => {
    const invis = wire_row({
      kind: SE.K_INVISIBILITY,
      remaining_turns: 0,
      effect: { kind: SE.K_INVISIBILITY, turns: 0 },
    })

    expect(read_fighter_statuses(fight_json([invis]))).toHaveLength(1)
  })

  test('the door still refuses what it cannot state: no owner, no kind, no number', () => {
    expect(read_fighter_statuses(fight_json([wire_row({ fighter: null })]))).toEqual([])
    expect(read_fighter_statuses(fight_json([wire_row({ kind: 'not-a-kind', effect: {} })]))).toEqual([])
    expect(
      read_fighter_statuses(fight_json([wire_row({ remaining_turns: 'soon', effect: { kind: SE.K_ALTER_STAT } })]))
    ).toEqual([])
  })
})
