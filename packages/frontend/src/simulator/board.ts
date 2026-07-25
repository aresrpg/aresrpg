// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/board.ts — the simulator's BOARD DERIVATION (docs/design/simulator_rebuild_spec.md §4.2).
//
// The board is not state: it is a pure function of the page's ONE determinism seed and a reroll counter.
// `anchor_of(seed, nonce)` draws the world anchor off the seed's own prng stream (reroll = simply the NEXT
// draw of that stream — no entropy ever enters the reducer), and `board_of` folds it through the REAL chain
// derivation — `@aresrpg/sim/board_gen` `board_seed_from_anchor` + `generate`, the board.move twin the live
// game's fights are cut from. Nothing here is stored: persisting a generated board would let a hand-edited
// IndexedDB row disagree with its own seed (the one-home law), and re-deriving costs microseconds.
//
// DIVERGENCE FROM THE SPEC's §6 sketch, deliberate: the spec's state field is `board: {anchor, generated}`.
// Storing `generated` duplicates a derivable fact, so the reducer keeps only `anchor_nonce` (a u32 counter)
// and every consumer reads `board_of(seed, nonce)` — same board, one home, reload-proof by construction.
//
// The mask/cell decodes are the PRODUCTION ones (`@aresrpg/fight` board_state/los), never a local bit twin.

import { generate, board_seed_from_anchor } from '@aresrpg/sim/board_gen'
import { WORLD_SEED } from '@aresrpg/sim/world'
import { rng_seed, rng_range, mix } from '@aresrpg/sim/prng'
import { decode_shape_mask } from '@aresrpg/fight/board_state'
import { decode, encode } from '@aresrpg/fight/los'

/** A board-local cell — the engine's {x,y} vocabulary (x east, y north from the board origin). */
export type SimCell = { x: number; y: number }
/** The world block the board's min corner sits on (the terrain the board is grounded over). */
export type SimAnchor = { x: number; z: number }

export type SimBoard = {
  anchor: SimAnchor
  /** the u32 the chain derivation folds (world seed ⊕ anchor primes) — shown in the top bar */
  board_seed: number
  width: number
  height: number
  /** raised blockers (LOS + pathing) */
  obstacles: readonly SimCell[]
  /** pits — impassable, rendered as dark shafts */
  holes: readonly SimCell[]
  /** cells inside the w×h rect but OUTSIDE the deterministic shape (D231: rendered as nothing) */
  voids: readonly SimCell[]
  /** ALLY band, encoded stride-20 — where the roster is placed (blue) */
  start_cells_a: readonly number[]
  /** ENEMY band, encoded stride-20 — where mobs are picked (red) */
  start_cells_b: readonly number[]
}

/** How far from the world origin an anchor may roll — a band of genuinely varied, streamable terrain. */
export const ANCHOR_SPAN = 2048

/**
 * The world anchor for `(seed, nonce)`: two draws off a stream seeded by the sim's own decorrelating fold of
 * the pair (`prng.js mix` — the same scrambler `turn_seed` derives its slots with). O(1) in the nonce, so a
 * thousand rerolls cost what the first one did, and the anchor is reachable from the two persisted numbers.
 */
export const anchor_of = (seed: number, nonce: number): SimAnchor => {
  const state = rng_seed(mix(seed >>> 0, Math.max(0, Math.trunc(nonce))))
  const x = rng_range(state, -ANCHOR_SPAN, ANCHOR_SPAN)
  const z = rng_range(x.state, -ANCHOR_SPAN, ANCHOR_SPAN)
  return { x: x.value, z: z.value }
}

const cells_of = (encoded: readonly number[]): SimCell[] => encoded.map((cell) => decode(cell))

/** Derive the full board layout for `(seed, nonce)` — the chain's own generator, decoded for the renderer. */
const derive_board = (seed: number, nonce: number): SimBoard => {
  const anchor = anchor_of(seed, nonce)
  const board_seed = board_seed_from_anchor(WORLD_SEED, anchor.x, anchor.z)
  const { width, height, shape_mask, obstacles, holes, start_cells_a, start_cells_b } = generate(board_seed, 0)
  const in_shape = decode_shape_mask(shape_mask)
  // D231 — the cells inside the w×h rect that the deterministic shape does NOT cover: the engine renders
  // nothing there, which is what makes a generated board organic instead of a square.
  const voids = Array.from({ length: width * height }, (_, index) => ({
    x: index % width,
    y: Math.floor(index / width),
  })).filter(({ x, y }) => !in_shape.has(encode(x, y)))
  return {
    anchor,
    board_seed,
    width,
    height,
    obstacles: cells_of(obstacles),
    holes: cells_of(holes),
    voids,
    start_cells_a,
    start_cells_b,
  }
}

// A one-entry memo: the board pane re-derives on every render/paint and the reducer validates every pick
// against it, so the same (seed, nonce) is asked for dozens of times per interaction. Referentially
// transparent — `derive_board` is pure, the cache only skips repeated work.
let memo: { key: string; board: SimBoard } | null = null

/** The board for `(seed, nonce)`. Pure (memoized) — the ONE door every consumer reads the layout through. */
export const board_of = (seed: number, nonce: number): SimBoard => {
  const key = `${seed >>> 0}:${Math.max(0, Math.trunc(nonce))}`
  if (memo?.key === key) return memo.board
  const board = derive_board(seed >>> 0, nonce)
  memo = { key, board }
  return board
}

/** The engine `board.build` spec for a derived board, grounded at `origin`. */
export const build_spec_of = (board: Readonly<SimBoard>, origin: Readonly<{ x: number; y: number; z: number }>) => ({
  grid_w: board.width,
  grid_h: board.height,
  obstacles: board.obstacles as SimCell[],
  holes: board.holes as SimCell[],
  voids: board.voids as SimCell[],
  clear_footprint: true,
  anchor: { origin },
})
