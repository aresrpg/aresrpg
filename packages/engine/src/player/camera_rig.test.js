// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shoulder-camera pitch/anchor unit tests (ENG-8, 2026-07-03 regression fix). Pure math —
// create_shoulder_camera touches no DOM at construction and update() is a pure pose function, so it runs
// headless. Locks the fix for the reported bug "camera can look up and be near the ground, instead of being
// able to look more down": the polar anchor was on the wrong pole (dir_y = −cos), which sat the eye BELOW
// the head for small polar. These assert the CORRECTED sense: default looks down from ABOVE the head,
// drag-down looks further down, drag-up eases toward the horizon but NEVER crosses above it (never under
// the floor), matching the shipped dapp's camera-controls clamp [12°,88°].

import { describe, it, expect } from 'bun:test'

import { create_shoulder_camera, CAMERA_RIG_CONSTANTS } from './camera_rig.js'

const { MIN_DIST, MAX_DIST, CINE_MAX_LOOK_RATE, CINE_MAX_DIST, CINE_MIN_DIST } = CAMERA_RIG_CONSTANTS

const FEET = /** @type {[number,number,number]} */ ([0, 0, 0])
const EYE_H = 1.5
const NO_WALL = () => false // open air: the arm never collides, so polar is the only variable

/** Advance the rig a few fixed frames (spring settles to the constant pivot) and return the last pose.
 *  @param {import('./camera_rig.js').ShoulderCamera} cam */
function settle(cam) {
  let pose
  for (let i = 0; i < 4; i += 1) {
    pose = cam.update({ feet: FEET, eye_height: EYE_H, speed: 0, solid_at: NO_WALL, dt: 1 / 60 })
  }
  return /** @type {import('./camera_rig.js').CameraPose} */ (pose)
}

describe('shoulder camera pitch/anchor (reported regression)', () => {
  it('default frame: eye sits ABOVE the head and the camera looks DOWN', () => {
    const cam = create_shoulder_camera({ yaw: 0 })
    const pose = settle(cam)
    // eye clearly above the feet (NOT "near the ground") and above the head pivot
    expect(pose.position[1]).toBeGreaterThan(FEET[1] + EYE_H)
    // looking down (negative pitch) — the whole point of the fix
    expect(pose.pitch).toBeLessThan(0)
  })

  it('drag DOWN (movementY>0) tilts MORE top-down: eye rises, pitch steepens', () => {
    const cam = create_shoulder_camera({ yaw: 0 })
    const base = settle(cam)
    cam.rotate(0, 600) // movementY>0 → polar decreases → toward straight-overhead
    const down = settle(cam)
    expect(down.pitch).toBeLessThan(base.pitch) // steeper look-down (more negative)
    expect(down.position[1]).toBeGreaterThan(base.position[1]) // eye climbed higher
  })

  it('drag UP looks WELL ABOVE the character but clamps at MAX_POLAR (D223 owner reversal)', () => {
    // [D223] Increases the upward look range beyond the old ceiling — REVERSES the old never-look-up pin:
    // the eye may swing below the head-plane to look steeply up (~+45° at the 135° polar clamp);
    // the ground sphere-cast keeps the arm honest near the floor.
    const cam = create_shoulder_camera({ yaw: 0 })
    cam.rotate(0, 600) // first go top-down…
    const down = settle(cam)
    cam.rotate(0, -4000) // …then drag hard UP, clamps at MAX_POLAR (135°)
    const up = settle(cam)
    expect(up.pitch).toBeGreaterThan(down.pitch) // eased up
    expect(up.pitch).toBeGreaterThan(0.5) // genuinely looking UP now (was capped ≤ ~0)
    expect(up.pitch).toBeLessThanOrEqual(Math.PI / 4 + 0.05) // but never past the 135° polar clamp
  })
})

// ── TR-1 cinematic (trailer-recording) mode ────────────────────────────────────────────────────────
// The toggle must (1) visibly DAMPEN + slow the look, (2) trail the follow more slowly, and — the
// load-bearing property — (3) restore the EXACT normal params on toggle-off (no residual sluggishness
// leaks into a shipped recording). yaw === wrap(az_view) EXACTLY (pivot/spring position cancels out of
// the eye→pivot direction), so a fixed rotate impulse from a settled pose is a clean, azimuth-independent
// fingerprint of look sensitivity × smoothing; a feet-step impulse fingerprints the follow halflife.
const FRAME = () => ({
  feet: /** @type {[number,number,number]} */ ([0, 64, 0]),
  eye_height: 1.6,
  speed: 0,
  solid_at: () => false,
  dt: 1 / 60,
})

/** Fully converge the follow spring at the constant pivot. @param {import('./camera_rig.js').ShoulderCamera} cam */
function converge(cam) {
  for (let i = 0; i < 600; i += 1) cam.update(FRAME())
}

/** The yaw response (radians) to a fixed +50px azimuth impulse from a settled pose — a fingerprint of
 *  look sensitivity × one-frame smoothing, independent of the absolute azimuth.
 *  @param {import('./camera_rig.js').ShoulderCamera} cam */
function look_response(cam) {
  converge(cam)
  const before = cam.update(FRAME()).yaw
  cam.rotate(50, 0)
  const after = cam.update(FRAME()).yaw
  return after - before
}

/** How far the eye's x moves in ONE frame when the feet jump +10 — a fingerprint of the follow halflife
 *  (smaller halflife → faster catch → larger step). @param {import('./camera_rig.js').ShoulderCamera} cam */
function follow_step(cam) {
  converge(cam)
  const [p0] = cam.update(FRAME()).position
  const [p1] = cam.update({ feet: [10, 64, 0], eye_height: 1.6, speed: 0, solid_at: () => false, dt: 1 / 60 }).position
  return p1 - p0
}

describe('TR-1 cinematic camera (trailer mode)', () => {
  it('cinematic dampens + slows the look (smaller per-frame yaw response than even the ×0.5 sensitivity)', () => {
    const normal = look_response(create_shoulder_camera({ yaw: 0 }))
    const cine = create_shoulder_camera({ yaw: 0 })
    cine.set_cinematic(true)
    const damped = look_response(cine)
    // reduced sensitivity (×0.5) AND per-frame exp smoothing ⇒ well under half the normal response
    expect(Math.abs(damped)).toBeLessThan(Math.abs(normal) * 0.5)
    expect(Math.abs(damped)).toBeGreaterThan(0) // still responsive, just gentle
    expect(cine.is_cinematic()).toBe(true)
  })

  it('cinematic follow trails MORE slowly than the normal spring', () => {
    const normal = follow_step(create_shoulder_camera({ yaw: 0 }))
    const cine = create_shoulder_camera({ yaw: 0 })
    cine.set_cinematic(true)
    const trailing = follow_step(cine)
    expect(trailing).toBeLessThan(normal) // slower trailing dolly
    expect(trailing).toBeGreaterThan(0)
  })

  it('toggle OFF restores the EXACT normal look response after real cinematic use (numeric)', () => {
    const cam = create_shoulder_camera({ yaw: 0 })
    const baseline = look_response(cam)
    cam.set_cinematic(true)
    for (let i = 0; i < 120; i += 1) {
      cam.rotate(7, 3)
      cam.update(FRAME())
    } // abuse it
    cam.set_cinematic(false)
    expect(cam.is_cinematic()).toBe(false)
    const restored = look_response(cam)
    expect(restored).toBeCloseTo(baseline, 12) // byte-identical look feel, no residual smoothing
  })

  it('toggle OFF restores the EXACT normal follow halflife after real cinematic use (numeric)', () => {
    const cam = create_shoulder_camera({ yaw: 0 })
    const baseline = follow_step(cam)
    cam.set_cinematic(true)
    for (let i = 0; i < 90; i += 1)
      cam.update({ feet: [Math.sin(i) * 3, 64, 0], eye_height: 1.6, speed: 5, solid_at: () => false, dt: 1 / 60 })
    cam.set_cinematic(false)
    const restored = follow_step(cam)
    expect(restored).toBeCloseTo(baseline, 10) // the spring halflife is exactly the normal 0.15 again
  })

  // ── TR-1 v2: constant-pace look, deeper zoom-out, first-person zoom-in, byte-exact restore ──────────
  it('CONSTANT-PACE PAN: a whipped mouse never exceeds the fixed angular-velocity ceiling', () => {
    const dt = 1 / 60
    const cam = create_shoulder_camera({ yaw: 0 })
    cam.set_cinematic(true)
    converge(cam) // az_view settled at azimuth
    const y0 = cam.get_yaw()
    cam.rotate(1e6, 0) // whip the mouse absurdly fast → azimuth jumps a huge amount
    cam.update(FRAME())
    const step = Math.abs(cam.get_yaw() - y0) // the RENDERED per-frame pan step
    expect(step).toBeLessThanOrEqual(CINE_MAX_LOOK_RATE * dt + 1e-9) // capped, no matter the input size
    expect(step).toBeGreaterThan(CINE_MAX_LOOK_RATE * dt * 0.9) // and it DOES advance at that constant pace
  })

  it('deeper zoom-OUT: cinematic pulls past the normal MAX_DIST, up to the cinematic ceiling', () => {
    const cam = create_shoulder_camera({ yaw: 0 })
    cam.set_cinematic(true)
    cam.dolly(1000) // way out → clamps to CINE_MAX_DIST
    let pose = FRAME()
    for (let i = 0; i < 600; i += 1) pose = cam.update(FRAME()) // open air, let zoom_dist ease out
    expect(pose.distance).toBeGreaterThan(MAX_DIST) // beyond the normal 8 m
    expect(pose.distance).toBeLessThanOrEqual(CINE_MAX_DIST + 1e-6) // but never past the 16 m ceiling
  })

  it('FIRST-PERSON zoom-IN: cinematic pulls the eye below the normal MIN_DIST (avatar auto-hides)', () => {
    const cam = create_shoulder_camera({ yaw: 0 })
    cam.set_cinematic(true)
    cam.dolly(-1000) // full zoom-in → clamps to CINE_MIN_DIST
    let pose = FRAME()
    for (let i = 0; i < 600; i += 1) pose = cam.update(FRAME())
    expect(pose.distance).toBeLessThan(MIN_DIST) // below 1.2 m → embed hides the avatar → first person
  })

  it('toggle OFF re-clamps a cinematic-only zoom (16 m ceiling) back into the normal range', () => {
    const cam = create_shoulder_camera({ yaw: 0 })
    cam.set_cinematic(true)
    cam.dolly(1000) // out to 16
    for (let i = 0; i < 600; i += 1) cam.update(FRAME())
    cam.set_cinematic(false) // must snap target + eased distance back into [MIN,MAX]
    let pose = FRAME()
    for (let i = 0; i < 600; i += 1) pose = cam.update(FRAME())
    expect(pose.distance).toBeLessThanOrEqual(MAX_DIST + 1e-6) // normal mode can never sit past 8 m
  })
})

// ── S-75 first-person zoom (target: "fully zooming in should enter first person view") ───────────────
// The mode latch rides the USER'S TARGET distance with hysteresis (ENTER 1.2 / EXIT 1.4); the eye
// BLENDS onto the raw head anchor over FP_BLEND_S; look math is position-independent so mouse look is
// identical in both modes; the reported pose.distance collapses with the blend, so the app's existing
// `distance > 1.0` own-mesh hide is the visibility seam (asserted below through the distance contract).
const { FP_EXIT_DIST } = CAMERA_RIG_CONSTANTS

describe('S-75 first-person zoom', () => {
  it('fully zooming in latches FP: eye lands EXACTLY on the head anchor, distance collapses to 0', () => {
    const cam = create_shoulder_camera({ yaw: 0 })
    converge(cam)
    cam.dolly(-1000) // wheel fully in → clamps to the FP_MIN_DIST floor (1.0) < FP_ENTER_DIST (1.2)
    let pose = cam.update(FRAME())
    expect(pose.first_person).toBe(true) // the latch flips the moment the target crosses
    for (let i = 0; i < 120; i += 1) pose = cam.update(FRAME()) // blend (0.2 s) + zoom ease settle
    expect(pose.distance).toBeLessThan(1e-9) // → the app's `distance > 1.0` gate HIDES the own mesh
    expect(pose.position[0]).toBeCloseTo(0, 6) // head anchor (FRAME feet [0,64,0], eye 1.6): CENTERED —
    expect(pose.position[1]).toBeCloseTo(65.6, 6) // no shoulder bias, no spring lag, bob 0 at speed 0
    expect(pose.position[2]).toBeCloseTo(0, 6)
  })

  it('hysteresis: targets inside the [ENTER, EXIT] band never flip the mode — zero oscillation', () => {
    const cam = create_shoulder_camera({ yaw: 0 })
    converge(cam)
    cam.dolly(-1000) // → FP at the 1.0 floor
    expect(cam.update(FRAME()).first_person).toBe(true)
    cam.dolly(0.3) // → 1.3, dead-centre of the band — FP must HOLD (below EXIT)
    expect(cam.update(FRAME()).first_person).toBe(true)
    let flips = 0
    let last = true
    for (let i = 0; i < 100; i += 1) {
      cam.dolly(i % 2 === 0 ? -0.04 : 0.04) // jitter the target within [1.26, 1.30] ⊂ (ENTER, EXIT)
      const fp = cam.update(FRAME()).first_person
      if (fp !== last) flips += 1
      last = fp
    }
    expect(flips).toBe(0)
    cam.dolly(0.2) // ≈1.5 > EXIT → third person
    expect(cam.update(FRAME()).first_person).toBe(false)
    cam.dolly(-0.25) // ≈1.25 — back inside the band from ABOVE: TP must HOLD (above ENTER)
    expect(cam.update(FRAME()).first_person).toBe(false)
  })

  it('ONE wheel notch out exits FP and restores a real shoulder distance (avatar-visible again)', () => {
    const cam = create_shoulder_camera({ yaw: 0 })
    converge(cam)
    cam.dolly(-1000)
    for (let i = 0; i < 60; i += 1) cam.update(FRAME()) // settled in FP
    cam.dolly(0.5) // one wheel notch: 1.0 + 0.5 = 1.5 > FP_EXIT_DIST — the floor guarantees this
    let pose = cam.update(FRAME())
    expect(pose.first_person).toBe(false)
    expect(1.5).toBeGreaterThan(FP_EXIT_DIST) // the single-notch-exit invariant, kept honest
    for (let i = 0; i < 240; i += 1) pose = cam.update(FRAME())
    expect(pose.distance).toBeGreaterThan(1.0) // → the app's gate SHOWS the own mesh again
    expect(pose.distance).toBeCloseTo(1.5, 1)
  })

  it('the blend is a pure eye translation: yaw + pitch are IDENTICAL across the whole transition', () => {
    const cam = create_shoulder_camera({ yaw: 0.7 })
    cam.rotate(120, -80) // an arbitrary look direction
    converge(cam)
    const before = cam.update(FRAME())
    cam.dolly(-1000) // enter FP — the eye travels shoulder→head over the next ~12 frames
    for (let i = 0; i < 90; i += 1) {
      const p = cam.update(FRAME())
      expect(Math.abs(p.yaw - before.yaw)).toBeLessThan(1e-9) // no look pop, on ANY frame of the blend
      expect(Math.abs(p.pitch - before.pitch)).toBeLessThan(1e-9)
    }
  })

  it('window.__ARES_FP = false keeps a full zoom-in in third person (dev kill-switch)', () => {
    const g = /** @type {any} */ (globalThis)
    g.window = { __ARES_FP: false }
    try {
      const cam = create_shoulder_camera({ yaw: 0 })
      converge(cam)
      cam.dolly(-1000)
      let pose = cam.update(FRAME())
      for (let i = 0; i < 120; i += 1) pose = cam.update(FRAME())
      expect(pose.first_person).toBe(false)
      expect(pose.distance).toBeGreaterThan(0.5) // eye stays a real arm out (the 1.0 floor), never at the head
    } finally {
      delete g.window
    }
  })
})

// ── S-76b camera↔wall margin (target: "we see through blocks when the camera is too close") ──────────
// The near-plane x-ray fix: the arm march + the FP anchor keep every solid face ≥ CAM_WALL_MARGIN off
// the eye (L∞ cube ⇒ Euclidean ⇒ covers the frustum corners: 0.223 m at near 0.1 / fov 75° / aspect 2.4).
const { CAM_WALL_MARGIN } = CAMERA_RIG_CONSTANTS

/** Euclidean distance from a point to the block AABB [bx,bx+1]×[by,by+1]×[bz,bz+1]. */
function dist_to_block(px, py, pz, bx, by, bz) {
  const dx = Math.max(bx - px, 0, px - (bx + 1))
  const dy = Math.max(by - py, 0, py - (by + 1))
  const dz = Math.max(bz - pz, 0, pz - (bz + 1))
  return Math.hypot(dx, dy, dz)
}

describe('S-76b camera wall margin (near-plane x-ray)', () => {
  it('3P squeeze: the arm stops with the eye ≥ margin off a wall plane (never inside it)', () => {
    const wall = (/** @type {number} */ x) => x >= 5 // solid half-space x ≥ 5
    const cam = create_shoulder_camera({ yaw: Math.PI / 2 }) // camera pushed toward +x (into the wall)
    let pose
    for (let i = 0; i < 300; i += 1)
      pose = cam.update({ feet: [2.0, 64, 0], eye_height: 1.6, speed: 0, solid_at: wall, dt: 1 / 60 })
    const p = /** @type {import('./camera_rig.js').CameraPose} */ (pose)
    expect(5 - p.position[0]).toBeGreaterThanOrEqual(CAM_WALL_MARGIN - 1e-6) // face ≥ margin away
    expect(p.position[0]).toBeGreaterThan(2.0) // and the arm genuinely extended (not a degenerate 0)
  })

  it('3P corner sweep: a lone block never gets a face inside the margin, ANY approach azimuth', () => {
    // the old 7-sample sphere probe leaked exactly here — diagonal approaches to a block corner.
    const block = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) =>
      x === 5 && y === 65 && z === 0
    for (let k = 0; k < 24; k += 1) {
      const az = (k / 24) * Math.PI * 2
      const cam = create_shoulder_camera({ yaw: az })
      let pose
      for (let i = 0; i < 240; i += 1)
        pose = cam.update({ feet: [4.2, 64, 1.8], eye_height: 1.6, speed: 0, solid_at: block, dt: 1 / 60 })
      const [ex, ey, ez] = /** @type {import('./camera_rig.js').CameraPose} */ (pose).position
      expect(dist_to_block(ex, ey, ez, 5, 65, 0)).toBeGreaterThanOrEqual(CAM_WALL_MARGIN - 1e-6)
    }
  })

  it('FP nose-to-wall: the eye clamps BACK along the view axis to keep the margin', () => {
    const wall = (/** @type {number} */ x) => x >= 5
    const cam = create_shoulder_camera({ yaw: -Math.PI / 2 }) // camera BEHIND the head, looking at +x (the wall)
    cam.dolly(-1000) // first person
    let pose
    for (let i = 0; i < 300; i += 1)
      pose = cam.update({ feet: [4.75, 64, 0], eye_height: 1.6, speed: 0, solid_at: wall, dt: 1 / 60 })
    const p = /** @type {import('./camera_rig.js').CameraPose} */ (pose)
    expect(p.first_person).toBe(true)
    // raw head sits at x 4.75 (0.25 from the face — INSIDE the margin); the clamp must pull it back
    expect(5 - p.position[0]).toBeGreaterThanOrEqual(CAM_WALL_MARGIN - 1e-6)
    expect(p.position[0]).toBeGreaterThan(4.0) // …by centimetres along the view axis, not a teleport
  })
})

// ── ENG camera-feel (2026-07-12) — smoother camera follow while running ──────────────────────────────
// The follow spring's halflife eases UP from FOLLOW_HALFLIFE toward RUN_FOLLOW_HALFLIFE as speed crosses
// walk→run pace. follow_step's fingerprint (the one-frame position response to a feet-jump, from a fully
// settled pose) isolates exactly this: a SMALLER step = a slower catch-up = a smoother trail.

/** Like follow_step, but converges AND measures at a fixed `speed` (baking the halflife scaling into
 *  both the settled pivot and the fingerprint step). @param {import('./camera_rig.js').ShoulderCamera} cam
 *  @param {number} speed */
function follow_step_at(cam, speed) {
  const frame = (/** @type {[number,number,number]} */ feet) => ({
    feet,
    eye_height: 1.6,
    speed,
    solid_at: () => false,
    dt: 1 / 60,
  })
  for (let i = 0; i < 600; i += 1) cam.update(frame([0, 64, 0]))
  const [p0] = cam.update(frame([0, 64, 0])).position
  const [p1] = cam.update(frame([10, 64, 0])).position
  return p1 - p0
}

describe('ENG camera-feel: run-speed-scaled follow smoothing', () => {
  it('idle speed (0) is BYTE-IDENTICAL to the pre-existing follow_step fixture (speed_ratio floors at 0)', () => {
    const idle = follow_step_at(create_shoulder_camera({ yaw: 0 }), 0)
    const baseline = follow_step(create_shoulder_camera({ yaw: 0 })) // the existing fixture (speed:0 throughout)
    expect(idle).toBeCloseTo(baseline, 12)
  })

  it('walk pace (≤ BOB_WALK_SPEED) also stays crisp — no scaling below the walk anchor', () => {
    const idle = follow_step_at(create_shoulder_camera({ yaw: 0 }), 0)
    const walking = follow_step_at(create_shoulder_camera({ yaw: 0 }), 4.8) // BOB_WALK_SPEED
    expect(walking).toBeCloseTo(idle, 12)
  })

  it('running (≥ BOB_RUN_SPEED) eases the follow SLOWER (smoother) — a smaller one-frame step than idle', () => {
    const idle = follow_step_at(create_shoulder_camera({ yaw: 0 }), 0)
    const running = follow_step_at(create_shoulder_camera({ yaw: 0 }), 12) // above BOB_RUN_SPEED (10.5)
    expect(running).toBeLessThan(idle) // slower catch-up = smoother
    expect(running).toBeGreaterThan(0) // still tracking, never frozen
  })

  it('cinematic mode is UNCHANGED by the run-speed scaling (keeps its own owner-tuned CINE_FOLLOW_HALFLIFE)', () => {
    const cam = create_shoulder_camera({ yaw: 0 })
    cam.set_cinematic(true)
    const cine_idle = follow_step_at(cam, 0)
    const cine_running = follow_step_at(cam, 12)
    expect(cine_running).toBeCloseTo(cine_idle, 10) // cinematic's halflife never reacts to speed
  })
})
