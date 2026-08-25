// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The fight-board AUTHORING tool (the ÷10 plan, Lever 1): boards are CONTENT now — this
// script runs the deterministic generator offline, keeps only fully-connected boards, and
// writes `seed/content/fight_boards.json`, the one authoring home the validator, the chain
// catalog, and the simulator all derive from. On-chain generation is dead; curation is not:
// rerun with more seeds (or hand-edit the JSON) and republish through the catalog doors.
//
//   bun scripts/generate_fight_boards.mjs [count=28] [first_seed=1]

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generate_board } from '../packages/fight/src/board_gen.ts'

const GRID_W = 20n
const GRID_CELLS = 380n

const count = Number(process.argv[2] ?? 28)
const first_seed = BigInt(process.argv[3] ?? 1)

const mask_get = (mask, cell) => (mask[Number(cell / 64n)] >> (cell % 64n)) & 1n
const neighbours = (cell) => {
  const x = cell % GRID_W
  const out = []
  if (x > 0n) out.push(cell - 1n)
  if (x + 1n < GRID_W) out.push(cell + 1n)
  if (cell >= GRID_W) out.push(cell - GRID_W)
  if (cell + GRID_W < GRID_CELLS) out.push(cell + GRID_W)
  return out
}

/** Every open cell (on-shape, not blocked) reachable from every other — ONE component. */
const fully_connected = ({ shape_mask, obstacles, holes }) => {
  const blocked = new Set([...obstacles, ...holes].map(Number))
  const open = []
  for (let cell = 0n; cell < GRID_CELLS; cell += 1n)
    if (mask_get(shape_mask, cell) === 1n && !blocked.has(Number(cell))) open.push(cell)
  if (open.length === 0) return false
  const seen = new Set([Number(open[0])])
  const frontier = [open[0]]
  while (frontier.length > 0) {
    const cell = frontier.pop()
    for (const next of neighbours(cell)) {
      if (mask_get(shape_mask, next) === 1n && !blocked.has(Number(next)) && !seen.has(Number(next))) {
        seen.add(Number(next))
        frontier.push(next)
      }
    }
  }
  return seen.size === open.length
}

const boards = []
let seed = first_seed
let scanned = 0
while (boards.length < count && scanned < 10_000) {
  const board = generate_board(seed)
  const enough_starts = board.start_cells_a.length > 0 && board.start_cells_b.length > 0
  if (enough_starts && fully_connected(board)) {
    boards.push({
      // masks are u64 words — STRINGS in JSON (the 2^53 law); cells are ≤380, plain numbers
      width: Number(board.width),
      height: Number(board.height),
      shape_mask: board.shape_mask.map(String),
      obstacles: board.obstacles.map(Number),
      holes: board.holes.map(Number),
      start_cells_a: board.start_cells_a.map(Number),
      start_cells_b: board.start_cells_b.map(Number),
    })
  }
  seed += 1n
  scanned += 1
}

if (boards.length < count) {
  console.error(`only ${boards.length}/${count} connected boards in ${scanned} seeds`)
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'seed', 'content', 'fight_boards.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, `${JSON.stringify({ version: 1, boards }, null, 2)}\n`)
console.log(`${boards.length} boards → seed/content/fight_boards.json (seeds ${first_seed}..${seed - 1n})`)
