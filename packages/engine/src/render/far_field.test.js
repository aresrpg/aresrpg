// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// NG-LOD SMOOTH far-field renderer tests. The material is a TSL NodeMaterial (compiled on GPU only),
// so these cover CPU-side behavior: (1) SMOOTH GEOMETRY — build_section_geometry turns a corner-grid
// FarMesh into an INDEXED BufferGeometry (33×33 grid verts + a skirt ring), world-space positions,
// per-vertex colors, and computed smooth normals; (2) SHARED CORNERS — a flat section's grid verts sit
// at the section origin footprint; (3) EMPTY — a mesh with no participating cells returns null;
// (4) HANDLE round-trip — upload/has/remove/bytes/section_count + one scene child per section + a clean
// whole-section replace. The handle test builds a three Scene + material headlessly (no render → no GPU).

import { test, expect, describe } from 'bun:test'
import { Scene } from 'three'

import { CORNERS_PER_EDGE } from '../lod/far_mesher.js'
import { CELLS_PER_SECTION } from '../lod/section_builder.js'

import { build_section_geometry, create_far_field, mask_texel_index } from './far_field.js'

const MASK_CHUNKS = 41 // must mirror far_field.js MASK_CHUNKS (kept in sync via these assertions)

const C = CORNERS_PER_EDGE
const N = CELLS_PER_SECTION

/**
 * Builds a smooth ground-only FarMesh directly (flat, all corners participating) for golden control.
 * @param {{height?:number, origin_x?:number, origin_z?:number, block_size?:number, mask_fn?:(k:number)=>number}} opts
 * @returns {import('../lod/far_mesher.js').FarMesh}
 */
function flat_mesh({ height = 100, origin_x = 0, origin_z = 0, block_size = 16, mask_fn } = {}) {
  const corner_h = new Float32Array(C * C).fill(height)
  const corner_c = new Uint8Array(C * C * 3).fill(120)
  const corner_n = new Float32Array(C * C * 3)
  for (let k = 0; k < C * C; k += 1) corner_n[k * 3 + 1] = 1 // straight up (flat)
  const corner_mask = new Uint8Array(C * C)
  for (let k = 0; k < C * C; k += 1) corner_mask[k] = mask_fn ? mask_fn(k) : 1
  return {
    kind: 'smooth',
    level: 4,
    lod_scale: 3,
    origin_x,
    origin_z,
    block_size,
    ground: { corner_h, corner_c, corner_n, corner_mask, min_height: height },
    sky: null,
  }
}

describe('build_section_geometry (smooth)', () => {
  test('indexed geometry: 33×33 grid verts (+skirt) and 2 tris per full cell', () => {
    const built = build_section_geometry(flat_mesh(), 0)
    expect(built).not.toBeNull()
    const { geometry } = /** @type {{geometry: import('three').BufferGeometry}} */ (built)
    const pos = geometry.getAttribute('position')
    // At least the 33×33 corner grid; the border skirt adds more (floor verts along 4 edges).
    expect(pos.count).toBeGreaterThanOrEqual(C * C)
    // Index present; the surface alone is N·N cells × 2 tris × 3 = full-grid triangles, plus skirt.
    const index = geometry.getIndex()
    expect(index).not.toBeNull()
    expect(/** @type {import('three').BufferAttribute} */ (index).count).toBeGreaterThanOrEqual(N * N * 6)
    // color + smooth normals present.
    expect(geometry.getAttribute('color').count).toBe(pos.count)
    expect(geometry.getAttribute('normal').count).toBe(pos.count)
    // spawn_seconds baked per vertex from the passed clock value.
    const spawn = geometry.getAttribute('spawn_seconds')
    expect(spawn.count).toBe(pos.count)
    expect(spawn.getX(0)).toBe(0)
  })

  test('grid verts are at the section footprint in world space (origin-offset, block_size spacing)', () => {
    const built = build_section_geometry(flat_mesh({ origin_x: 1000, origin_z: -2000, block_size: 16 }), 5)
    const { geometry } = /** @type {{geometry: import('three').BufferGeometry}} */ (built)
    const pos = geometry.getAttribute('position')
    // Corner (0,0) is at the origin at y=height.
    expect([pos.getX(0), pos.getY(0), pos.getZ(0)]).toEqual([1000, 100, -2000])
    // The grid spans origin → origin + N·block_size (= 512 for L4). Scan the corner grid range.
    let minx = Infinity
    let maxx = -Infinity
    for (let i = 0; i < C * C; i += 1) {
      minx = Math.min(minx, pos.getX(i))
      maxx = Math.max(maxx, pos.getX(i))
    }
    expect(minx).toBe(1000)
    expect(maxx).toBe(1000 + N * 16)
    // spawn baked = the clock value passed.
    expect(geometry.getAttribute('spawn_seconds').getX(0)).toBe(5)
  })

  test('a mesh with no participating cells returns null (nothing to draw)', () => {
    expect(build_section_geometry(flat_mesh({ mask_fn: () => 0 }), 0)).toBeNull()
  })
})

describe('build_section_geometry (voxel L1/L2)', () => {
  /** A minimal blocky VoxelMesh (one flat top quad) for wrap-path golden control. */
  function voxel_mesh() {
    return /** @type {import('../lod/far_voxel_mesher.js').VoxelMesh} */ ({
      kind: 'voxel',
      level: 1,
      lod_scale: 1,
      origin_x: 0,
      origin_z: 0,
      block_size: 2,
      min_height: 100,
      positions: new Float32Array([0, 100, 0, 2, 100, 0, 2, 100, 2, 0, 100, 2]),
      normals: new Int8Array([0, 127, 0, 0, 127, 0, 0, 127, 0, 0, 127, 0]),
      colors: new Uint8Array([80, 120, 60, 80, 120, 60, 80, 120, 60, 80, 120, 60]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    })
  }

  test('wraps the worker-built arrays directly + bakes spawn; normalized byte attrs', () => {
    const built = build_section_geometry(voxel_mesh(), 7)
    expect(built).not.toBeNull()
    const { geometry } = /** @type {{geometry: import('three').BufferGeometry}} */ (built)
    expect(geometry.getAttribute('position').count).toBe(4)
    expect(geometry.getAttribute('normal').count).toBe(4)
    // Byte attributes are flagged normalized so the material reads them as unit floats.
    expect(geometry.getAttribute('normal').normalized).toBe(true)
    expect(geometry.getAttribute('color').normalized).toBe(true)
    // spawn baked from the clock value, one per vertex.
    const spawn = geometry.getAttribute('spawn_seconds')
    expect(spawn.count).toBe(4)
    expect(spawn.getX(0)).toBe(7)
    expect(/** @type {import('three').BufferAttribute} */ (geometry.getIndex()).count).toBe(6)
  })

  test('an index-less voxel mesh returns null (nothing to draw)', () => {
    const empty = { ...voxel_mesh(), positions: new Float32Array(0), indices: new Uint32Array(0) }
    expect(build_section_geometry(/** @type {*} */ (empty), 0)).toBeNull()
  })

  test('the far-field handle uploads a voxel section like any other', () => {
    const scene = new Scene()
    const far = create_far_field({ scene })
    far.upload_section('1,0,0', /** @type {*} */ (voxel_mesh()))
    expect(far.has('1,0,0')).toBe(true)
    expect(far.section_count()).toBe(1)
    expect(far.bytes()).toBeGreaterThan(0)
    expect(scene.children.length).toBe(1)
    far.dispose()
  })
})

describe('residency-mask v-orientation (CPU write row ↔ GPU sample row)', () => {
  // Pins the mask index math so a v-flip regression (the "far sheet over resident" mirror class the
  // architect hypothesised) trips a fast unit failure. The GPU-side non-flip was verified empirically on
  // the Studio's Metal adapter (buffer row R samples at v=(R+0.5)/N, sub-texel, whole axis, 2026-07-03);
  // this asserts the CPU write agrees: index tz*N+tx ⇒ ROW = cz-oz, COLUMN = cx-ox, monotonic in z/x.
  const R = (MASK_CHUNKS - 1) / 2 // window centre offset (camera chunk sits at the centre texel)

  test('the camera chunk maps to the CENTRE texel (row R, col R)', () => {
    const cam = { cx: 100, cz: -50 }
    const ox = cam.cx - R
    const oz = cam.cz - R
    expect(mask_texel_index(cam.cx, cam.cz, ox, oz)).toBe(R * MASK_CHUNKS + R)
  })

  test('+1 in world z ⇒ +1 ROW (index +N); +1 in world x ⇒ +1 COLUMN (index +1)', () => {
    const ox = 0
    const oz = 0
    const base = mask_texel_index(10, 10, ox, oz)
    expect(mask_texel_index(10, 11, ox, oz) - base).toBe(MASK_CHUNKS) // +z → +row
    expect(mask_texel_index(11, 10, ox, oz) - base).toBe(1) // +x → +col
  })

  test('a column at the SYMMETRIC mirror row (N-1-tz) is a DIFFERENT texel — a v-flip would swap them', () => {
    const ox = 0
    const oz = 0
    const tz = 3
    const i = mask_texel_index(5, tz, ox, oz)
    const mirror = mask_texel_index(5, MASK_CHUNKS - 1 - tz, ox, oz)
    expect(i).not.toBe(mirror) // asserts asymmetry: the near (row 3) and far (row 37) ends are distinct
    expect(i).toBe(tz * MASK_CHUNKS + 5)
    expect(mirror).toBe((MASK_CHUNKS - 1 - tz) * MASK_CHUNKS + 5)
  })

  test('columns outside the ±R window return -1 (no write, far shell shows there)', () => {
    const ox = 0
    const oz = 0
    expect(mask_texel_index(-1, 5, ox, oz)).toBe(-1)
    expect(mask_texel_index(5, MASK_CHUNKS, ox, oz)).toBe(-1)
    expect(mask_texel_index(MASK_CHUNKS - 1, MASK_CHUNKS - 1, ox, oz)).toBe(
      (MASK_CHUNKS - 1) * MASK_CHUNKS + (MASK_CHUNKS - 1)
    )
  })

  test('set_resident_mask marks EXACTLY the given columns (asymmetric set — the moving-camera case)', () => {
    const scene = new Scene()
    const far = create_far_field({ scene })
    // Camera chunk (0,0); resident columns trailing to −z and reaching +z (asymmetric, like mid-flight).
    const resident = [
      { cx: 0, cz: 0 },
      { cx: 0, cz: 2 }, // +z (ahead)
      { cx: 0, cz: -3 }, // −z (trailing)
      { cx: 1, cz: 0 },
    ]
    far.set_resident_mask((cb) => resident.forEach(cb), 0, 0)
    // Each resident column reads 255; its v-mirror row reads 0 (would be swapped under a v-flip bug).
    for (const c of resident) {
      expect(far._mask_value_at(c.cx, c.cz)).toBe(255)
      const mirror_cz = -c.cz // mirror across the camera row within this centred window
      if (mirror_cz !== c.cz && !resident.some((r) => r.cx === c.cx && r.cz === mirror_cz)) {
        expect(far._mask_value_at(c.cx, mirror_cz)).toBe(0) // the mirror row is NOT marked
      }
    }
    far.dispose()
  })

  test('pre-eroded interior is exactly the old centre AND north/south/east/west predicate', () => {
    const scene = new Scene()
    const far = create_far_field({ scene })
    const offsets = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
    for (let bits = 0; bits < 32; bits += 1) {
      const drawn = offsets.filter((_, index) => (bits & (1 << index)) !== 0).map(([cx, cz]) => ({ cx, cz }))
      far.set_resident_mask((cb) => drawn.forEach(cb), 0, 0, bits)
      expect(far._mask_interior_at(0, 0)).toBe(bits === 31)
      expect(far._mask_value_at(0, 0)).toBe(bits & 1 ? 255 : 0)
    }
    far.dispose()
  })

  test('same upload epoch and camera chunk do not enumerate or dirty the mask twice', () => {
    const scene = new Scene()
    const far = create_far_field({ scene })
    let enumerations = 0
    const feed = (cb) => {
      enumerations += 1
      cb({ cx: 0, cz: 0 })
    }
    far.set_resident_mask(feed, 0, 0, 7)
    far.set_resident_mask(feed, 0, 0, 7)
    expect(enumerations).toBe(1)
    far.set_resident_mask(feed, 1, 0, 7)
    expect(enumerations).toBe(2)
    far.dispose()
  })

  test('the rendered-column iterator carries its epoch without engine wiring', () => {
    const scene = new Scene()
    const far = create_far_field({ scene })
    let epoch = 3
    let enumerations = 0
    const feed = Object.assign(
      (cb) => {
        enumerations += 1
        cb({ cx: 0, cz: 0 })
      },
      { epoch: () => epoch }
    )
    far.set_resident_mask(feed, 0, 0)
    far.set_resident_mask(feed, 0, 0)
    expect(enumerations).toBe(1)
    epoch += 1
    far.set_resident_mask(feed, 0, 0)
    expect(enumerations).toBe(2)
    far.dispose()
  })
})

describe('create_far_field handle', () => {
  test('upload / has / remove / bytes round-trip with a real Scene + material', () => {
    const scene = new Scene()
    /** @type {number[]} */
    const uploaded_bytes = []
    const far = create_far_field({ scene, on_chunk_uploaded: (bytes) => uploaded_bytes.push(bytes) })
    expect(far.section_count()).toBe(0)
    expect(far.bytes()).toBe(0)

    far.upload_section('4,0,0', flat_mesh())
    expect(far.has('4,0,0')).toBe(true)
    expect(far.section_count()).toBe(1)
    expect(far.bytes()).toBeGreaterThan(0)
    expect(uploaded_bytes).toEqual([far.bytes()])
    expect(scene.children.length).toBe(1)

    // Re-upload replaces (whole-section swap) — count stays 1, one scene child.
    far.upload_section('4,0,0', flat_mesh({ height: 120 }))
    expect(far.section_count()).toBe(1)
    expect(scene.children.length).toBe(1)
    expect(uploaded_bytes).toHaveLength(2)

    far.remove_section('4,0,0')
    expect(far.has('4,0,0')).toBe(false)
    expect(far.section_count()).toBe(0)
    expect(far.bytes()).toBe(0)
    expect(scene.children.length).toBe(0)
    far.dispose()
  })

  test('retire_section cross-fades: count/bytes drop now, mesh lingers until tick past the fade', () => {
    const scene = new Scene()
    const far = create_far_field({ scene })
    far.upload_section('4,0,0', flat_mesh())
    expect(far.section_count()).toBe(1)
    expect(scene.children.length).toBe(1)

    // Retire: accounting drops IMMEDIATELY (the streamer must see the keep-set drop this frame)…
    far.retire_section('4,0,0')
    expect(far.has('4,0,0')).toBe(false)
    expect(far.section_count()).toBe(0)
    expect(far.bytes()).toBe(0)
    // …but the mesh STAYS in the scene, dithering OUT (cross-fade — never a bare flash frame).
    expect(scene.children.length).toBe(1)

    // A tick shorter than the fade keeps it rendering.
    far.tick(0.1)
    expect(scene.children.length).toBe(1)
    // A tick past FADE_SECONDS (0.2 s total) reaps the dying mesh.
    far.tick(0.2) // clock now 0.3 > 0.2
    expect(scene.children.length).toBe(0)
    far.dispose()
  })

  test('retiring an unknown id is a no-op', () => {
    const scene = new Scene()
    const far = create_far_field({ scene })
    far.retire_section('9,9,9') // never uploaded
    expect(scene.children.length).toBe(0)
    far.tick(1)
    expect(scene.children.length).toBe(0)
    far.dispose()
  })

  test('removal detaches now and disposes geometry on the next tick', () => {
    const scene = new Scene()
    let disposals = 0
    const far = create_far_field({ scene, on_lod_dispose: () => (disposals += 1) })
    far.upload_section('4,0,0', flat_mesh())
    const [mesh] = /** @type {import('three').Mesh[]} */ (scene.children)
    const { geometry } = mesh
    geometry.addEventListener('dispose', () => {
      disposals += 10
    })
    far.remove_section('4,0,0')
    expect(scene.children.length).toBe(0)
    expect(disposals).toBe(0)
    far.tick(0.016)
    expect(disposals).toBe(11)
    far.dispose()
  })

  test('pipeline warmers include both exact-layout impostor material variants', () => {
    const scene = new Scene()
    let lod_frees = 0
    const far = create_far_field({ scene, impostors: true, on_lod_dispose: () => (lod_frees += 1) })
    const release = far.mount_pipeline_warmers()
    expect(scene.children.length).toBe(6) // 4 far-shell layouts + 2 instanced impostor variants
    release()
    expect(scene.children.length).toBe(0)
    far.tick(0.016) // deferred warmer geometries free here
    expect(lod_frees).toBe(0) // boot warmer cleanup is not a live LOD retirement
    far.dispose()
  })

  test('an empty (no-participating-cell) mesh adds nothing and removes any prior', () => {
    const scene = new Scene()
    const far = create_far_field({ scene })
    far.upload_section('1,0,0', flat_mesh())
    expect(far.section_count()).toBe(1)
    far.upload_section('1,0,0', flat_mesh({ mask_fn: () => 0 })) // empty → null geometry
    expect(far.section_count()).toBe(0)
    expect(scene.children.length).toBe(0)
    far.dispose()
  })

  test('tick advances the fade clock (no throw) and baked spawn reflects it', () => {
    const scene = new Scene()
    const far = create_far_field({ scene })
    far.tick(0.5)
    far.tick(0.5) // clock now 1.0
    far.upload_section('4,0,0', flat_mesh())
    const [child] = /** @type {[import('three').Mesh]} */ (scene.children)
    const geom = /** @type {import('three').BufferGeometry} */ (child.geometry)
    expect(geom.getAttribute('spawn_seconds').getX(0)).toBe(1) // spawned at clock=1.0
    far.dispose()
  })
})
