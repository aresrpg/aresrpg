// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1214 + #1210 — ONE occupancy home. DungeonBoard.jsx composes its occupant rows from dungeon.escrow /
// dungeon.mobs and folds them through `@aresrpg/fight/occupancy`'s `occupancy_of` — the SAME index prediction's
// pre-fire snapshot uses (#1232), so the board and the prediction can never disagree about who holds a stacked
// cell. Every reader (the weapon target loop, the LOS blockers list, the free_cell trap footprint filter,
// flush_commit's target resolution) reads THAT map. A last-write-wins collapse let a corpse — it keeps
// its on-chain cell but never body-blocks — silently overwrite a live occupant sharing that cell (a mob walking
// onto its own kill's corpse), which (a) refused a legal weapon cast with a SILENT disarm (traced end-to-end
// against a real 353-input capsule replay, /tmp/aresrpg-lanes/sword-refusal-trace/FINDING_sword_refusal.md) and
// (b) let a live mob shadowed by that same corpse dodge LOS in the other direction. Separately, the free_cell
// trap footprint filter read the raw `occupied` map without the SAME `optimistic_vacated` compensator the move
// masks get two screens above it, so a JUST-KILLED cell (this turn's own drafted cast) blocked trap placement in
// the preview only — the chain and the sim both already accept it (#1210, PR #1213's exoneration; same
// candidate-sets-not-single-homed class as #1070).
//
// DungeonBoard.jsx imports the 3D engine (not headless-importable, no jsdom in this repo), so this follows the
// house pattern of its neighbours (dungeon_board_self_click.test.js, dungeon_board_cast_target_cap.test.js): the
// REAL closures are extracted VERBATIM from the shipped source and executed as real functions over literal
// fixture data — never reimplemented — so a green test proves the shipped algorithm, not a hand-written stand-in.
import { describe, expect, test } from 'bun:test'
import { lineOfSight } from '@aresrpg/fight/los'
import { occupancy_of } from '@aresrpg/fight/occupancy'

const GRID_W = 20
const enc = (x, y) => y * GRID_W + x
const manhattan = (a, b) => {
  const ax = a % GRID_W
  const ay = (a / GRID_W) | 0
  const bx = b % GRID_W
  const by = (b / GRID_W) | 0
  return Math.abs(ax - bx) + Math.abs(ay - by)
}

const src_promise = Bun.file(new URL('./DungeonBoard.jsx', import.meta.url)).text()

// Extracts the verbatim source between two markers and compiles it as a real function body.
// `strip_start`: true when start_marker is a WRAPPER to discard (e.g. `useMemo(() => {`, whose inner body is the
// payload, already ending in its own `return`); false when start_marker is itself the first statement of the
// payload (kept in the compiled body) — pass `return_expr` to append an explicit return for those (bare
// statements have no completion value `new Function` can hand back).
const extract = async (start_marker, end_marker, args, { strip_start = true, return_expr = null } = {}) => {
  const src = await src_promise
  const start = src.indexOf(start_marker)
  const end = src.indexOf(end_marker, start + start_marker.length)
  expect(start, `start marker not found: ${start_marker}`).toBeGreaterThan(-1)
  expect(end, `end marker not found: ${end_marker}`).toBeGreaterThan(start)
  const body_start = strip_start ? start + start_marker.length : start
  const body = src.slice(body_start, end) + (return_expr ? `\nreturn ${return_expr}` : '')
  // eslint-disable-next-line no-new-func -- executing the SHIPPED closure body verbatim, not test-authored logic
  return new Function(...args, body)
}

// The exact trace-capsule fixture (FINDING_sword_refusal.md, idx 231/246/259): the player's weapon kill left a
// corpse (m2) on cell 26; a fresh mob (m1) later walked onto it — same cell, dead occupant indexed LAST.
const ME = enc(6, 0) // manhattan(ME, 26) = 1 — matches the trace's caster@6
const STACK_CELL = 26
const stacked_dungeon = (mob_order) => ({
  escrow: [{ cell: ME, committed: { alive: true }, alive: true }],
  mobs: mob_order === 'alive_first' ? [{ cell: STACK_CELL, alive: true }, { cell: STACK_CELL, alive: false }]
      : [{ cell: STACK_CELL, alive: false }, { cell: STACK_CELL, alive: true }],
})

describe('#1214 — a corpse never shadows a living occupant sharing its cell', () => {
  test('① dead-after-alive (the trace order): the stacked cell resolves to the LIVING mob, weapon-castable', async () => {
    const build_occupied = await extract('const occupied = useMemo(() => {', '}, [dungeon])', ['dungeon', 'occupancy_of'])
    const occupied = build_occupied(stacked_dungeon('alive_first'), occupancy_of)
    const stacked = occupied.get(STACK_CELL)
    expect(stacked).toEqual({ kind: 'mob', alive: true, idx: 0 }) // m1 (alive), never m2 (the corpse, idx 1)

    // the exact weapon-branch mob-only loop (reach 1, ap_cost 4 — the trace's own weapon): a living occupant at
    // manhattan distance 1 must land in the castable set, which is all the silent disarm needed to never fire.
    const range_min = 1
    const range_max = 1
    const castable = new Set()
    for (const [cell, o] of occupied) {
      if (o.kind !== 'mob' || !o.alive) continue
      const d = manhattan(ME, cell)
      if (d < range_min || d > range_max) continue
      if (!lineOfSight(ME, cell, [])) continue
      castable.add(cell)
    }
    expect(castable.has(STACK_CELL)).toBe(true)
  })

  test('② order-reversal control (alive-after-dead): stays green whichever mob is indexed last', async () => {
    const build_occupied = await extract('const occupied = useMemo(() => {', '}, [dungeon])', ['dungeon', 'occupancy_of'])
    const occupied = build_occupied(stacked_dungeon('dead_first'), occupancy_of)
    // dead idx 0 first, alive idx 1 last — this order already "worked" by luck pre-fix; it must keep working post-fix.
    expect(occupied.get(STACK_CELL)).toEqual({ kind: 'mob', alive: true, idx: 1 })
  })

  test('③ LOS: a solo corpse between me and a live target never blocks sight; a corpse-shadowed live body still does', async () => {
    const build_occupied = await extract('const occupied = useMemo(() => {', '}, [dungeon])', ['dungeon', 'occupancy_of'])
    const build_los_blockers = await extract(
      'const los_blockers = [...obstacles]',
      '// P1 SELF-CAST (#55)',
      ['obstacles', 'occupied', 'me'],
      { strip_start: false, return_expr: 'los_blockers' }
    )

    const A = enc(5, 5)
    const B = enc(6, 5) // between A and C, straight line
    const C = enc(7, 5) // the live target, behind the corpse cell
    const me = { cell: A }

    // a solo corpse at B (nothing else shares its cell) — corpses never body-block.
    const solo_corpse = build_occupied({
      escrow: [{ cell: A, alive: true }],
      mobs: [{ cell: B, alive: false }, { cell: C, alive: true }],
    }, occupancy_of)
    const blockers_solo = build_los_blockers([], solo_corpse, me)
    expect(blockers_solo.includes(B)).toBe(false)
    expect(lineOfSight(A, C, blockers_solo)).toBe(true) // target still lit + castable

    // the SAME cell B, but a living mob shares it with the corpse, corpse indexed LAST (the trace's own shadowing
    // order, idx-231: the walked-onto corpse is the higher index) — the living occupant the fixed map now
    // resolves at B must block sight to whatever stands behind it.
    const shadowed = build_occupied({
      escrow: [{ cell: A, alive: true }],
      mobs: [{ cell: B, alive: true }, { cell: B, alive: false }, { cell: C, alive: true }],
    }, occupancy_of)
    const blockers_shadowed = build_los_blockers([], shadowed, me)
    expect(blockers_shadowed.includes(B)).toBe(true)
    expect(lineOfSight(A, C, blockers_shadowed)).toBe(false)
  })

  test('④ the target readout (flush_commit / hover) resolves the LIVING mob, never the corpse sharing its cell', async () => {
    const build_occupied = await extract('const occupied = useMemo(() => {', '}, [dungeon])', ['dungeon', 'occupancy_of'])
    const occupied = build_occupied(stacked_dungeon('alive_first'), occupancy_of)
    const tgt = occupied.get(STACK_CELL)
    // flush_commit's committed_target_alive / any hover panel reads THIS idx — it must be the living mob's (0),
    // never the corpse's (1), or the readout describes a dead mob's hp.
    expect(tgt.idx).toBe(0)
    expect(tgt.alive).toBe(true)
  })
})

describe('#1210 — the free_cell trap footprint reads the SAME optimistic_vacated the move masks already get', () => {
  const build_filter = () =>
    extract(
      'if (lvl?.free_cell === true)',
      '// FIX 4 casts_per_target',
      ['lvl', 'footprint', 'occupied', 'optimistic_vacated'],
      { strip_start: false }
    )
  const alive_occupied = (cell) => new Map([[cell, { kind: 'mob', alive: true, idx: 0 }]])

  test('⑤ a cell THIS turn already vacates (optimistic_vacated) is OFFERED for free_cell placement', async () => {
    const filter = await build_filter()
    const footprint = new Set([STACK_CELL])
    // committed truth still says the mob is alive (my own drafted kill hasn't landed on chain yet) — the exact
    // window #1210's fold test (trap_on_corpse_cell.test.js) proves is BY DESIGN, compensated by optimistic_vacated.
    filter({ free_cell: true }, footprint, alive_occupied(STACK_CELL), new Set([STACK_CELL]))
    expect(footprint.has(STACK_CELL)).toBe(true)
  })

  test('⑥ control — a living mob\'s cell NOT vacated this turn stays refused for traps', async () => {
    const filter = await build_filter()
    const footprint = new Set([STACK_CELL])
    filter({ free_cell: true }, footprint, alive_occupied(STACK_CELL), new Set()) // nothing vacated
    expect(footprint.has(STACK_CELL)).toBe(false)
  })
})
