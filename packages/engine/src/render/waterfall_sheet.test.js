// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// B4 waterfall overlay — pure-geometry + tier-ladder + refcount-lifecycle tests. The GPU draw (sheet
// scroll, spray arc, foam) is the headed pose spec's concern (bench/waterfall_poses.spec.js); here we
// pin the deterministic CPU half: span→quad geometry, basin selection, the tier ladder, and the
// per-column refcount lifecycle (build once on the first resident cy, dispose on the last).

import { test, expect, describe } from 'bun:test'

import {
  MAX_BASINS_PER_COLUMN,
  MIN_BASIN_H,
  MIN_SHEET_H,
  SHEET_PROUD,
  build_sheet_geometry,
  create_waterfall_system,
  foam_enabled_for,
  scroll_speed_for,
  select_basins,
  span_quad,
  spray_count_for,
} from './waterfall_sheet.js'

/** @param {Partial<import('../gen/waterfall_registry.js').FallSpan>} o @returns {import('../gen/waterfall_registry.js').FallSpan} */
const span = (o) => /** @type {any} */ ({ x0: 0, x1: 0, z0: 0, z1: 0, y_top: 4, y_bot: 0, face: 0, width: 1, ...o })

describe('span_quad — face-resolved vertical quad geometry', () => {
  test('+X face: quad sits on the x1+1 boundary, proud toward −X; run along Z', () => {
    const q = /** @type {any} */ (
      span_quad(span({ x0: 590, x1: 590, z0: 448, z1: 449, y_top: 154, y_bot: 151, face: 0 }))
    )
    expect(q).not.toBeNull()
    const plane_x = 591 - SHEET_PROUD
    for (const c of q.corners) expect(c[0]).toBeCloseTo(plane_x, 6)
    expect(q.run).toBe(2) // z 448 → 450
    expect(q.height).toBe(3)
    expect(q.u0).toBe(448) // WIDTH SANITY: u anchors at the ABSOLUTE world z0, not span-local 0
    // corners span y_bot..y_top and z0..z1+1
    const ys = q.corners.map((c) => c[1])
    expect(Math.min(...ys)).toBe(151)
    expect(Math.max(...ys)).toBe(154)
    const zs = q.corners.map((c) => c[2])
    expect(Math.min(...zs)).toBe(448)
    expect(Math.max(...zs)).toBe(450)
  })

  test('−X face: quad on the x0 boundary, proud toward +X', () => {
    const q = /** @type {any} */ (
      span_quad(span({ x0: 588, x1: 588, z0: 450, z1: 450, y_top: 151, y_bot: 148, face: 1 }))
    )
    for (const c of q.corners) expect(c[0]).toBeCloseTo(588 + SHEET_PROUD, 6)
  })

  test('+Z face: run along X, quad on the z1+1 boundary', () => {
    const q = /** @type {any} */ (
      span_quad(span({ x0: 600, x1: 603, z0: 460, z1: 460, y_top: 170, y_bot: 166, face: 4 }))
    )
    for (const c of q.corners) expect(c[2]).toBeCloseTo(461 - SHEET_PROUD, 6)
    expect(q.run).toBe(4) // x 600 → 604
    expect(q.u0).toBe(600) // WIDTH SANITY: u anchors at the ABSOLUTE world x0, not span-local 0
  })

  test('−Z face: quad on the z0 boundary, proud toward +Z', () => {
    const q = /** @type {any} */ (
      span_quad(span({ x0: 577, x1: 577, z0: 449, z1: 449, y_top: 170, y_bot: 167, face: 5 }))
    )
    for (const c of q.corners) expect(c[2]).toBeCloseTo(449 + SHEET_PROUD, 6)
  })

  test('null face and zero-height spans render no quad', () => {
    expect(span_quad(span({ face: null }))).toBeNull()
    expect(span_quad(span({ y_top: 150, y_bot: 150, face: 0 }))).toBeNull()
  })
})

// MIN-DROP GATE — fixes 1-block terrace steps getting sheeted: a terraced
// hillside read as giant opaque white walls. Only a real ≥3-block continuous drop earns a sheet.
describe('span_quad — MIN-DROP GATE (terraced-hillside slabs regression)', () => {
  test('MIN_SHEET_H is 3', () => {
    expect(MIN_SHEET_H).toBe(3)
  })
  test('a 1-block terrace step renders no quad', () => {
    expect(span_quad(span({ y_top: 101, y_bot: 100, face: 0 }))).toBeNull()
  })
  test('a 2-block terrace step renders no quad', () => {
    expect(span_quad(span({ y_top: 102, y_bot: 100, face: 0 }))).toBeNull()
  })
  test('a 3-block continuous drop renders a quad', () => {
    expect(span_quad(span({ y_top: 103, y_bot: 100, face: 0 }))).not.toBeNull()
  })
})

describe('build_sheet_geometry — merged per-column geometry', () => {
  test('skips null/zero spans; one quad per resolved span; aSheet carries height', () => {
    const spans = [
      span({ x0: 590, x1: 590, z0: 448, z1: 449, y_top: 154, y_bot: 151, face: 0 }), // resolved, h3
      span({ x0: 577, x1: 577, z0: 449, z1: 449, y_top: 170, y_bot: 167, face: 5 }), // resolved, h3
      span({ face: null }), // skipped
      span({ y_top: 158, y_bot: 158, face: 0 }), // zero height, skipped
    ]
    const { geometry, quad_count } = build_sheet_geometry(spans)
    expect(quad_count).toBe(2)
    expect(geometry.getAttribute('position').array.length).toBe(2 * 4 * 3)
    expect(geometry.getIndex().array.length).toBe(2 * 6)
    const sheet = geometry.getAttribute('aSheet')
    expect(sheet.itemSize).toBe(3)
    // aSheet.z of every vertex is its span's height (3 for both quads here)
    for (let v = 0; v < sheet.count; v += 1) expect(sheet.array[v * 3 + 2]).toBe(3)
  })

  test('WIDTH SANITY: aSheet u is ABSOLUTE world-anchored, so two adjacent same-height unmerged spans do not replay an identical noise-phase frame', () => {
    const spans = [
      span({ x0: 5, x1: 5, z0: 10, z1: 10, y_top: 103, y_bot: 100, face: 0 }), // width-1, z0=10
      span({ x0: 6, x1: 6, z0: 20, z1: 20, y_top: 103, y_bot: 100, face: 0 }), // same height, z0=20 — must NOT also read u=0
    ]
    const { geometry } = build_sheet_geometry(spans)
    const sheet = geometry.getAttribute('aSheet')
    expect(sheet.array[0]).toBe(10) // quad 0, vertex 0, u component
    expect(sheet.array[12]).toBe(20) // quad 1, vertex 0, u component (base (1*4+0)*3)
  })

  test('empty input yields a zero-quad geometry (no sheet, no crash)', () => {
    const { quad_count, geometry } = build_sheet_geometry([])
    expect(quad_count).toBe(0)
    expect(geometry.getAttribute('position').array.length).toBe(0)
  })
})

describe('tier ladder — the "barely animate on LOW" law', () => {
  test('scroll crawls on LOW, flows on MEDIUM/HIGH', () => {
    expect(scroll_speed_for('low')).toBeCloseTo(0.3, 6)
    expect(scroll_speed_for('medium')).toBe(1)
    expect(scroll_speed_for('high')).toBe(1)
  })
  test('spray is 0 on LOW, denser on HIGH than MEDIUM', () => {
    expect(spray_count_for('low')).toBe(0)
    expect(spray_count_for('medium')).toBeGreaterThan(0)
    expect(spray_count_for('high')).toBeGreaterThan(spray_count_for('medium'))
  })
  test('foam disc is MEDIUM+ only', () => {
    expect(foam_enabled_for('low')).toBe(false)
    expect(foam_enabled_for('medium')).toBe(true)
    expect(foam_enabled_for('high')).toBe(true)
  })
})

describe('select_basins — spray/foam impact points', () => {
  test('LOW selects nothing (spray off + foam off)', () => {
    expect(select_basins([span({ y_top: 160, y_bot: 150, face: 0 })], 'low')).toEqual([])
  })
  test('MEDIUM keeps only tall (≥MIN_BASIN_H) resolved falls, tallest first, capped', () => {
    const spans = [
      span({ x0: 1, x1: 1, z0: 1, z1: 1, y_top: 152, y_bot: 151, face: 0 }), // h1 — too short
      span({ x0: 2, x1: 2, z0: 2, z1: 2, y_top: 160, y_bot: 151, face: 0 }), // h9
      span({ x0: 3, x1: 3, z0: 3, z1: 3, y_top: 156, y_bot: 151, face: 0 }), // h5
      span({ face: null, y_top: 200, y_bot: 150 }), // null face — excluded
    ]
    const basins = select_basins(spans, 'medium')
    expect(basins.length).toBe(2)
    expect(basins[0].pos[1]).toBe(151) // basin at the bottom edge
    // sorted tallest-first: h9 (span x=2) before h5 (x=3)
    expect(basins[0].pos[0]).toBeCloseTo(3 - SHEET_PROUD, 6) // x1+1-proud for face 0 at x=2
    expect(MIN_BASIN_H).toBe(3)
  })
  test('caps at MAX_BASINS_PER_COLUMN', () => {
    const many = []
    for (let i = 0; i < 8; i += 1) many.push(span({ x0: i, x1: i, z0: 0, z1: 0, y_top: 160 + i, y_bot: 150, face: 0 }))
    expect(select_basins(many, 'high').length).toBe(MAX_BASINS_PER_COLUMN)
  })
})

describe('create_waterfall_system — per-column refcount lifecycle', () => {
  const fake_scene = () => {
    /** @type {any[]} */
    const children = []
    return { children, add: (o) => children.push(o), remove: (o) => children.splice(children.indexOf(o), 1) }
  }
  const RICH = [
    span({ x0: 590, x1: 590, z0: 448, z1: 449, y_top: 154, y_bot: 151, face: 0 }),
    span({ x0: 592, x1: 592, z0: 448, z1: 448, y_top: 160, y_bot: 151, face: 0 }), // tall → basin
  ]
  /** @param {Record<string, any[]>} table */
  const spans_from = (table) => (cx, cz) => table[`${cx},${cz}`] ?? []

  test('builds one group per column, refcounts across the 12 cy, disposes on the last', () => {
    const scene = fake_scene()
    const sys = create_waterfall_system({ scene, tier: 'medium', get_spans: spans_from({ '2,3': RICH }) })
    sys.note_load([2, 0, 3])
    expect(scene.children.length).toBe(1)
    expect(sys.stats().columns).toBe(1)
    expect(sys.stats().sheets).toBe(1)
    sys.note_load([2, 5, 3]) // another cy of the SAME column — no new group
    expect(scene.children.length).toBe(1)
    sys.note_unload([2, 0, 3]) // one cy leaves — group stays
    expect(scene.children.length).toBe(1)
    sys.note_unload([2, 5, 3]) // last cy leaves — group disposed
    expect(scene.children.length).toBe(0)
    expect(sys.stats().columns).toBe(0)
    sys.dispose()
  })

  test('a column with no falls registers (refcount) but adds nothing to the scene', () => {
    const scene = fake_scene()
    const sys = create_waterfall_system({ scene, tier: 'medium', get_spans: spans_from({}) })
    sys.note_load([9, 0, 9])
    sys.note_load([9, 1, 9])
    expect(scene.children.length).toBe(0)
    expect(sys.stats().columns).toBe(1) // remembered so it doesn't recompute per cy
    expect(sys.stats().sheets).toBe(0)
    sys.note_unload([9, 0, 9])
    sys.note_unload([9, 1, 9])
    expect(sys.stats().columns).toBe(0)
    sys.dispose()
  })

  test('LOW tier builds the sheet but no spray/foam children', () => {
    const scene = fake_scene()
    const sys = create_waterfall_system({ scene, tier: 'low', get_spans: spans_from({ '2,3': RICH }) })
    sys.note_load([2, 0, 3])
    expect(scene.children[0].children.length).toBe(1) // sheet mesh only
    expect(sys.stats().sprays).toBe(0)
    sys.dispose()
  })

  test('MEDIUM tier adds spray + foam for the tall fall', () => {
    const scene = fake_scene()
    const sys = create_waterfall_system({ scene, tier: 'medium', get_spans: spans_from({ '2,3': RICH }) })
    sys.note_load([2, 0, 3])
    // group = sheet + (spray + foam) for the one tall basin ⇒ ≥3 children
    expect(scene.children[0].children.length).toBeGreaterThanOrEqual(3)
    expect(sys.stats().sprays).toBeGreaterThan(0)
    sys.dispose()
  })

  test('streamed basins reuse one spray pipeline while keeping basin inputs per object', () => {
    const scene = fake_scene()
    const sys = create_waterfall_system({
      scene,
      tier: 'medium',
      get_spans: spans_from({
        '2,3': [span({ x0: 2, x1: 2, z0: 3, z1: 3, y_top: 160, y_bot: 151, face: 0 })],
        '8,9': [span({ x0: 8, x1: 8, z0: 9, z1: 10, y_top: 174, y_bot: 162, face: 4 })],
      }),
    })
    sys.note_load([2, 0, 3])
    sys.note_load([8, 0, 9])

    const spray_a = scene.children[0].children.find((o) => o.isInstancedMesh)
    const spray_b = scene.children[1].children.find((o) => o.isInstancedMesh)
    expect(spray_a).toBeDefined()
    expect(spray_b).toBeDefined()
    expect(spray_a.material).toBe(spray_b.material)
    expect(spray_a.userData.spray_origin).not.toEqual(spray_b.userData.spray_origin)
    expect(spray_a.userData.spray_radius).not.toBe(spray_b.userData.spray_radius)
    sys.dispose()
  })

  test('pipeline warmers mount the finite tier set with the exact live materials', () => {
    const low_scene = fake_scene()
    const low = create_waterfall_system({ scene: low_scene, tier: 'low', get_spans: spans_from({}) })
    const release_low = low.mount_pipeline_warmers()
    expect(low_scene.children[0].children.length).toBe(1)
    expect(low_scene.children[0].children[0].frustumCulled).toBe(false)
    release_low()
    release_low()
    expect(low_scene.children.length).toBe(0)
    low.dispose()

    const scene = fake_scene()
    const sys = create_waterfall_system({ scene, tier: 'medium', get_spans: spans_from({ '2,3': RICH }) })
    const release = sys.mount_pipeline_warmers()
    const [warmers] = scene.children
    expect(warmers.children.length).toBe(3)
    expect(warmers.children.every((o) => o.frustumCulled === false)).toBe(true)
    sys.note_load([2, 0, 3])
    const [, live] = scene.children
    expect(warmers.children[0].material).toBe(live.children[0].material)
    expect(warmers.children[1].material).toBe(live.children[1].material)
    expect(warmers.children[2].material).toBe(live.children[2].material)
    release()
    expect(scene.children).toEqual([live])
    sys.dispose()
  })

  test('column unload never disposes shared spray/foam resources; system dispose does so once', () => {
    const scene = fake_scene()
    const sys = create_waterfall_system({ scene, tier: 'medium', get_spans: spans_from({ '2,3': RICH }) })
    sys.note_load([2, 0, 3])
    const [, spray, foam] = scene.children[0].children
    const shared = [spray.geometry, spray.material, foam.geometry, foam.material]
    const dispose_counts = new Map(shared.map((resource) => [resource, 0]))
    for (const resource of shared)
      resource.dispose = () => dispose_counts.set(resource, dispose_counts.get(resource) + 1)

    sys.note_unload([2, 0, 3])
    expect([...dispose_counts.values()]).toEqual([0, 0, 0, 0])
    sys.dispose()
    sys.dispose()
    expect([...dispose_counts.values()]).toEqual([1, 1, 1, 1])
  })
})
