// The shared nameplate home, headless: (1) plate_occluded over a scripted voxel field — a solid slab between
// anchor and eye must occlude, a clear span must not, the endpoint skip must keep a ground block from
// self-occluding; (2) project_plate over a REAL three PerspectiveCamera — the behind-camera cull and the
// world-lock (the camera's baked-in head-bob cancelled EXACTLY by the plate_bob anchor offset).

import { describe, expect, it } from 'bun:test'
import { PerspectiveCamera } from 'three'

import { plate_occluded, project_plate } from './nameplate_occlusion.js'

/** @param {(x: number, y: number, z: number) => number} sample_block */
const eng = (sample_block) => ({ sample_block })
const cam = (x, y, z) => ({ position: { x, y, z } })

describe('plate_occluded', () => {
  it('clear line of sight → not occluded', () => {
    const engine = eng(() => 0) // all air
    expect(plate_occluded(engine, 0, 20, 0, cam(0, 25, 40))).toBe(false)
  })

  it('a wall between anchor and eye → occluded', () => {
    // anchor at x=0, eye at x=40 (same height); solid slab at x in [18,22]
    const engine = eng((x) => (x >= 18 && x <= 22 ? 1 : 0))
    expect(plate_occluded(engine, 0, 20, 0, cam(40, 20, 0))).toBe(true)
  })

  it('a solid block AT the anchor (standing on ground) does not self-occlude', () => {
    // only the anchor cell + its immediate neighbours are solid; the skip margin must clear them
    const engine = eng((x, y, z) => (Math.abs(x) < 1 && Math.abs(z) < 1 && y <= 20 ? 1 : 0))
    expect(plate_occluded(engine, 0, 20, 0, cam(0, 24, 40))).toBe(false)
  })

  it('a block hugging the eye does not count (skip-near at both ends)', () => {
    // solid only within 1m of the eye — inside the far skip margin, so it is ignored
    const ex = 40
    const engine = eng((x) => (x > ex - 1 ? 1 : 0))
    expect(plate_occluded(engine, 0, 20, 0, cam(ex, 20, 0))).toBe(false)
  })

  it('no camera / no oracle → treated as visible (fail-open)', () => {
    expect(
      plate_occluded(
        eng(() => 1),
        0,
        20,
        0,
        null
      )
    ).toBe(false)
    expect(plate_occluded({}, 0, 20, 0, cam(0, 25, 40))).toBe(false)
  })
})

// NB: the former damp_plate_y screen-Y smoother (+ its tests) was DELETED 2026-07-10 — the head-bob is now
// cancelled at the source inside project_plate (below), so plates are world-locked with zero smoothing.

// ── project_plate: a REAL PerspectiveCamera at (0, 10, 20) looking down −Z toward the origin. ──────────────
const RECT = { left: 0, top: 0, width: 1600, height: 900 }
/** @param {number} [bob] the synthetic head-bob baked into the camera Y (published as userData.plate_bob) */
const real_cam = (bob = 0) => {
  const c = new PerspectiveCamera(60, 16 / 9, 0.1, 1000)
  c.position.set(0, 10, 20)
  c.lookAt(0, 10, 0) // orient from the UN-bobbed eye (exactly the rig: yaw/pitch derive from the un-bobbed pose)
  c.position.y += bob // …then the bob translates the eye vertically (camera_rig.js update() sums it into Y)
  c.updateMatrixWorld(true)
  c.userData.plate_bob = bob
  return c
}

describe('project_plate', () => {
  it('projects a dead-ahead anchor to the canvas centre', () => {
    const px = project_plate(real_cam(), RECT, 0, 10, 0)
    expect(px).not.toBeNull()
    expect(px.left).toBeCloseTo(800, 3)
    expect(px.top).toBeCloseTo(450, 3)
  })

  it('CULLS an anchor behind the camera (never a phantom plate for a mob at your back)', () => {
    expect(project_plate(real_cam(), RECT, 0, 10, 40)).toBeNull() // eye z=20 looking toward −Z; z=40 is behind
    expect(project_plate(real_cam(), RECT, 0, 10, 20.5)).toBeNull() // barely behind the eye plane
  })

  it('hides an anchor far outside the frustum', () => {
    expect(project_plate(real_cam(), RECT, 500, 10, 0)).toBeNull()
  })

  it('reuses an explicit hot-loop output object', () => {
    const out = { left: 0, top: 0 }
    expect(project_plate(real_cam(), RECT, 0, 10, 0, out)).toBe(out)
    expect(out.left).toBeCloseTo(800, 3)
    expect(out.top).toBeCloseTo(450, 3)
  })

  it('WORLD-LOCK: the head-bob cancels exactly — a bobbed camera paints the same pixel as the un-bobbed one', () => {
    const base = project_plate(real_cam(0), RECT, 3, 12, -5)
    const bobbed = project_plate(real_cam(0.06), RECT, 3, 12, -5) // BOB_RUN amp — eye up 6 cm, plate_bob published
    expect(base).not.toBeNull()
    expect(bobbed.left).toBeCloseTo(base.left, 6)
    expect(bobbed.top).toBeCloseTo(base.top, 6) // zero screen drift — the plate is pinned to the world anchor
  })

  it('without the plate_bob offset the same bobbed camera WOULD drift the pixel (the cancellation is load-bearing)', () => {
    const base = project_plate(real_cam(0), RECT, 3, 12, -5)
    const naive = real_cam(0.06)
    naive.userData.plate_bob = 0 // simulate a path that forgot the offset
    const drifted = project_plate(naive, RECT, 3, 12, -5)
    expect(Math.abs(drifted.top - base.top)).toBeGreaterThan(0.5) // visible sub-pixel-to-pixel swim per stride
  })

  it('null camera → null (pre-boot safe)', () => {
    expect(project_plate(null, RECT, 0, 10, 0)).toBeNull()
  })
})
