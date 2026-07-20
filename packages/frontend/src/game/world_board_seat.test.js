// DETERMINISTIC WORLD-BOARD SEAT — the fix for a refresh that used to teleport the board 20 cells down.
// The board's X/Z anchor is chain-derived (deterministic); its Y is terrain-derived, so it MUST be
// sampled from the FULLY-STREAMED footprint. Worldgen is seed-deterministic → once every footprint chunk is
// resident the surface set is byte-identical across boots → the p90 seat is identical. The old resolver seated
// after only a FIFTH of columns resolved, and WHICH fifth depends on chunk STREAM ORDER — so the p90 (the
// board's Y) drifted across refreshes. These lock: (1) the seat statistic is order-independent and (2) the
// resolver WAITS for the stream to quiesce, never seating from a partial stream-order-dependent sample.

import { describe, expect, it } from 'bun:test'

import { ground_surface_y, seat_surface_y } from '@aresrpg/engine3/player'

import { world_footprint_columns, world_seat_from_surfaces } from '../world-shell/voxel_fight_folds.js'
import { resolve_world_board_origin, WORLD_BOARD_UNPLACEABLE } from './world_board_seat.js'

// ── the footprint: anchor (0,0), half 4, step 2 ⇒ a 5×5 = 25-column grid. Heights: a height-64 plateau over
//    most of it + a height-40 low pit under 5 columns. Full-sample p90 lands on the plateau (64 ⇒ seat 65); a
//    partial that saw ONLY the low pit would p90 at 40 (⇒ seat 41). The gap is what proves "waited for settle".
const ANCHOR = { x: 0, z: 0 }
const HALF = 4
const STEP = 2
const PLATEAU_Y = 64
const PIT_Y = 40
const LOW_COLS = 5 // how many of the 25 columns sit in the pit

/** The 25 footprint columns in the SAME order world_footprint_columns emits them (x outer, z inner). */
function footprint_cols() {
  const cols = []
  for (let x = -HALF; x <= HALF; x += STEP) for (let z = -HALF; z <= HALF; z += STEP) cols.push([x, z])
  return cols
}

/** Per-column ground height: the first LOW_COLS columns (in cols order) are the pit (40), the rest plateau (64). */
function height_of(col_index) {
  return col_index < LOW_COLS ? PIT_Y : PLATEAU_Y
}

/**
 * A mock block oracle that STREAMS the footprint in `reveal_order` (an array of column indices), a BATCH of
 * columns becoming resident per resolver POLL. Poll boundaries are detected deterministically (no timers) from
 * the resolver's own scan: it scans cols in a fixed order each poll, so the first column's top-y call marks a
 * new poll. An un-revealed column reads air everywhere (⇒ ground_surface_y returns null = "unstreamed").
 * @param {number[]} reveal_order column indices, earliest-streamed first
 * @param {number} batch columns that become resident each poll
 */
function make_streaming_sample(reveal_order, batch) {
  const cols = footprint_cols()
  const key = (/** @type {number} */ x, /** @type {number} */ z) => `${x},${z}`
  const index_of = new Map(cols.map(([x, z], i) => [key(x, z), i]))
  const first = cols[0]
  let top_y = /** @type {number | null} */ (null)
  let poll = 0
  return (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
    if (top_y === null) top_y = y // the resolver's very first scan call is (col0.x, WORLD_HEIGHT-1, col0.z)
    if (x === first[0] && z === first[1] && y === top_y) poll += 1 // a fresh full-footprint scan began
    const resident = new Set(reveal_order.slice(0, Math.min(reveal_order.length, poll * batch)))
    const ci = index_of.get(key(x, z))
    if (ci === undefined || !resident.has(ci)) return 0 // off-footprint or not-yet-streamed ⇒ air
    return y === height_of(ci) ? 1 : 0 // grass (GROUND) exactly at this column's surface, air above/below
  }
}

/** The seat Y the FULLY-streamed footprint must always resolve to (p90 over all 25 columns, + 1). */
const FULL_SEAT_Y = /** @type {number} */ (world_seat_from_surfaces(footprint_cols().map((_, i) => height_of(i))))

const drive = (/** @type {(x:number,y:number,z:number)=>number} */ sample) =>
  resolve_world_board_origin({
    sample,
    anchor: ANCHOR,
    player_y: () => -999, // a sentinel: if the fallback ever fires we SEE it (never expected while streamed)
    half_x: HALF,
    half_z: HALF,
    step: STEP,
    // fast, deterministic test cadence — poll tight, quiesce after 2 stable polls, generous ceiling so a
    // fully-revealing footprint always settles (the determinism we assert lives in the SETTLED value).
    settle_ms: 5000,
    poll_ms: 1,
    stable_polls: 2,
  })

describe('world_seat_from_surfaces — the seat statistic is order-independent (a SET, not a sequence)', () => {
  it('the same surfaces in any order give the same seat; a PARTIAL subset gives a DIFFERENT one (the bug)', () => {
    const full = footprint_cols().map((_, i) => height_of(i))
    const shuffled = [...full].reverse()
    expect(world_seat_from_surfaces(shuffled)).toBe(world_seat_from_surfaces(full)) // order cannot move the seat
    expect(FULL_SEAT_Y).toBe(PLATEAU_Y + 1) // p90 rides the plateau, not the pit
    // WHY partial seating was non-deterministic: two different early subsets p90 to different Ys.
    const only_pit = full.filter((h) => h === PIT_Y)
    const only_plateau = full.filter((h) => h === PLATEAU_Y)
    expect(world_seat_from_surfaces(only_pit)).not.toBe(world_seat_from_surfaces(only_plateau))
  })
})

describe('resolve_world_board_origin — DETERMINISTIC seat (waits for the stream to quiesce)', () => {
  it('X/Z come straight from the chain anchor (origin = anchor − half) — the footprint never moves', async () => {
    const o = await drive(make_streaming_sample([...footprint_cols().keys()], 99)) // all resident at once
    expect(o.x).toBe(ANCHOR.x - HALF)
    expect(o.z).toBe(ANCHOR.z - HALF)
    expect(o.y).toBe(FULL_SEAT_Y)
  })

  it('does NOT seat from a partial sample: pit-columns stream FIRST, yet the seat is the FULL plateau p90', async () => {
    // reveal the 5 LOW pit columns first (indices 0..4), then the plateau — an early-out resolver would seat at
    // the pit (41); the deterministic resolver waits for the plateau and seats at 65.
    const pit_first = [...footprint_cols().keys()]
    const seat = (await drive(make_streaming_sample(pit_first, 3))).y
    expect(seat).toBe(FULL_SEAT_Y) // 65, NOT PIT_Y+1 (41)
    expect(seat).not.toBe(PIT_Y + 1)
  })

  it('is stream-ORDER independent: pit-first and plateau-first boots seat at the SAME Y (the refresh fix)', async () => {
    const idx = [...footprint_cols().keys()]
    const pit_first = idx // 0..4 (pit) first
    const plateau_first = [...idx].reverse() // 24..20 (plateau) first
    const a = (await drive(make_streaming_sample(pit_first, 3))).y
    const b = (await drive(make_streaming_sample(plateau_first, 3))).y
    expect(a).toBe(b) // same fight, same terrain ⇒ same seat, regardless of which chunks streamed first
    expect(a).toBe(FULL_SEAT_Y)
  })

  it('a wholly-unstreamed footprint falls back to the player Y (last resort), never crashes', async () => {
    const air = () => 0 // nothing ever resolves
    const o = await resolve_world_board_origin({
      sample: air,
      anchor: ANCHOR,
      player_y: () => 123,
      half_x: HALF,
      half_z: HALF,
      step: STEP,
      settle_ms: 30, // short — nothing will ever stream, so just clear the deadline fast
      poll_ms: 1,
      stable_polls: 2,
    })
    expect(o.y).toBe(123)
  })
})

describe('resolve_world_board_origin — COORDS SANITY REFUSE (the board-teleport washing-machine guard)', () => {
  const air = () => 0 // nothing streams ⇒ seat === null (the player-Y last-resort branch)
  const drive_far = (/** @type {any} */ over) =>
    resolve_world_board_origin({
      sample: air,
      player_y: () => 131,
      half_x: HALF,
      half_z: HALF,
      step: STEP,
      settle_ms: 30,
      poll_ms: 1,
      stable_polls: 2,
      ...over,
    })

  it('REFUSES (throws WORLD_BOARD_UNPLACEABLE) a FAR anchor whose footprint streamed 0 columns', async () => {
    // the exact regression: a RAW chain anchor ~250k blocks from a player near origin, over ungenerated terrain.
    let err = /** @type {any} */ (null)
    try {
      await drive_far({ anchor: { x: 250226, z: 250377 }, player_xz: () => ({ x: 226, z: 377 }) })
    } catch (e) {
      err = e
    }
    expect(err).not.toBeNull()
    expect(err.code).toBe(WORLD_BOARD_UNPLACEABLE) // the adapter matches on this → one honest toast, no void seat
  })

  it('REFUSES a MID-RANGE void too (0 columns, < 500 blocks) — the void the old distance gate MISSED (FINDING A)', async () => {
    // anchor (300,118) vs player (36,5) ≈ 287 blocks: UNDER the old SANITY_DIST_BLOCKS=500 gate, so the pre-fix
    // code SEATED it at player-Y (the washing-machine void seat + no_my_seat reconcile spin). The trigger is now
    // the ZERO-column footprint itself, so any distance refuses → the adapter's unplaceable latch stops the churn.
    let err = /** @type {any} */ (null)
    try {
      await drive_far({ anchor: { x: 300, z: 118 }, player_xz: () => ({ x: 36, z: 5 }) })
    } catch (e) {
      err = e
    }
    expect(err).not.toBeNull()
    expect(err.code).toBe(WORLD_BOARD_UNPLACEABLE)
  })

  it('with no player_xz the guard is disabled (headless/unit use) — a 0-column footprint still seats at player Y', async () => {
    const o = await drive_far({ anchor: { x: 250226, z: 250377 } }) // no player_xz
    expect(o.y).toBe(131)
  })
})

// ── ROOT FIX (P0 — a fight was once lost to a 210-block void seat): the board seats where the PLAYER engaged,
//    not at a stale chain anchor far in the void. A near anchor (within engage range) still wins (deterministic);
//    a far one re-centers on the player. STATIC fully-resident samplers (spatial logic, not streaming). ──
const H = 64 // ground height wherever the sampler streams (well below WORLD_HEIGHT — headroom for ground_surface_y)
/** A STATIC ground oracle: solid grass (id 1 ∈ GROUND_IDS) at y=H for columns where `streams(x,z)`, air elsewhere.
 *  ground_surface_y then resolves H there (feet at H+1) and null off it — no streaming simulation needed. */
const ground_where = (/** @type {(x:number,z:number)=>boolean} */ streams) =>
  (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => (streams(x, z) && y === H ? 1 : 0)
const clamp_opts = { half_x: HALF, half_z: HALF, step: STEP, player_y: () => -999, settle_ms: 60, poll_ms: 1, stable_polls: 2 }

describe('resolve_world_board_origin — ROOT CLAMP the seat to the engaging player', () => {
  it('a NEAR anchor (within engage range) seats at the ANCHOR — deterministic X/Z, never re-centered', async () => {
    // player at origin, anchor 10 blocks away (< MAX_ANCHOR_DRIFT); ground everywhere ⇒ the anchor streams.
    const o = await resolve_world_board_origin({
      ...clamp_opts,
      sample: ground_where(() => true),
      anchor: { x: 10, z: 0 },
      player_xz: () => ({ x: 0, z: 0 }),
    })
    expect(o.x).toBe(10 - HALF) // origin = ANCHOR − half: the chain anchor won (byte-identical determinism holds)
    expect(o.z).toBe(0 - HALF)
    expect(o.y).toBe(H + 1)
  })

  it('a FAR anchor (210 blocks — the exact bug) RE-CENTERS on the player, never seats into the void', async () => {
    // the reported fight verbatim: anchor (6, 210), player near (6, 0). Ground streams ONLY around the player; the
    // far anchor is ungenerated void. Pre-fix: 0 columns → REFUSED → stranded. Now: the board seats under the player.
    const near_player = (/** @type {number} */ x, /** @type {number} */ z) => Math.abs(x - 6) <= 40 && Math.abs(z) <= 40
    const o = await resolve_world_board_origin({
      ...clamp_opts,
      sample: ground_where(near_player),
      anchor: { x: 6, z: 210 },
      player_xz: () => ({ x: 6, z: 0 }),
    })
    expect(o.x).toBe(6 - HALF) // seated at the PLAYER's cell (6, 0) — NOT the anchor (6, 210)
    expect(o.z).toBe(0 - HALF)
    expect(o.y).toBe(H + 1) // real ground under the player, NOT the player_y(-999) last-resort
  })
})

// ── P0 REPRO (2026-07-12 — "owner stuck in a live fight that can never mount"): procedural trees became the
//    world DEFAULT (GEN_VERSION 8), so a world-fight footprint now lands on FORESTED ground. The seat reused the
//    SPAWN picker `ground_surface_y`, which by design REJECTS any column under a tree canopy (a player must never
//    spawn IN a tree) → every footprint column read null → 0/156 seatable → REFUSED on solid, resident, RENDERED
//    ground → the fight stranded forever. The fix: `seat_surface_y` reads the ground UNDER the canopy (a board
//    seats on the ground; the render clear carves the trees above). These reproduce the exact "0/156" trace and
//    prove the fix over a real 17×19 footprint (156 columns), across every tree species.
describe('resolve_world_board_origin — P0 forest seat: a canopy footprint SEATS on the ground beneath it', () => {
  const CELL_M = 1.33 // the LIVE embed_voxel.js world-board footprint: a 17×19 board, cell 1.33 m, sampled every 2 cells
  const W_HALF_X = (17 * CELL_M) / 2
  const W_HALF_Z = (19 * CELL_M) / 2
  const W_STEP = CELL_M * 2
  const G = 64 // resident grass height under the canopy
  // the reported verbatim anchor (12, -326).
  const COLS = world_footprint_columns(12, -326, W_HALF_X, W_HALF_Z, W_STEP)
  /** A resident FOREST oracle: grass (id 3 ∈ GROUND_IDS) at y=G with a `leaf` canopy 4-7 blocks above it — the
   *  terrain the player stands ON and the renderer DRAWS, which the spawn scan reads as "forest" (first solid
   *  from the sky = a leaf) and rejects. Air everywhere else. */
  const forest =
    (/** @type {number} */ leaf) =>
    (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) =>
      y === G ? 3 : y >= G + 4 && y <= G + 7 ? leaf : 0

  it('reproduces the 0/156 trace — the SPAWN scan (ground_surface_y) rejects EVERY resident forested column', () => {
    expect(COLS.length).toBe(156) // matches the reported "0/156 columns" verbatim
    const seatable = COLS.filter(([x, z]) => ground_surface_y(forest(7), x, z) !== null)
    expect(seatable.length).toBe(0) // the LIAR: 0/156 seatable, though grass id 3 is resident in all 156 columns
  })

  it('the FIX — seat_surface_y reads the ground UNDER the canopy: all 156 columns resolve, EVERY tree species', () => {
    // broadleaf(7) · conifer(28) · dry(29) · palm(33) · procedural species leaves(95,101) · twig card(103).
    for (const leaf of [7, 28, 29, 33, 95, 101, 103]) {
      const resolved = COLS.filter(([x, z]) => seat_surface_y(forest(leaf), x, z) === G)
      expect(resolved.length).toBe(156) // every canopy species resolves to the same resident ground plane
    }
  })

  it('end-to-end — resolve_world_board_origin SEATS a forest world-fight (board mounts), never throws UNPLACEABLE', async () => {
    const o = await resolve_world_board_origin({
      sample: forest(7),
      anchor: { x: 12, z: -326 },
      player_y: () => -999, // a fallback would surface as -999 — proves the seat found real ground under the canopy
      player_xz: () => ({ x: 12, z: -326 }),
      half_x: W_HALF_X,
      half_z: W_HALF_Z,
      step: W_STEP,
      settle_ms: 200,
      poll_ms: 1,
      stable_polls: 2,
    })
    expect(o.y).toBe(G + 1) // seated on the grass face under the canopy — NOT refused, NOT the -999 fallback
  })

  it('never seats on TREETOP SNOW — snow (8) capping a canopy is skipped for the ground plane below it', () => {
    // grass at G, canopy leaves G+4..G+6, a snow cap at G+7: the seat must read G, never the treetop snow.
    const snowcap = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) =>
      y === G ? 3 : y >= G + 4 && y <= G + 6 ? 7 : y === G + 7 ? 8 : 0
    expect(seat_surface_y(snowcap, 12, -326)).toBe(G)
  })

  it('a GENUINE void (all air) still REFUSES — the fix does not over-correct the void guard', async () => {
    let err = /** @type {any} */ (null)
    try {
      await resolve_world_board_origin({
        sample: () => 0,
        anchor: { x: 12, z: -326 },
        player_y: () => 5,
        player_xz: () => ({ x: 12, z: -326 }),
        half_x: W_HALF_X,
        half_z: W_HALF_Z,
        step: W_STEP,
        settle_ms: 30,
        poll_ms: 1,
        stable_polls: 2,
      })
    } catch (e) {
      err = e
    }
    expect(err?.code).toBe(WORLD_BOARD_UNPLACEABLE) // genuinely unstreamed ⇒ the honest refusal still fires
  })
})

describe('resolve_world_board_origin — OUTWARD WALK to the nearest streamable ground (instead of refusing)', () => {
  it('a void centre walks OUTWARD to the nearest streamable footprint and seats there', async () => {
    // no player_xz (clamp OFF) so the centre stays at the anchor (0,0); ground exists ONLY at x ≥ 8 — OUTSIDE the
    // (0,0) footprint (HALF=4). The walk must step out to reach it and seat on real ground, never refuse/fallback.
    const o = await resolve_world_board_origin({
      sample: ground_where((x) => x >= 8),
      anchor: { x: 0, z: 0 },
      player_y: () => -999, // a fallback would surface as -999 — proves the walk found real ground
      half_x: HALF,
      half_z: HALF,
      step: STEP,
      settle_ms: 60,
      poll_ms: 1,
      stable_polls: 2,
    })
    expect(o.y).toBe(H + 1) // walked onto real ground (not the -999 fallback, not a thrown refuse)
    expect(o.x).toBeGreaterThan(0 - HALF) // the seat centre moved OUTWARD from the anchor toward the streamable band
  })
})
