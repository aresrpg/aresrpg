// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD-BOARD SEAT — robust grounding for a world fight board (the async/IO wrapper over the pure seat folds).
//
// A world fight's board seats FLAT on open terrain. Sampling the ground at the SINGLE anchor column was
// unreliable BOTH directions: a low/forest/water column read too low (or null → a player-Y fallback) so the
// board sank BELOW the land; and terrain elsewhere in the footprint then poked THROUGH it. The cure: sample the
// WHOLE footprint over the streamed terrain and seat on the dominant HIGH plane (never below the land). The
// render-side footprint clear (board_occlusion) carves anything still poking above → both failure modes die
// together: never below, never intruded. The pure math lives in world-shell/voxel_fight_folds.js; this owns
// only the live sampling + the settle-wait.
//
// DETERMINISM LAW (a refresh used to teleport the board 20 cells): the SAME fight must seat
// IDENTICALLY on every boot. The X/Z anchor is chain-derived (origin = anchor − half — deterministic). The Y is
// terrain-derived, so it must be sampled from the FULLY-STREAMED footprint: worldgen is seed-deterministic, so
// once every footprint chunk is resident the surface set is byte-identical across boots → the p90 seat is
// identical. The old code seated after only a FIFTH of columns resolved — which fifth depends on chunk STREAM
// ORDER, so the p90 (and the board's Y) drifted 20 cells across refreshes. We now WAIT until streaming QUIESCES
// (the resolved-column count plateaus) before seating, never from a partial stream-order-dependent sample.

import { seat_surface_y, topmost_solid_id } from '@aresrpg/engine3/player'

import { world_footprint_columns, world_seat_from_surfaces } from '../world-shell/voxel_fight_folds.js'

/** Bounded wait for the footprint terrain to STREAM + QUIESCE before seating (deterministic Y needs the full
 *  settled sample; raised from 1500 ms — a full settle needs headroom over the old 20%-partial early-out). */
const STREAM_SETTLE_MS = 4000
const POLL_MS = 100
/** Consecutive polls with NO new resolved column ⇒ streaming has quiesced (the footprint holds its FULL,
 *  deterministic surface set). A short run of stable polls rides across a two-batch chunk stream landing over a
 *  frame gap without falsely declaring "settled" between batches. */
const STABLE_POLLS = 3
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms))

/** Error `.code` thrown when the footprint is UNPLACEABLE: it streamed ZERO columns after the bounded wait, so
 *  its terrain doesn't exist (a raw-chain-coords regression ~250k away, OR a mid-range void). The voxel fight
 *  adapter catches it → one honest toast, no board mounted, no re-seat loop. */
export const WORLD_BOARD_UNPLACEABLE = 'WORLD_BOARD_UNPLACEABLE'
/** DIAGNOSTIC ONLY (no longer a gate): the distance beyond which a zero-column footprint is a raw-chain-coords
 *  regression rather than a mid-range void. The refuse trigger is the zero-column footprint itself (a void seats
 *  the board nowhere at ANY distance); this just colours the log "coords regression" vs "void terrain". 500 is a
 *  generous ceiling — a correctly-translated anchor lands within a few blocks of the player. */
const SANITY_DIST_BLOCKS = 500

/** ROOT CLAMP (P0 — a fight was once lost to a 210-block void seat): beyond this many blocks from the ENGAGING
 *  player, a world-fight anchor is NOT the group the player just engaged. world_spawns claims within PROXIMITY_M=6
 *  and the board's own half-extent adds only a handful more, so a legitimate anchor lands ≲20 blocks away; a far
 *  value is a stale / zone-mismatched chain anchor that would seat the board into ungenerated terrain (which then
 *  refused, then stranded the live fight). A world fight ALWAYS happens where the player stands, so re-center on
 *  the player's own cell instead of trusting a far anchor. 64 = two chunks: comfortably past any legitimate
 *  engage-range anchor, far short of the regression distance. */
const MAX_ANCHOR_DRIFT = 64
/** Bounded outward-walk reach (blocks): if the seat centre's own footprint streamed ZERO columns, spiral out to
 *  the NEAREST footprint that DOES stream rather than refuse. Near-dead now the centre is player-clamped (the
 *  player's cell is always resident), but it rides a fresh-chunk-boundary gap without stranding the fight. */
const WALK_MAX_BLOCKS = 48

/** Sample a footprint centred on (cx, cz) over the live terrain → its resolved GROUND surfaces (non-null only).
 *  seat_surface_y finds the ground UNDER any tree canopy (a fight board seats on the ground and the render clear
 *  carves the trees above), so a forested footprint resolves instead of reading as void. Pure over the block
 *  oracle; used for the outward-walk probes. */
function footprint_surfaces(sample, cx, cz, half_x, half_z, step) {
  return world_footprint_columns(cx, cz, half_x, half_z, step)
    .map(([x, z]) => seat_surface_y(sample, x, z))
    .filter((y) => y !== null)
}

/** Spiral outward from (cx, cz) in `step`-spaced rings (bounded by WALK_MAX_BLOCKS) for the NEAREST footprint that
 *  streams ≥1 column; returns `{ x, z, surfaces }` or null when the whole neighbourhood is void. Synchronous — the
 *  chunk stream already quiesced, so nearby terrain is either resident or genuinely absent. */
function nearest_streamable_footprint(sample, cx, cz, half_x, half_z, step) {
  const s = Math.max(1, Math.floor(step))
  for (let r = s; r <= WALK_MAX_BLOCKS; r += s) {
    let best = /** @type {{ x:number, z:number, surfaces:number[] } | null} */ (null)
    for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [r, -r], [-r, r], [-r, -r]]) {
      const surfaces = footprint_surfaces(sample, cx + dx, cz + dz, half_x, half_z, step)
      if (surfaces.length > 0 && (!best || surfaces.length > best.surfaces.length))
        best = { x: cx + dx, z: cz + dz, surfaces }
    }
    if (best) return best // the first (nearest) ring with any streamable footprint wins
  }
  return null
}

/**
 * Resolve a world fight board's origin: CLAMP the seat centre to the player (a world fight is always within engage
 * range — a far chain anchor is stale and would seat into the void), sample the footprint over the LIVE terrain,
 * WAIT for the chunk-stream to quiesce (so the sample is the FULL, seed-deterministic surface set — identical on
 * every boot), seat the flat board on the dominant HIGH plane (never below the land), and — if the centre streamed
 * nothing — WALK outward (bounded) to the nearest streamable ground before refusing. Origin = centre − half. The Y
 * is the ONLY terrain-derived quantity; X/Z come from the (clamped) centre. The board SHAPE still derives from the
 * raw chain anchor (fight_bridge board twin) — only the WORLD POSITION follows the player.
 * @param {object} p
 * @param {(x: number, y: number, z: number) => number} p.sample live block-id oracle (streamed terrain)
 * @param {{ x: number, z: number }} p.anchor the chain-derived board centre (world XZ) — the IDEAL seat, used only
 *   while it is within engage range of the player; a far value is re-centered on the player (see MAX_ANCHOR_DRIFT)
 * @param {() => number} p.player_y last-resort Y (the nearby player's feet) when nothing streamed
 * @param {() => { x: number, z: number }} [p.player_xz] the player's world XZ — the CLAMP target (a far anchor
 *   re-centers here) AND the void guard (zero columns even at the player → throw WORLD_BOARD_UNPLACEABLE, never a
 *   player-Y seat into the void). Omit to disable both (headless/unit use → the anchor is authoritative, player-Y
 *   fallback still applies).
 * @param {number} p.half_x @param {number} p.half_z footprint half-extents (world m)
 * @param {number} p.step footprint sample spacing (world m)
 * @param {number} [p.settle_ms] bounded settle-wait (test override)
 * @param {number} [p.poll_ms] poll cadence (test override)
 * @param {number} [p.stable_polls] quiesce run length (test override)
 * @param {(ms: number) => Promise<void>} [p.wait_for_poll] poll scheduler (test override)
 * @returns {Promise<{ x: number, y: number, z: number }>}
 */
export async function resolve_world_board_origin({
  sample,
  anchor,
  player_y,
  player_xz,
  half_x,
  half_z,
  step,
  settle_ms = STREAM_SETTLE_MS,
  poll_ms = POLL_MS,
  stable_polls = STABLE_POLLS,
  wait_for_poll = sleep,
}) {
  // ── ROOT CLAMP: a world fight ALWAYS happens within engage range of the player, so the board seats where the
  // player STANDS. Trust the chain anchor only while it is plausibly the engaged group (within MAX_ANCHOR_DRIFT →
  // deterministic AND streamed); a far anchor is a stale / zone-mismatched chain value → re-center on the player's
  // own cell (always resident, never void). player_xz absent ⇒ headless/unit: no clamp (the anchor is authoritative).
  let center = { x: anchor.x, z: anchor.z }
  if (player_xz) {
    const p = player_xz()
    const drift = Math.hypot(anchor.x - p.x, anchor.z - p.z)
    if (drift > MAX_ANCHOR_DRIFT) {
      console.warn(
        `[voxel] world-fight anchor (${anchor.x}, ${anchor.z}) is ${Math.round(drift)} blocks from the engaging player (${Math.round(p.x)}, ${Math.round(p.z)}) — past the ${MAX_ANCHOR_DRIFT}-block engage range; re-centering the board on the player's cell (a stale/mismatched chain anchor, NOT seating into the void).`
      )
      center = { x: p.x, z: p.z }
    }
  }

  const cols = world_footprint_columns(center.x, center.z, half_x, half_z, step)
  const deadline = now() + settle_ms
  let surfaces = /** @type {number[]} */ ([])
  let prev_count = -1
  let stable = 0
  for (;;) {
    surfaces = /** @type {number[]} */ (cols.map(([x, z]) => seat_surface_y(sample, x, z)).filter((y) => y !== null))
    // Quiesced? the resolved-column count stopped growing (streaming delivered no new ground this poll) — the
    // footprint now holds its FULL, deterministic surface set. Only count a plateau once SOME ground resolved
    // (an all-null early poll isn't "settled", it's "unstreamed").
    if (surfaces.length > 0 && surfaces.length === prev_count) {
      if (++stable >= stable_polls) break
    } else {
      stable = 0
    }
    prev_count = surfaces.length
    if (now() >= deadline) break
    await wait_for_poll(poll_ms)
  }
  const settled = stable >= stable_polls
  let seat = world_seat_from_surfaces(surfaces) // p90 over the SETTLED full sample — deterministic across boots

  // ── OUTWARD WALK (clamped-to-streamed): the centre streamed ZERO columns — walk outward (bounded) to the NEAREST
  // streamable footprint and seat THERE, rather than refuse. Near-unreachable now the centre is player-clamped (the
  // player's own cell is inside the footprint), but it rides a fresh-chunk-boundary gap without stranding the fight.
  if (seat === null) {
    const walked = nearest_streamable_footprint(sample, center.x, center.z, half_x, half_z, step)
    if (walked) {
      const { x, z, surfaces: found } = walked
      console.warn(
        `[voxel] world-fight centre (${center.x}, ${center.z}) streamed 0 columns — walked ${Math.round(Math.hypot(x - center.x, z - center.z))} blocks to the nearest streamable ground (${x}, ${z}).`
      )
      center = { x, z }
      surfaces = found
      seat = world_seat_from_surfaces(found)
    }
  }

  // ── REFUSE (last resort — should be UNREACHABLE now the centre is player-clamped): zero columns at the centre AND
  // nothing streamable within the bounded walk, with a LIVE player ⇒ the whole neighbourhood is void. Seating at
  // player-Y on ZERO data floats the board into the void, the D188 floor net teleports the avatar home, the fight
  // re-seats it at the void board, and the two fight forever (a washing-machine reconcile loop that can freeze the
  // page). REFUSE loudly with the SAME signal the voxel adapter latches on (unplaceable_key) → one honest toast +
  // the stranded-fight escape, no board, no re-seat loop. player_xz absent ⇒ headless/unit: the guard stays
  // disabled and the player-Y fallback below still applies.
  if (seat === null && player_xz) {
    const p = player_xz()
    const dist = Math.hypot(center.x - p.x, center.z - p.z)
    // TWO-SOURCE HONEST DIAGNOSTIC (P0 2026-07-12): the old log GUESSED "void/ungenerated terrain" whenever 0
    // columns resolved — but the P0 cause was resident, RENDERED forest the SPAWN scan rejected as canopy (now
    // fixed: seat_surface_y reads ground UNDER the canopy). Probe the ground truth so the log can never lie again:
    // how many footprint columns hold ANY resident solid block (topmost_solid_id) vs how many resolved a seatable
    // ground (0 here). Resident solids present ⇒ NOT void — a seat-scan regression on streamed terrain (report it);
    // all-air ⇒ a genuine unstreamed void (the legitimate refusal, then bug-B retry + honest toast + exit).
    let resident = 0
    const top_ids = /** @type {Map<number, number>} */ (new Map())
    for (const [x, z] of cols) {
      const top = topmost_solid_id(sample, x, z)
      if (top !== null) {
        resident += 1
        top_ids.set(top, (top_ids.get(top) ?? 0) + 1)
      }
    }
    const top_summary = [...top_ids.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `id${id}×${n}`)
      .join(' ')
    const verdict =
      resident > 0
        ? `${resident}/${cols.length} columns hold RESIDENT solid terrain [${top_summary}] yet 0 resolved a seatable ground — a SEAT-SCAN REGRESSION on streamed terrain, NOT a void`
        : `all ${cols.length} columns read air — genuinely unstreamed${dist > SANITY_DIST_BLOCKS ? ` (coords regression: ${Math.round(dist)} > ${SANITY_DIST_BLOCKS} blocks from the player)` : ' void terrain'}`
    console.error(
      `[voxel] world-fight board REFUSED — footprint resolved 0/${cols.length} seatable columns after ${settle_ms}ms and no streamable ground within ${WALK_MAX_BLOCKS} blocks; centre (${center.x}, ${center.z}) is ${Math.round(dist)} blocks from the player: ${verdict}. NOT seating into the void. Report this.`
    )
    throw Object.assign(new Error('world-fight board footprint is unplaceable (0 columns streamed)'), {
      code: WORLD_BOARD_UNPLACEABLE,
    })
  }
  const y = seat ?? player_y()
  if (seat === null)
    console.warn(
      '[voxel] world-fight board footprint unstreamed after wait — seating at player Y (last resort, coords guard disabled)'
    )
  else if (!settled)
    console.warn(
      `[voxel] world-fight board seat DID NOT quiesce within ${settle_ms}ms — seating from a PARTIAL ${surfaces.length}/${cols.length} sample (Y may differ across boots)`
    )
  console.info(
    `[voxel] world-fight board @ seat (${center.x}, ${center.z}) → y=${y} from ${surfaces.length}/${cols.length} cols, settled=${settled} (D230 player-clamped deterministic seat)`
  )
  return { x: center.x - half_x, y, z: center.z - half_z }
}
