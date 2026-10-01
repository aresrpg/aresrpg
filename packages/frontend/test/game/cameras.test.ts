// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  create_camera_director,
  create_fight_addon,
  create_follow_addon,
  create_spectate_addon,
  FIGHT_POLAR_RAD,
  idle_wobble,
  type CameraAnchor,
  type FightBoardFrame,
} from '../../src/game/core/cameras.ts'

const open_world = () => false // no solids — pure orbit math
const anchor: CameraAnchor = { x: 10, y: 5, z: -4, eye_height: 1.8, speed: 0, on_ground: true }
const listener_stub = { addEventListener: () => {}, removeEventListener: () => {} }
const fake_canvas = {
  ...listener_stub,
  ownerDocument: { ...listener_stub },
  style: { touchAction: '', setProperty: () => {} },
} as unknown as HTMLElement
const fight_board = Object.freeze({
  origin: { x: 2, y: 3, z: 4 },
  grid_w: 10,
  grid_h: 8,
  cell_size: 2,
})
const create_fight = () => create_fight_addon({ board: () => fight_board, viewport: () => [1600, 900] })

describe('follow addon (legacy shoulder rig)', () => {
  test('settles behind the character at the start distance, and its FOV widens with running speed', () => {
    const follow = create_follow_addon(open_world)
    const settled = Array.from({ length: 240 }, () => follow.frame(anchor, 1 / 60)).at(-1)!
    const dx = settled.position[0] - anchor.x
    const dz = settled.position[2] - anchor.z
    expect(Math.hypot(dx, dz)).toBeGreaterThan(2) // eye sits away from the body…
    expect(settled.position[1]).toBeGreaterThan(anchor.y + 1) // …and above the head (80° polar)
    expect(settled.fov).toBeCloseTo(68, 0)
    expect(settled.ortho_blend).toBe(0)

    const running = create_follow_addon(open_world)
    const sprint = { ...anchor, speed: 12 }
    expect(Array.from({ length: 240 }, () => running.frame(sprint, 1 / 60)).at(-1)!.fov).toBeCloseTo(72, 0)
  })

  test('the camera arm stops before a wall', () => {
    // solid everywhere except a small air pocket around the character
    const boxed = (x: number, y: number, z: number): boolean =>
      Math.abs(x + 0.5 - anchor.x) > 2 || Math.abs(z + 0.5 - anchor.z) > 2 || y < 4 || y > 9
    const follow = create_follow_addon(boxed)
    const frame = Array.from({ length: 60 }, () => follow.frame(anchor, 1 / 60)).at(-1)!
    const arm = Math.hypot(frame.position[0] - anchor.x, frame.position[2] - anchor.z)
    expect(arm).toBeLessThan(2.5) // collided well under START_DIST 4.5
  })

  test('full zoom-in latches first person and collapses the reported distance', () => {
    const follow = create_follow_addon(open_world)
    follow.dolly(-10) // to the floor, below FP_ENTER_DIST
    Array.from({ length: 120 }, () => follow.frame(anchor, 1 / 60))
    expect(follow.is_first_person()).toBeTrue()
    expect(follow.distance()).toBeLessThan(0.2)
  })
})

describe('fight addon (legacy board rig)', () => {
  test('holds the fixed orthographic board pose, and zoom changes only its framing', () => {
    const fight = create_fight()
    const frame = fight.frame(anchor, 0)
    const center = [fight_board.origin.x + 10, fight_board.origin.z + 8] as const
    const wobble = idle_wobble(0)
    const horizontal = Math.hypot(frame.position[0] - center[0] - wobble.x, frame.position[2] - center[1] - wobble.z)
    const vertical = frame.position[1] - fight_board.origin.y - 1.2 - wobble.y
    expect(Math.atan2(horizontal, vertical)).toBeCloseTo(FIGHT_POLAR_RAD, 5)
    expect(frame.fov).toBe(66)
    expect(frame.ortho_blend).toBe(1)
    expect(frame.ortho_height).toBeGreaterThan(0)

    // Zoom changes only the orthographic framing; reset clears manual input.
    const initial = fight.frame(anchor, 0)
    fight.zoom_by(-21)
    fight.pan_by_pixels(40, 20)
    expect(fight.frame(anchor, 0).ortho_height!).toBeLessThan(initial.ortho_height!)
    fight.reset()
    expect(fight.get_state()).toEqual({ pan_x: 0, pan_z: 0, zoom: 0 })
  })

  test('each board corner can reach the camera focus without panning beyond the board', () => {
    for (const [grid_w, grid_h] of [
      [6, 14],
      [20, 20],
    ] as const) {
      const board = { ...fight_board, grid_w, grid_h }
      for (const [x, z] of [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ] as const) {
        const fight = create_fight_addon({ board: () => board, viewport: () => [844, 390] })
        // Drag past the limit in each camera-relative direction, as repeated touch swipes would.
        fight.pan_by_pixels((-x + z) * 100_000, (-x - z) * 100_000)
        const frame = fight.frame(anchor, 0)
        expect(frame.target[0]).toBeCloseTo(board.origin.x + ((x + 1) * board.grid_w * board.cell_size) / 2)
        expect(frame.target[2]).toBeCloseTo(board.origin.z + ((z + 1) * board.grid_h * board.cell_size) / 2)
        expect(Math.abs(fight.get_state().pan_x)).toBe((board.grid_w * board.cell_size) / 2)
        expect(Math.abs(fight.get_state().pan_z)).toBe((board.grid_h * board.cell_size) / 2)
      }
    }
  })

  test('changing to a smaller board clamps the retained pan to its footprint', () => {
    let board: FightBoardFrame = fight_board
    const fight = create_fight_addon({ board: () => board })
    fight.pan_by_pixels(100_000, 0)
    board = { ...fight_board, grid_w: 4, grid_h: 3 }
    fight.frame(anchor, 0)
    expect(fight.get_state()).toEqual({ pan_x: -4, pan_z: 3, zoom: 0 })
  })
})

describe('camera director', () => {
  test('spectate keeps its fixed elevation when the terrain anchor differs', () => {
    const spectate = create_spectate_addon({
      focus: () => [12, -8] as const,
      zoom: () => 120,
      ground_y: () => 146,
      yaw: () => Math.PI * 0.25,
      pitch: () => 0.55,
    })

    const frame = spectate.frame(anchor, 0)
    expect(frame.target).toEqual([12, 146, -8])
    expect(frame.position[1]).toBeGreaterThan(146)
    expect(Math.hypot(frame.position[0] - 12, frame.position[2] + 8)).toBeGreaterThan(100)
  })

  test('switching addons travels smoothly instead of cutting', () => {
    const spectate = create_spectate_addon({
      focus: () => [anchor.x, anchor.z] as const,
      zoom: () => 50,
      ground_y: () => anchor.y,
      yaw: () => Math.PI * 0.25,
      pitch: () => 0.55,
    })
    const fight = create_fight()
    const director = create_camera_director(spectate, fake_canvas)
    const settled = director.frame(anchor, 1)
    expect(settled.fov).toBe(48)

    director.use(fight)
    const mid = director.frame(anchor, 0.2)
    expect(mid.fov).toBeGreaterThan(48)
    expect(mid.fov).toBeLessThan(66)
    const done = director.frame(anchor, 1)
    expect(done.fov).toBe(66)
  })
})
