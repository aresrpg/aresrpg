// GROUND PLACEMENT + PER-MEMBER WANDER — the shared grounding helper plus the pure, headless-testable roam
// core the chain mob groups drive. Split out of the deleted TR-3 ambient-mob feature ("we
// don't want ambient mobs, only the on-chain ones") — `feet_of` is genuine shared grounding infra (three live
// consumers: world_spawns.js chain mobs+resources, remote_players.js avatars, embed_voxel.js fight boards),
// and the WANDER state machine is resurrected here so each on-chain group's members can
// independently amble a few blocks around their spawn anchor. Kept PURE (no three/engine/DOM) so it unit-tests
// headless (ambient_placement.test.js) and world_spawns.js owns the only engine/rig wiring.

/**
 * FEET-Y CONVENTION (mobs buried 1 block — captured Δ=1 vs the controller at the same
 * column). `ground_surface_y` returns the GROUND BLOCK's y; a feet-origin rig STANDS on its TOP FACE at
 * y+1 — the exact y `find_open_spawn` returns for the local controller, presence broadcasts (D217), and
 * the S-17a canonical `ground_height` resolves (first air above solid). EVERY feet-origin mount (chain
 * mobs, remote fallback) converts through THIS helper — never place a body at the raw scan y.
 * @param {number | null} surf a `ground_surface_y` result @returns {number | null} the feet y
 */
export const feet_of = (surf) => (surf === null || surf === undefined ? null : surf + 1)

/** mulberry32 — tiny deterministic PRNG so each member's amble is identical across refreshes (seeded off the
 *  stable spawn_id + member index, so a reload never teleports the pack). */
export function make_rng(/** @type {number} */ seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── per-member wander ("each member optionally roam a bit around the spawn point every X
// seconds or stay still"). Kept in the pure core so it's unit-testable headless. Radii tuned to the
// "modest ~3-4 blocks" leash — a member never strays further than LEASH_R from its OWN spawn anchor. ────────
export const WANDER = {
  IDLE_MIN_S: 2, // idle hold before the next decision (randomised per member per decision)
  IDLE_MAX_S: 8,
  WALK_MIN_S: 1.5, // walk-toward-waypoint duration
  WALK_MAX_S: 4,
  WALK_CHANCE: 0.5, // odds a decision starts a walk vs keeps idling → ~half a group ambles at any moment
  WAYPOINT_R: 3.5, // a modest amble radius from the anchor ("a few blocks", "return-radius ~3-4 blocks")
  LEASH_R: 4, // a waypoint never targets further than this from the member's OWN spawn anchor — the leash
}

/**
 * Advance ONE member's DESYNCED wander by dt — pure (no three/engine/DOM). Mutates its idle↔walk state machine
 * + position via the member's OWN seeded rng, so within a group the members are out of phase (some amble, some
 * stand) and NONE drifts: every walk waypoint is anchored to the member's spawn point (ax,az), so
 * |pos − anchor| ≤ WAYPOINT_R ≤ LEASH_R at all times — that anchoring IS the spawn leash.
 *
 * MOTION MODEL: a CONSTANT-speed step toward the waypoint, clamped so it never overshoots — a fixed `speed`
 * (blocks/s) glides at a believable graze pace that matches a walk clip's leg cadence (never the old
 * exponential ease, which launched far waypoints at tens of m/s and read as a slide). Both endpoints of every
 * step lie in the WAYPOINT_R disk around the anchor, so the straight segment stays inside it → leash preserved.
 * @param {{ mrng: () => number, ax: number, az: number, mx: number, mz: number, tx: number, tz: number,
 *   decide_t: number, walking: boolean, moving: boolean }} m member wander state (mutated)
 * @param {number} dt seconds @param {number} speed blocks/sec amble pace @param {number} arrive_eps m within which the waypoint is "reached"
 * @returns {{ dx: number, dz: number }} vector toward the target (drives the facing yaw)
 */
export function advance_member_wander(m, dt, speed, arrive_eps) {
  m.decide_t -= dt
  if (m.decide_t <= 0) {
    if (m.mrng() < WANDER.WALK_CHANCE) {
      const a = m.mrng() * Math.PI * 2
      const rr = Math.min(WANDER.LEASH_R, WANDER.WAYPOINT_R * (0.4 + m.mrng() * 0.6))
      m.tx = m.ax + Math.cos(a) * rr // waypoint orbits the SPAWN anchor, never the current pos → no drift
      m.tz = m.az + Math.sin(a) * rr
      m.walking = true
      m.decide_t = WANDER.WALK_MIN_S + m.mrng() * (WANDER.WALK_MAX_S - WANDER.WALK_MIN_S)
    } else {
      m.tx = m.mx // idle: hold where it is
      m.tz = m.mz
      m.walking = false
      m.decide_t = WANDER.IDLE_MIN_S + m.mrng() * (WANDER.IDLE_MAX_S - WANDER.IDLE_MIN_S)
    }
  }
  const dx = m.tx - m.mx
  const dz = m.tz - m.mz
  const dist = Math.hypot(dx, dz)
  if (m.walking && dist > arrive_eps) {
    const step = Math.min(dist, speed * dt) // constant calm pace, clamp to remaining → glide, never overshoot/slide
    m.mx += (dx / dist) * step
    m.mz += (dz / dist) * step
    m.moving = true
  } else {
    m.moving = false // arrived or idling → idle pose
  }
  return { dx, dz }
}
