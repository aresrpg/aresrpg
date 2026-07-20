// [D248] IDLE WOBBLE — the idle float, explicitly kept when isometric became the
// default. It ran unconditionally even pre-iso-default
// (never gated by mobile/isometric) — this file proves the extracted pure fn (embed_voxel_fight_camera.js's
// `idle_wobble`) is bounded/deterministic AND still wired into the live pose, so a future refactor can't
// silently re-gate it away. Companion file (house pattern — mirrors the sibling
// embed_voxel_fight_camera.test.js's own former isometric companion): this reaches into module internals
// (idle_wobble directly), unlike that file's black-box-only philosophy, so it stays isolated here.

import { afterAll, describe, expect, it } from 'bun:test'
import { PerspectiveCamera } from 'three'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

const restore_browser_globals = install_browser_globals()

const { create_fight_camera, idle_wobble } = await import('./embed_voxel_fight_camera.js')

afterAll(restore_browser_globals)

const CELL = 1.33 // BOARD_CELL_M
const GRID = 11
const FRAME = { origin: { x: 0, y: 0, z: 0 }, grid_w: GRID, grid_h: GRID }

/** A minimal fake EventTarget — just enough for create_fight_camera's constructor-time addEventListener calls. */
function fake_target() {
  const listeners = new Map()
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)?.add(fn)
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn)
    },
  }
}

/** A recording engine + a stub canvas — the module writes the pose here (mirrors the sibling file's make_rig). */
function make_rig() {
  const positions = /** @type {number[][]} */ ([])
  const camera = new PerspectiveCamera(70, 800 / 600, 0.1, 1000)
  const engine = {
    set_camera_position: (/** @type {number[]} */ p) => positions.push(p),
    set_camera_orientation: () => {},
    set_camera_fov: () => {},
    set_motion_blur_enabled: () => {},
    get_camera: () => camera,
  }
  const canvas = /** @type {any} */ ({
    ...fake_target(),
    style: {},
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  })
  return { engine, canvas, positions }
}

describe('fight camera — idle wobble (the kept signature float)', () => {
  it('idle_wobble(t) is a pure, bounded fn — and it is wired into the live default (ortho) camera position', () => {
    expect(idle_wobble(3.14)).toEqual(idle_wobble(3.14)) // same t ⇒ same output, no hidden state
    expect(idle_wobble(0)).not.toEqual(idle_wobble(2)) // it actually moves over time
    for (let t = 0; t < 20; t += 0.37) {
      const { x, y, z } = idle_wobble(t)
      expect(Math.abs(x), `x out of bounds at t=${t}`).toBeLessThanOrEqual(0.08 + 1e-9)
      expect(Math.abs(y), `y out of bounds at t=${t}`).toBeLessThanOrEqual(0.04 + 1e-9)
      expect(Math.abs(z), `z out of bounds at t=${t}`).toBeLessThanOrEqual(0.08 + 1e-9)
    }

    const { engine, canvas, positions } = make_rig()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL })
    cam.set_active(true)
    const real_now = performance.now
    try {
      performance.now = () => 0
      cam.apply(0.016, () => FRAME)
      const p0 = positions.at(-1)
      performance.now = () => 1250 // 1.25 s — a quarter of the 5 s (0.2 Hz) wobble period
      cam.apply(0.016, () => FRAME)
      const p1 = positions.at(-1)
      const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
      expect(moved, 'the idle wobble must move the live eye between two time samples').toBeGreaterThan(0.05)
    } finally {
      performance.now = real_now
    }
  })
})
