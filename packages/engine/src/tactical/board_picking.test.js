// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-16 Phase B — picking math + mask indexing unit tests (pure, no camera/WebGPU).
//
// Locks the two failure-prone invariants the study calls out: (1) FLOOR snapping at 2 m cells (round
// mis-snaps — the deliberate divergence from C), and (2) the row-major mask index (x + y*width) that
// carves the non-rectangular playable shape (D75) — void cells must pick as null.

import { test, expect, describe, mock } from 'bun:test'
import { PerspectiveCamera } from 'three'

import { snap_hit_to_cell, create_board_picking, cell_at_ndc } from './board_picking.js'
import {
  mask_index,
  read_cell,
  CELL_FLOOR,
  CELL_OBSTACLE,
  CELL_HOLE,
  DEFAULT_CELL_SIZE,
  FLOOR_THICKNESS,
} from './board.js'
import { POLAR_RAD } from './board_camera.js'

const ORIGIN = { x: 0, y: 0, z: 0 }
const CS = 2 // ENG-16 2×2 blocks

describe('mask_index (row-major x + y*width)', () => {
  test('index is x + y*width', () => {
    expect(mask_index(0, 0, 10)).toBe(0)
    expect(mask_index(3, 0, 10)).toBe(3)
    expect(mask_index(0, 1, 10)).toBe(10)
    expect(mask_index(4, 2, 10)).toBe(24)
  })
})

describe('read_cell (out-of-bounds = void)', () => {
  const w = 4
  const h = 3
  // row-major: a floor grid with an obstacle at (1,1) and a hole at (2,2)
  const mask = new Uint8Array(w * h)
  mask[mask_index(1, 1, w)] = CELL_OBSTACLE
  mask[mask_index(2, 2, w)] = CELL_HOLE

  test('reads the right byte at a cell', () => {
    expect(read_cell(mask, 0, 0, w, h)).toBe(CELL_FLOOR)
    expect(read_cell(mask, 1, 1, w, h)).toBe(CELL_OBSTACLE)
    expect(read_cell(mask, 2, 2, w, h)).toBe(CELL_HOLE)
  })

  test('out-of-bounds reads as CELL_HOLE (void), never a wrap', () => {
    expect(read_cell(mask, -1, 0, w, h)).toBe(CELL_HOLE)
    expect(read_cell(mask, 0, -1, w, h)).toBe(CELL_HOLE)
    expect(read_cell(mask, w, 0, w, h)).toBe(CELL_HOLE)
    expect(read_cell(mask, 0, h, w, h)).toBe(CELL_HOLE)
    // a negative x that would wrap into the previous row if using raw index math
    expect(read_cell(mask, -1, 1, w, h)).toBe(CELL_HOLE)
  })
})

describe('snap_hit_to_cell — FLOOR snapping at 2 m cells', () => {
  const w = 12
  const h = 10
  const mask = new Uint8Array(w * h) // all floor

  test('a hit anywhere inside a cell FLOORS to that cell (not rounds)', () => {
    // cell (0,0) spans world x,z ∈ [0,2). A hit at 1.9 must be cell 0, not 1 (round would give 1).
    expect(snap_hit_to_cell(1.9, 1.9, ORIGIN, w, h, CS, mask)).toEqual({ x: 0, y: 0 })
    expect(snap_hit_to_cell(0.1, 0.1, ORIGIN, w, h, CS, mask)).toEqual({ x: 0, y: 0 })
    // cell (3,4): world x ∈ [6,8), z ∈ [8,10). A hit at (7.99, 9.99) floors to (3,4).
    expect(snap_hit_to_cell(7.99, 9.99, ORIGIN, w, h, CS, mask)).toEqual({ x: 3, y: 4 })
    // exact boundary x=8 belongs to cell 4 (floor(8/2)=4)
    expect(snap_hit_to_cell(8.0, 0.0, ORIGIN, w, h, CS, mask)).toEqual({ x: 4, y: 0 })
  })

  test('round-vs-floor divergence: a hit at 1.2 m FLOORS to cell 0 (round → 1, wrong)', () => {
    // world 1.2 / 2 = 0.6; floor = 0 (correct at 2 m), round = 1 (the mis-snap the study warns of).
    expect(snap_hit_to_cell(1.2, 1.2, ORIGIN, w, h, CS, mask)).toEqual({ x: 0, y: 0 })
    expect(Math.round(1.2 / CS)).toBe(1) // proves round WOULD have mis-snapped
  })

  test('origin offset is subtracted before the floor', () => {
    const origin = { x: 100, y: 40, z: -50 }
    // world (100,-50) is cell (0,0)'s min corner → a hit at (101, -49) floors to cell (0,0)
    expect(snap_hit_to_cell(101, -49, origin, w, h, CS, mask)).toEqual({ x: 0, y: 0 })
    // (105.9, -45.1) → ((5.9)/2, (4.9)/2) → floor (2,2)
    expect(snap_hit_to_cell(105.9, -45.1, origin, w, h, CS, mask)).toEqual({ x: 2, y: 2 })
  })

  test('out-of-bounds hits pick null', () => {
    expect(snap_hit_to_cell(-0.1, 0, ORIGIN, w, h, CS, mask)).toBeNull()
    expect(snap_hit_to_cell(0, -0.1, ORIGIN, w, h, CS, mask)).toBeNull()
    expect(snap_hit_to_cell(w * CS, 0, ORIGIN, w, h, CS, mask)).toBeNull() // x == width*cs → cell width → oob
    expect(snap_hit_to_cell(0, h * CS, ORIGIN, w, h, CS, mask)).toBeNull()
  })

  test('void cells (hole / obstacle) pick null — the mask carves the shape (D75)', () => {
    const m = new Uint8Array(w * h)
    m[mask_index(5, 5, w)] = CELL_HOLE
    m[mask_index(6, 5, w)] = CELL_OBSTACLE
    // hit squarely inside cell (5,5): world center (11,11)
    expect(snap_hit_to_cell(11, 11, ORIGIN, w, h, CS, m)).toBeNull() // hole → not pickable
    // hit inside cell (6,5): world x ∈ [12,14) → center 13, z 11
    expect(snap_hit_to_cell(13, 11, ORIGIN, w, h, CS, m)).toBeNull() // obstacle → not pickable
    // a neighbouring floor cell still picks
    expect(snap_hit_to_cell(9, 11, ORIGIN, w, h, CS, m)).toEqual({ x: 4, y: 5 })
  })
})

// [CELL-TARGETING-OFFSET, design ruling 2026-07-19] D291 raised the slab's RENDERED walkable top FLOOR_THICKNESS
// (0.3 m) above origin.y for every OTHER consumer — entities stand at origin.y+FLOOR_THICKNESS
// (board_entities.js:289), obstacles/holes sit on floor_y+FLOOR_THICKNESS (board.js), highlights clear
// at origin.y+FLOOR_CLEAR (board_highlights.js, FLOOR_CLEAR = FLOOR_THICKNESS + headroom) — but
// board_picking's ray/floor-plane intersection stayed at bare origin.y (pre-D291). At the fight camera's
// fixed 50° tilt (board_camera.js POLAR_RAD) that mismatch drifts every pick AWAY from the camera by
// FLOOR_THICKNESS·tan(50°) ≈ 0.36 m — a "small" offset in world space (unnoticeable near a cell's
// center), but ~27% of a 1.33 m cell: enough to mis-pick a hover/click that lands near a cell's far edge,
// exactly the "lands slightly off the visually-hovered cell" symptom. Every OTHER test in this file uses
// a straight-down camera (polar 0), which cannot see this bug at all — a vertical ray hits any horizontal
// plane at the same (x,z) no matter which Y the plane sits at.
describe('cell_from_raycaster / cell_at_ndc — pick plane must match the RENDERED walkable surface', () => {
  const w = 6
  const h = 6
  const mask = new Uint8Array(w * h) // all floor
  const origin = { x: 0, y: 0, z: 0 }
  const board = { origin, width: w, height: h, cell_size: DEFAULT_CELL_SIZE, mask }

  test("a ray aimed at cell (2,2)'s TRUE rendered surface (origin.y + FLOOR_THICKNESS), near its far edge, picks (2,2) — not the next row", () => {
    // A point ON the real slab surface, 94% of the way across cell (2,2) toward its +z edge — well
    // inside the cell, but close enough to the boundary that the unfixed ~0.36 m drift crosses into row 3.
    const target = {
      x: origin.x + 2.5 * DEFAULT_CELL_SIZE,
      y: origin.y + FLOOR_THICKNESS,
      z: origin.z + 2 * DEFAULT_CELL_SIZE + 0.94 * DEFAULT_CELL_SIZE,
    }
    const camera = new PerspectiveCamera(42, 800 / 600, 0.1, 500)
    const dolly = 10 // camera distance from target — arbitrary, cancels out of the pick math
    camera.position.set(target.x, target.y + Math.cos(POLAR_RAD) * dolly, target.z - Math.sin(POLAR_RAD) * dolly)
    camera.lookAt(target.x, target.y, target.z)
    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()

    // NDC (0,0) = canvas centre = the camera's exact forward ray = exactly `target` by construction.
    // A player hovering dead-center on that visible surface point must get cell (2,2).
    expect(cell_at_ndc({ x: 0, y: 0 }, camera, board)).toEqual({ x: 2, y: 2 })
  })

  test('sanity: the SAME ray at polar 0 (straight down) is unaffected by FLOOR_THICKNESS — this is a tilt-only bug', () => {
    const target = { x: 3.5, y: origin.y + FLOOR_THICKNESS, z: 3.5 }
    const camera = new PerspectiveCamera(42, 800 / 600, 0.1, 500)
    camera.position.set(target.x, 30, target.z)
    camera.lookAt(target.x, 0, target.z)
    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()
    expect(cell_at_ndc({ x: 0, y: 0 }, camera, board)).toEqual({ x: 2, y: 2 })
  })
})

// The "click twice" root cause: cell_click used to fire at POINTERDOWN, projected against whatever camera
// pose was live under the press. board_camera.js drags the fight camera's azimuth off this SAME canvas,
// so a down-time projection can compute a cell one off from the cursor — the drag-click gate law (house
// standing law) fixes this at the source: pick at pointerUP, re-projected FRESH at up-time, and only
// within a small press→release drift tolerance (else the gesture was a camera drag, not a click).
describe('create_board_picking — pointerdown→pointerup click gesture', () => {
  const w = 12
  const h = 10
  const cs = 2
  const origin = { x: 0, y: 0, z: 0 }
  const board = { origin, width: w, height: h, cell_size: cs, mask: new Uint8Array(w * h) } // all floor

  /** Canvas stub recording listeners so the test can drive the REAL registered handlers directly (same
   *  convention as index.test.js's facade regression test). Cast `any` at each call site — it's a fake
   *  DOM stub, not a real HTMLCanvasElement (index.test.js precedent). */
  function make_canvas() {
    /** @type {Record<string, Function[]>} */
    const handlers = {}
    return {
      handlers,
      addEventListener: (/** @type {string} */ ev, /** @type {Function} */ fn) => {
        ;(handlers[ev] ??= []).push(fn)
      },
      removeEventListener: (/** @type {string} */ ev, /** @type {Function} */ fn) => {
        const a = handlers[ev] ?? []
        const i = a.indexOf(fn)
        if (i >= 0) a.splice(i, 1)
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    }
  }

  /** A REAL three camera straight above world (cx,cz) looking straight down — NDC (0,0) at the canvas
   *  centre rays down onto (cx,cz). Real Raycaster math throughout, no fakes (index.test.js precedent). */
  function look_straight_down(
    /** @type {PerspectiveCamera} */ camera,
    /** @type {number} */ cx,
    /** @type {number} */ cz
  ) {
    camera.position.set(cx, 30, cz)
    camera.lookAt(cx, 0, cz)
    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()
  }

  const down_at = (
    /** @type {ReturnType<typeof make_canvas>} */ canvas,
    /** @type {number} */ x,
    /** @type {number} */ y
  ) => {
    for (const fn of canvas.handlers.pointerdown ?? []) fn({ button: 0, clientX: x, clientY: y })
  }
  const up_at = (
    /** @type {ReturnType<typeof make_canvas>} */ canvas,
    /** @type {number} */ x,
    /** @type {number} */ y
  ) => {
    for (const fn of canvas.handlers.pointerup ?? []) fn({ button: 0, clientX: x, clientY: y })
  }

  test('fires once, projected FRESH at up-time — not the down-time camera pose', () => {
    const canvas = make_canvas()
    const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 500)
    const get_camera = mock(() => camera)
    const clicks = /** @type {({ x: number, y: number } | null)[]} */ ([])
    create_board_picking({
      canvas: /** @type {any} */ (canvas),
      get_camera,
      get_board: () => board,
      on_cell_click: (c) => clicks.push(c),
    })

    look_straight_down(camera, 3, 3) // camera over cell (1,1) at press-time
    down_at(canvas, 400, 300) // canvas centre → NDC (0,0)
    expect(get_camera.mock.calls.length).toBe(0) // down must NOT project at all
    expect(clicks.length).toBe(0)

    look_straight_down(camera, 11, 11) // the camera kept orbiting between press and release → now over (5,5)
    up_at(canvas, 400, 300) // zero drift — a clean click

    expect(get_camera.mock.calls.length).toBe(1) // the projection runs exactly once, AT UP
    expect(clicks.length).toBe(1)
    expect(clicks[0]).toEqual({ x: 5, y: 5 }) // the UP-time pose — NOT the down-time (1,1)
  })

  test('4px drift still fires — a real press/release trembles a few px', () => {
    const canvas = make_canvas()
    const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 500)
    look_straight_down(camera, 3, 3)
    const clicks = /** @type {({ x: number, y: number } | null)[]} */ ([])
    create_board_picking({
      canvas: /** @type {any} */ (canvas),
      get_camera: () => camera,
      get_board: () => board,
      on_cell_click: (c) => clicks.push(c),
    })

    down_at(canvas, 400, 300)
    up_at(canvas, 404, 300) // 4px drift ≤ tolerance
    expect(clicks.length).toBe(1)
  })

  test('10px drift = no fire — a camera-orbit drag, not a click', () => {
    const canvas = make_canvas()
    const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 500)
    look_straight_down(camera, 3, 3)
    const clicks = /** @type {({ x: number, y: number } | null)[]} */ ([])
    create_board_picking({
      canvas: /** @type {any} */ (canvas),
      get_camera: () => camera,
      get_board: () => board,
      on_cell_click: (c) => clicks.push(c),
    })

    down_at(canvas, 400, 300)
    up_at(canvas, 410, 300) // 10px drift > tolerance
    expect(clicks.length).toBe(0)
  })

  test('a clean click OFF the board fires with NULL — contract v1.2 (the D2 off-board deselect leg)', () => {
    const canvas = make_canvas()
    const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 500)
    look_straight_down(camera, 100, 100) // far outside the board — the plane hit snaps out-of-bounds → null pick
    const clicks = /** @type {({ x: number, y: number } | null)[]} */ ([])
    create_board_picking({
      canvas: /** @type {any} */ (canvas),
      get_camera: () => camera,
      get_board: () => board,
      on_cell_click: (c) => clicks.push(c),
    })

    down_at(canvas, 400, 300)
    up_at(canvas, 400, 300) // zero drift — a real click, it just missed the board
    expect(clicks.length).toBe(1)
    expect(clicks[0]).toBeNull()
  })

  test('a pointerup with no matching prior press is a no-op', () => {
    const canvas = make_canvas()
    const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 500)
    look_straight_down(camera, 3, 3)
    const clicks = /** @type {({ x: number, y: number } | null)[]} */ ([])
    create_board_picking({
      canvas: /** @type {any} */ (canvas),
      get_camera: () => camera,
      get_board: () => board,
      on_cell_click: (c) => clicks.push(c),
    })

    up_at(canvas, 400, 300) // no prior down
    expect(clicks.length).toBe(0)
  })

  test('dispose detaches all four listeners (move/down/up/leave)', () => {
    const canvas = make_canvas()
    const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 500)
    look_straight_down(camera, 3, 3)
    const controller = create_board_picking({
      canvas: /** @type {any} */ (canvas),
      get_camera: () => camera,
      get_board: () => board,
    })
    controller.dispose()
    expect((canvas.handlers.pointermove ?? []).length).toBe(0)
    expect((canvas.handlers.pointerdown ?? []).length).toBe(0)
    expect((canvas.handlers.pointerup ?? []).length).toBe(0)
    expect((canvas.handlers.pointerleave ?? []).length).toBe(0)
  })
})

// The stuck-tooltip root cause: interactive HUD chrome (spell bar, turn controls, deck cards) is overlaid ON
// TOP of the canvas, so a pointer crossing onto it never fires another 'pointermove' on the canvas — without
// an explicit leave signal, whatever cell/entity was hovered last stays latched (the dapp never gets a chance
// to clear it, so a stale tooltip parks wherever its last computed anchor was and never disappears).
describe('create_board_picking — pointer leaving the canvas clears the latched hover', () => {
  const w = 12
  const h = 10
  const cs = 2
  const origin = { x: 0, y: 0, z: 0 }
  const board = { origin, width: w, height: h, cell_size: cs, mask: new Uint8Array(w * h) } // all floor

  function make_canvas() {
    /** @type {Record<string, Function[]>} */
    const handlers = {}
    return {
      handlers,
      addEventListener: (/** @type {string} */ ev, /** @type {Function} */ fn) => {
        ;(handlers[ev] ??= []).push(fn)
      },
      removeEventListener: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    }
  }
  function look_straight_down(
    /** @type {PerspectiveCamera} */ camera,
    /** @type {number} */ cx,
    /** @type {number} */ cz
  ) {
    camera.position.set(cx, 30, cz)
    camera.lookAt(cx, 0, cz)
    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()
  }
  const move_at = (
    /** @type {ReturnType<typeof make_canvas>} */ canvas,
    /** @type {number} */ x,
    /** @type {number} */ y
  ) => {
    for (const fn of canvas.handlers.pointermove ?? []) fn({ clientX: x, clientY: y })
  }
  const leave = (/** @type {ReturnType<typeof make_canvas>} */ canvas) => {
    for (const fn of canvas.handlers.pointerleave ?? []) fn({})
  }

  test('cell and entity hover share the exact same cell-only pick', () => {
    const canvas = make_canvas()
    const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 500)
    look_straight_down(camera, 3, 3) // canvas centre rays down onto cell (1,1)
    let hovered_cell = /** @type {{ x: number, y: number } | null} */ (null)
    let resolved_cell = /** @type {{ x: number, y: number } | null} */ (null)
    const entity_events = /** @type {Array<string|null>} */ ([])
    create_board_picking({
      canvas: /** @type {any} */ (canvas),
      get_camera: () => camera,
      get_board: () => board,
      entity_at_cell: (cell) => {
        resolved_cell = cell
        return cell?.x === 1 && cell.y === 1 ? 'mob-0' : null
      },
      on_cell_hover: (cell) => {
        hovered_cell = cell
      },
      on_entity_hover: (id) => entity_events.push(id),
    })

    move_at(canvas, 400, 300)

    expect(hovered_cell).toEqual({ x: 1, y: 1 })
    expect(resolved_cell).toBe(hovered_cell) // one analytic plane hit feeds both paths
    expect(entity_events).toEqual(['mob-0'])
  })

  test('pointerleave clears both cell_hover and entity_hover exactly once', () => {
    const canvas = make_canvas()
    const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 500)
    look_straight_down(camera, 3, 3) // canvas centre (NDC 0,0) rays down onto cell (1,1)
    const cell_events = /** @type {Array<{x:number,y:number}|null>} */ ([])
    const entity_events = /** @type {Array<string|null>} */ ([])
    create_board_picking({
      canvas: /** @type {any} */ (canvas),
      get_camera: () => camera,
      get_board: () => board,
      entity_at_cell: () => 'mob-0', // the plane-picked cell resolves to a fake occupant
      on_cell_hover: (c) => cell_events.push(c),
      on_entity_hover: (id) => entity_events.push(id),
    })

    move_at(canvas, 400, 300) // hover lands on cell (1,1) + entity 'mob-0'
    expect(cell_events.at(-1)).toEqual({ x: 1, y: 1 })
    expect(entity_events.at(-1)).toBe('mob-0')

    leave(canvas) // pointer exits the canvas onto HUD chrome overlaid on top
    expect(cell_events.at(-1)).toBeNull()
    expect(entity_events.at(-1)).toBeNull()

    // idempotent — a second leave (or any duplicate browser event) does not re-spam the clear
    const cell_count = cell_events.length
    const entity_count = entity_events.length
    leave(canvas)
    expect(cell_events.length).toBe(cell_count)
    expect(entity_events.length).toBe(entity_count)
  })

  test('a leave with nothing hovered is a silent no-op (no spurious clear dispatch)', () => {
    const canvas = make_canvas()
    const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 500)
    look_straight_down(camera, 3, 3)
    const cell_events = /** @type {Array<{x:number,y:number}|null>} */ ([])
    const entity_events = /** @type {Array<string|null>} */ ([])
    create_board_picking({
      canvas: /** @type {any} */ (canvas),
      get_camera: () => camera,
      get_board: () => board,
      entity_at_cell: () => null,
      on_cell_hover: (c) => cell_events.push(c),
      on_entity_hover: (id) => entity_events.push(id),
    })

    leave(canvas) // never hovered anything this session — nothing to clear
    expect(cell_events.length).toBe(0)
    expect(entity_events.length).toBe(0)
  })
})
