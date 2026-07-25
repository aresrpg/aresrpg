// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/ground_probe.js — "is the land under the board actually there yet?"
//
// The tactical board samples the REAL terrain per cell at build() time, so mounting before the streaming
// ring has resolved the site drops the board onto whatever the column happened to hold — measured on the
// engine demo as a deep underground pocket (origin_y=32 while the real surface was 127). Two guards, the
// demo's D167-B discipline: (1) require AIR high above the site, which proves the SURFACE chunk streamed
// rather than just a cave, and (2) require the surface read to repeat before trusting it.
//
// Every input is injected (block oracle, frame yield, clock), so the whole wait is provable in a bun test
// with no engine — the reason this lives beside the mount instead of inside it.

/** Above any terrain in the anchor band: air here proves the top column is resident. */
export const HIGH_SENTINEL = 190
/** Sea level + 2 — the honest floor when the ring never resolves. The board mounts; it never hangs. */
export const FALLBACK_SURFACE_Y = 130
export const GROUND_DEADLINE_MS = 20000
/** How many identical surface reads in a row are trusted (the column streams progressively). */
export const STABLE_READS = 3

/**
 * Poll until the ground under (x, z) is resident AND stable, then return the world Y its top face sits at
 * (where the board floor rests). Resolves the fallback on timeout — never throws, never hangs.
 * @param {object} args
 * @param {(x: number, y: number, z: number) => number} args.sample_block block id at a world position
 * @param {(x: number, z: number) => number | null} args.surface_at the ground-discipline surface scan
 * @param {() => Promise<unknown>} args.next_frame yields a frame (rAF in the browser)
 * @param {() => number} args.now monotonic clock (ms)
 * @param {number} args.x @param {number} args.z
 * @returns {Promise<number>}
 */
export async function wait_for_ground({ sample_block, surface_at, next_frame, now, x, z }) {
  const started = now()
  let last = /** @type {number | null} */ (null)
  let stable = 1
  while (now() - started < GROUND_DEADLINE_MS) {
    // top-column air first: a solid at the sentinel means the surface chunk has NOT streamed in yet
    const surface = sample_block(x, HIGH_SENTINEL, z) === 0 ? surface_at(x, z) : null
    if (surface !== null) {
      stable = surface === last ? stable + 1 : 1
      last = surface
      if (stable >= STABLE_READS) return surface + 1 // the top FACE — the board floor plane
    }
    await next_frame()
  }
  return last !== null ? last + 1 : FALLBACK_SURFACE_Y
}

/** The identity of a MOUNTED board — same key ⇒ same terrain + geometry, so a repaint can skip the bake. */
export const board_mount_key = (/** @type {{anchor:{x:number,z:number},width:number,height:number}} */ board) =>
  `${board.anchor.x}:${board.anchor.z}:${board.width}x${board.height}`
