// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AP-AFFORDABILITY WASH GATE + TRAP DRAFT PAINT:
//  · "range highlight persists post-cast" — the cast wash must clear (and the idle MP wash return) the moment
//    the LIVE folded AP can't afford one more cast of the armed spell; wash_armed_spell is the pure verdict.
//  · "casting a trap paints its marker optimistically at cast" — the click-time fold + drop/fail/turn-boundary
//    rollback seams live in DungeonBoard; the wiring contract is pinned here (the fold home itself lives in
//    @aresrpg/fight my_traps_fold.test.js; the render/legality/receipt collapse in trap_home_collapse.test.js).

import { describe, expect, test } from 'bun:test'
import { create_fight_store } from '@aresrpg/fight/store'
import * as project from '@aresrpg/fight/project'
import { encode } from '@aresrpg/fight/los'

import { wash_armed_spell, seed_range_of, tackle_float_payloads } from './voxel_fight_folds.js'

describe('wash_armed_spell — the cast wash paints only while one more cast is affordable', () => {
  test('the weapon sentinel gates on the escrow ap_cost: affordable paints, spent clears', () => {
    const inputs = { armed_spell_id: '__weapon_attack', is_weapon: true, weapon_ap_cost: 4 }
    expect(wash_armed_spell({ ...inputs, active_ap: 6 })).toBe('__weapon_attack')
    expect(wash_armed_spell({ ...inputs, active_ap: 3 })).toBeNull() // one strike short — the blue wash clears
  })

  test('nothing armed ⇒ null (the idle MP default owns the board)', () => {
    expect(wash_armed_spell({ armed_spell_id: null, active_ap: 6 })).toBeNull()
  })
})

// ── #1093 RED-FIRST — "the board's cell-paint stack is DARK: the MP move-range wash is absent on turns" ──────
// THE MECHANISM: #1077 moved every board surface off `levels[0]` onto the seat's OWN rank row
// (`seat_spell_row` — `levels[rank - 1]`, the rank the chain's `spell_levels` names). A rank the corpus never
// authored — and any id the corpus cannot resolve at all — yields NO row. `wash_armed_spell` then priced that
// missing row at 0 AP and called it AFFORDABLE, which is what flips the board into cast mode and suppresses the
// green MP wash; `seed_range_of` read the SAME missing row and returned null, so no blue cast range ever
// replaced it. Green off, blue never on: every base channel goes dark the instant such a spell is armed.
//
// THE RULE (one sentence): an arm the board cannot paint a range for is NOT a wash-armed spell — the idle MP
// wash keeps the board, and the adapter names the unpaintable arm out loud instead of going dark.
const FIGHT_ID = '0xwash-armed'
const MY_ADDRESS = '0xowner'
const at = (x, y) => encode(x, y)

/** One seat on its own turn with MP to spend and no adjacent locker — a plain, fully-green move wash. */
const open_my_turn = () => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT_ID,
    my_key: null,
    ctx: { address: MY_ADDRESS, roster: [{ id: 'c1', name: 'Kaelen' }], my_entity_id: 'c1', spectator: false },
  })
  store.getState().input({
    type: 'snapshot',
    version: 1,
    fight: {
      id: FIGHT_ID,
      width: 20,
      height: 19,
      status: 1,
      participants: [
        {
          owner: MY_ADDRESS,
          character: 'c1',
          class: 'senshi',
          team: 0,
          hp: 40,
          max_hp: 40,
          ap: 6,
          mp: 5,
          base_ap: 6,
          base_mp: 5,
          cell: at(2, 5),
          ready: true,
          casts_this_turn: 0,
          stats: { agility: 0 },
          base_stats: { range: 0 },
        },
      ],
      mobs: [{ template: '0xmob', level: 1, hp: 20, max_hp: 20, cell: at(15, 15), ap: 4, mp: 3, alive: true }],
      group_template: '0xgroup',
      group_base_ap: 4,
      group_base_mp: 3,
      obstacles: [],
      holes: [],
      start_cells_a: [at(2, 5)],
      start_cells_b: [at(15, 15)],
      queue: [
        { is_mob: false, idx: 0 },
        { is_mob: true, idx: 0 },
      ],
      turn_ptr: 0,
      turn_deadline_ms: 1_700_000_000_000,
      placement_deadline_ms: 0,
      world_seed: 1,
      spawn_id: 1,
      anchor_x: 0,
      anchor_z: 0,
      shape_mask: [],
      invisibility_statuses: [],
    },
  })
  return store
}

describe('#1093 — an arm the board cannot paint never suppresses the MP wash', () => {
  test('a spell with no resolvable rank row is NOT wash-armed — the same row that has no range has no cost', () => {
    const seat = { spell_levels: {} }
    // precondition: this is exactly the unpaintable case — the ONE range door refuses it
    expect(seed_range_of('not_a_seeded_spell', seat)).toBeNull()
    // …so it may not arm the wash. It used to, at a free 0 AP, from that same absent row.
    expect(wash_armed_spell({ armed_spell_id: 'not_a_seeded_spell', active_ap: 6, seat })).toBeNull()
    expect(wash_armed_spell({ armed_spell_id: 'not_a_seeded_spell', active_ap: 0, seat })).toBeNull()
  })

  test('the weapon sentinel is untouched — it has no seed row BY DESIGN and prices off the escrow', () => {
    const inputs = { armed_spell_id: '__weapon_attack', is_weapon: true, weapon_ap_cost: 4, seat: {} }
    expect(wash_armed_spell({ ...inputs, active_ap: 6 })).toBe('__weapon_attack')
    expect(wash_armed_spell({ ...inputs, active_ap: 3 })).toBeNull()
  })

  test('THE BOARD STAYS LIT: the green MP wash survives an unpaintable arm (the reported blackout)', () => {
    const store = open_my_turn()
    const seat = { spell_levels: {} }
    // the adapter's exact composition: the fold's verdict is what `targeting` rides into the core's wash
    const wash_armed = wash_armed_spell({ armed_spell_id: 'not_a_seeded_spell', active_ap: 6, seat })
    const wash = project.move_wash(store.getState(), { busy: false, targeting: !!wash_armed })
    // RED before the fix: wash_armed was truthy ⇒ targeting ⇒ reach [] ⇒ no green, and seed_range_of null ⇒ no
    // blue either. Every base channel dark on a live turn.
    expect(wash.reach.length).toBeGreaterThan(0)
  })

  test('CONTRACT: an unpaintable arm names itself — the adapter never goes dark in silence', async () => {
    const source = await Bun.file(new URL('./voxel_fight_adapter.js', import.meta.url)).text()
    expect(source).toContain('unpaintable_arm_key')
    expect(source).toContain("no seed row at the seat's rank") // the log line, not a swallowed branch
    expect(source).toContain('console.error(')
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

  test('a tackled receipt beat routes through the same hit-beat player as ordinary damage', async () => {
    const source = await Bun.file(new URL('./voxel_fight_adapter.js', import.meta.url)).text()
    expect(source).toContain("else if (spec.kind === 'damage' || spec.kind === 'heal') await play_damage_beat(payload)")
    const tackled_start = source.indexOf("else if (spec.kind === 'tackled'")
    const tackled_end = source.indexOf('// #170', tackled_start)
    const tackled_branch = source.slice(tackled_start, tackled_end)
    expect(tackled_branch).toContain('await play_damage_beat(payload, { floater: null })')
    expect(tackled_branch).not.toContain('board.entity_beat')
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

  test('CONTRACT: a bitten move folds the forfeit through the SAME action the receipt folds', async () => {
    // The optimistic move EXECUTION consults the SAME seed contest the paint does. Headless-pinned end-to-end in
    // @aresrpg/fight test/tackle_move_gate.test.js (next_move_tackle → exact forfeit). This row pins the React
    // WIRING of the FORFEIT half only; the walk half — #239's toll, where a bitten move still walks the
    // affordable prefix — is owned by dungeon_board_tackle_reach_gate.test.js, its one home.
    const source = await Bun.file(new URL('../game/screens/hud/world/DungeonBoardInput.jsx', import.meta.url)).text()
    expect(source).toContain('const bite = next_move_tackle(fight_store.getState())')
    expect(source).toContain('synthetic_tackled_events') // predict_tackle rides the hit-anim + forfeit beat
    expect(source).toMatch(/intent: \{ kind: 'Tackled'/) // …folding the SAME action the receipt folds
  })

  test('CONTRACT: DungeonBoard has one trap ledger and rolls back only the flush result', async () => {
    const source = await Promise.all([
      Bun.file(new URL('../game/screens/hud/world/DungeonBoardInput.jsx', import.meta.url)).text(),
      Bun.file(new URL('../game/screens/hud/world/DungeonBoardCommit.jsx', import.meta.url)).text(),
    ]).then((parts) => parts.join('\n'))
    // The draft click folds the trap optimistically (at cast, not at commit) through the fight reducer.
    expect(source).toContain('place_traps: prediction.placed_traps ?? []')
    // A dropped trap draft is collected for rollback at flush.
    expect(source).toContain('trap_dropped = [...trap_dropped, entry.cell]')
    // A failed commit rolls every drafted cell back through that same fold.
    expect(source).toContain("input({ type: 'drop_traps', cells: store_dropped })")
    // There is no component-local trap writer and no end-turn trap clear.
    expect(source).not.toContain('pending_trap_cells')
    expect(source).not.toContain("input({ type: 'drop_traps', cells: drop })")
  })

  test('CONTRACT: each authoritative trap beat retires its identified fold row', async () => {
    const source = await Bun.file(new URL('./voxel_fight_adapter.js', import.meta.url)).text()
    expect(source).toContain("type: 'trap_triggered'")
    expect(source).toContain('anchor: payload.trap_anchor')
    expect(source).toContain('trigger_id: payload.trigger_id')
  })
})
