// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PURE AoE-zone contract for the anchor AoE proof (aoe_zone.spec.ts) — zero Playwright, zero I/O, unit-tested
// by aoe_zone_test.ts (the click_verify idiom: the law lives in one testable home, the spec only gathers
// evidence and asserts these verdicts).
//
//   STAGE phase (pre-cast): find the nearest reachable cell whose cross-1 zone is fully on-board — every one
//   of its 4 orthogonal neighbors is real walkable terrain — with ≥1 living mob standing orthogonally adjacent.
//   Casting the self-centered cross-zone spell from that cell makes the expected zone EXACTLY the 5-cell cross
//   (no edge/void clipping ambiguity) and guarantees at least one enemy inside it.
//
//   VERDICT phase (post-commit): the per-entity AoE law over one committed zone cast, evaluated over ANY
//   oracle's rows (the display store and the chain object both feed the same function):
//   · a living non-caster fighter INSIDE the zone must LOSE hp (the effect applied);
//   · a fighter OUTSIDE the zone must be untouched (no zone leak);
//   · the CASTER is untouched even though it stands in the zone (the enemies-only target filter);
//   · a fighter already dead at cast time is exempt (nothing to apply).

import type { Cell } from './click_verify'

export type { Cell } from './click_verify'

export type Arena = { readonly width: number; readonly height: number; readonly cells: readonly number[] }
export type StageFighter = { readonly id: string; readonly cell: Cell; readonly dead: boolean }
export type StageState = { readonly me: StageFighter; readonly mobs: readonly StageFighter[]; readonly arena: Arena }

export type HpRow = { readonly id: string; readonly cell: Cell; readonly dead: boolean; readonly health: number }
export type ZoneVerdictRow = {
  readonly id: string
  readonly in_zone: boolean
  readonly expect: 'hit' | 'untouched'
  readonly before: number
  readonly after: number | null
  readonly ok: boolean
}
export type ZoneVerdicts = { readonly ok: boolean; readonly hits: number; readonly rows: readonly ZoneVerdictRow[] }

const key = (cell: Cell) => `${cell.x}:${cell.y}`
// The fixed probe order every board search in the rig uses (fight_mouse_helpers path_to) — deterministic BFS.
const ORTHO: readonly Cell[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

const in_bounds = (arena: Arena, cell: Cell) =>
  cell.x >= 0 && cell.y >= 0 && cell.x < arena.width && cell.y < arena.height
/** Real walkable terrain: on-board AND an open floor cell (arena.cells 0 — obstacles/holes are non-zero). */
const walkable = (arena: Arena, cell: Cell) =>
  in_bounds(arena, cell) && arena.cells[cell.y * arena.width + cell.x] === 0

/**
 * The cross-zone STAGE search: BFS outward from `me.cell` (fixed ORTHO order — nearest stage wins, ties by
 * probe order) over walkable, living-fighter-free cells. A cell is a stage when its 4 orthogonal neighbors are
 * ALL walkable terrain (occupied is fine — an occupied neighbor is an in-zone target; a void/obstacle/edge
 * neighbor would clip the painted zone below 5 cells) and ≥1 living mob stands on one of them. Returns the
 * stage plus the walk path (start excluded, stage included; `[]` when already standing on a stage), or null
 * when no stage is reachable.
 */
export function find_aoe_stage(state: StageState): { stage: Cell; path: Cell[] } | null {
  const { me, mobs, arena } = state
  const living = mobs.filter((mob) => !mob.dead)
  if (living.length === 0) return null
  const mob_keys = new Set(living.map((mob) => key(mob.cell)))
  const occupied = new Set(living.map((mob) => key(mob.cell)))
  const is_stage = (cell: Cell) =>
    ORTHO.every((step) => walkable(arena, { x: cell.x + step.x, y: cell.y + step.y })) &&
    ORTHO.some((step) => mob_keys.has(key({ x: cell.x + step.x, y: cell.y + step.y })))
  const queue: Array<{ cell: Cell; path: Cell[] }> = [{ cell: me.cell, path: [] }]
  const seen = new Set([key(me.cell)])
  while (queue.length) {
    const current = queue.shift()
    if (!current) break
    if (walkable(arena, current.cell) && is_stage(current.cell)) return { stage: current.cell, path: current.path }
    for (const step of ORTHO) {
      const cell = { x: current.cell.x + step.x, y: current.cell.y + step.y }
      const cell_key = key(cell)
      if (seen.has(cell_key) || !walkable(arena, cell) || occupied.has(cell_key)) continue
      seen.add(cell_key)
      queue.push({ cell, path: [...current.path, cell] })
    }
  }
  return null
}

/**
 * The per-entity zone-effect law over one committed cast. `before`/`after` are id-matched fighter rows from ONE
 * oracle (display store or chain read); zone membership is judged on the CAST-time (`before`) cell. A row whose
 * `after` is missing is a broken oracle read and fails loud (`after: null`, `ok: false`). `hits` counts the
 * rows the law expected to be hit — the caller asserts it ≥ 1 (a zone cast that could hit nobody proves nothing).
 */
export function zone_verdicts(input: {
  readonly zone: readonly Cell[]
  readonly caster_id: string
  readonly before: readonly HpRow[]
  readonly after: readonly HpRow[]
}): ZoneVerdicts {
  const zone_keys = new Set(input.zone.map(key))
  const after_by_id = new Map(input.after.map((row) => [row.id, row]))
  const rows = input.before.map((row) => {
    const in_zone = zone_keys.has(key(row.cell))
    const expect: 'hit' | 'untouched' = in_zone && !row.dead && row.id !== input.caster_id ? 'hit' : 'untouched'
    const after = after_by_id.get(row.id)?.health ?? null
    const ok = after !== null && (expect === 'hit' ? after < row.health : after === row.health)
    return { id: row.id, in_zone, expect, before: row.health, after, ok }
  })
  const hits = rows.filter((row) => row.expect === 'hit').length
  return { ok: rows.length > 0 && rows.every((row) => row.ok), hits, rows }
}
