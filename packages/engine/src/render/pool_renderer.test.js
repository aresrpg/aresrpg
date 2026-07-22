// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Unit tests for the NG-MEGA terrain renderer (src/render/pool_renderer.js): the quad→class
// partition (word-level alignment, the "sky-blue holes clustered along contours" regression) and the
// renderer's CPU-side contract — upload/remove/replace into the mega pool, the get_stats counters
// (draws = occupied slots), the scoped shadow-invalidation epochs, and full dispose teardown.
//
// Runs headless: the renderer constructs its pools/culls/materials + bakes the atlas without a GPU
// (TSL node graphs + DataArrayTexture build device-free). We pass `renderer: null` so update() short-
// circuits before the GPU cull compute pass — the frustum cull itself is GPU code, exercised end-to-
// end on real Metal by the cube_planes + streaming bench gates (and its CPU plane extraction is unit-
// tested in gpu_cull.test.js). The old per-chunk sector renderer's InstancedMesh/BundleGroup/reversed-Z
// frustum tests were deleted with that path (2026-07-03 exit gate); the reversed-Z regression they
// pinned now lives in gpu_cull.test.js.

import { describe, expect, test } from 'bun:test'
import { Scene } from 'three'

import { get_block_by_name } from '../config/block_registry.js'

import {
  create_terrain_renderer,
  max_pool_storage_bytes,
  partition_quads,
  resolve_pool_config,
  SLOT_QUADS,
} from './pool_renderer.js'
import { create_quad_pool } from './quad_pool.js'

/**
 * Packs one quad in the frozen 8-byte wire format (mirrors quad_buffer.js).
 * @param {number} x @param {number} y @param {number} z @param {number} w @param {number} h
 * @param {number} face @param {number} block
 * @returns {[number, number]}
 */
function quad(x, y, z, w, h, face, block) {
  const a =
    (x & 63) | ((y & 63) << 6) | ((z & 63) << 12) | (((w - 1) & 31) << 18) | (((h - 1) & 31) << 23) | ((face & 7) << 28)
  const b = (block & 0xfff) | (15 << 12) | (0xff << 20) // full sun, ao=3 on all corners
  return [a >>> 0, b >>> 0]
}

/** Builds the headless renderer (renderer:null ⇒ update() runs no GPU cull). @param {Scene} scene */
function make_renderer(scene) {
  return create_terrain_renderer({ renderer: null, scene, camera: null })
}

// ── PARTITION WORD-ALIGNMENT (the "sky-blue holes clustered along contours" defect) ──────────────
// upload_chunk splits the mesher's ONE combined quad buffer 3-ways (solid / foliage face>=6 / liquid
// block_id). The quad order follows the mesher's plane sweep, so any dropped or word-misaligned u32
// PAIR shows up as a cluster of missing/garbled quads along a contour. These tests drive worst-case
// interleavings through partition_quads and assert WORD-LEVEL pair equality against an independent
// reference filter, so a single swapped/dropped word fails.
describe('partition_quads — word-pair alignment & classification', () => {
  // Registry facts this suite pins (block_registry.js): grass=3/dirt=2/sand=4/log=6 solid;
  // water=5 liquid; grass_tuft=10/flower_red=11 foliage crosses (emitted as faces 6/7).
  const SOLID_IDS = [1, 2, 3, 4]
  const LIQUID_ID = 5
  const CROSS_ID = 10

  /**
   * Packs a quad with EXPLICIT block_id in word_b and face in word_a, and a recognizable payload
   * in every other field so a word swap (e.g. reading block_id from word_a) is caught.
   * @param {number} seq unique per-quad tag threaded through the non-classifying fields
   * @param {number} face 0-7
   * @param {number} block_id 0-4095
   * @returns {[number, number]}
   */
  function tagged_quad(seq, face, block_id) {
    const x = seq & 63
    const y = (seq + 1) & 63
    const z = (seq + 2) & 63
    const w = (seq % 32) + 1
    const h = ((seq + 7) % 32) + 1
    return quad(x, y, z, w, h, face, block_id)
  }

  /**
   * Independent reference partition: decodes face from word_a bits 28-30 and block_id from word_b
   * bits 0-11 (the FROZEN layout). Deliberately NOT the production path — the oracle.
   * @param {Uint32Array} buffer @param {number} count
   * @returns {{solid: number[], foliage: number[], liquid: number[]}}
   */
  function reference_partition(buffer, count) {
    const solid = []
    const foliage = []
    const liquid = []
    for (let i = 0; i < count; i++) {
      const a = buffer[i * 2]
      const b = buffer[i * 2 + 1]
      const face = (a >>> 28) & 0x7
      const block_id = b & 0xfff
      if (face >= 6) foliage.push(a, b)
      else if (block_id === LIQUID_ID) liquid.push(a, b)
      else solid.push(a, b)
    }
    return { solid, foliage, liquid }
  }

  /** @param {[number, number][]} quads */
  function assert_partition_matches(quads) {
    const buffer = new Uint32Array(quads.flat())
    const count = quads.length
    const got = partition_quads(buffer, count)
    const want = reference_partition(buffer, count)
    expect(Array.from(got.solid)).toEqual(want.solid)
    expect(Array.from(got.foliage)).toEqual(want.foliage)
    expect(Array.from(got.liquid)).toEqual(want.liquid)
    // Conservation: every input word lands in exactly one bucket, none duplicated or dropped.
    expect(got.solid.length + got.foliage.length + got.liquid.length).toBe(count * 2)
  }

  test('empty input → three empty buckets', () => {
    assert_partition_matches([])
  })

  test('pure solid keeps every word pair intact and in order', () => {
    assert_partition_matches(SOLID_IDS.map((id, i) => tagged_quad(i, i % 6, id)))
  })

  test('worst-case interleave solid/liquid/foliage (odd count) — no dropped or swapped words', () => {
    assert_partition_matches([
      tagged_quad(0, 2, 3), // solid grass top
      tagged_quad(1, 6, CROSS_ID), // foliage A
      tagged_quad(2, 2, LIQUID_ID), // liquid top (face<6, water id)
      tagged_quad(3, 0, 1), // solid stone +x
      tagged_quad(4, 7, CROSS_ID), // foliage B
      tagged_quad(5, 2, LIQUID_ID), // liquid top
      tagged_quad(6, 5, 2), // solid dirt -z
    ])
  })

  test('foliage classified by FACE (word_a), never by block_id — a cross id on a face<6 quad is solid', () => {
    const buffer = new Uint32Array([...tagged_quad(0, 2, CROSS_ID), ...tagged_quad(1, 6, CROSS_ID)])
    const { solid, foliage, liquid } = partition_quads(buffer, 2)
    expect(Array.from(solid)).toEqual([...tagged_quad(0, 2, CROSS_ID)])
    expect(Array.from(foliage)).toEqual([...tagged_quad(1, 6, CROSS_ID)])
    expect(liquid.length).toBe(0)
  })

  test('liquid classified by block_id (word_b bits 0-11), never by word_a — a water id in word_a is NOT liquid', () => {
    const decoy = quad(LIQUID_ID, 0, 0, 1, 1, 3, 3) // x=5 in word_a, block_id=3 (grass) in word_b
    const real_water = tagged_quad(1, 2, LIQUID_ID)
    const buffer = new Uint32Array([...decoy, ...real_water])
    const { solid, foliage, liquid } = partition_quads(buffer, 2)
    expect(Array.from(solid)).toEqual([...decoy])
    expect(Array.from(liquid)).toEqual([...real_water])
    expect(foliage.length).toBe(0)
  })

  test('over-allocated backing buffer: only the first quad_count quads are read', () => {
    const live = [tagged_quad(0, 2, 3), tagged_quad(1, 6, CROSS_ID), tagged_quad(2, 2, LIQUID_ID)]
    const buffer = new Uint32Array(live.length * 2 + 8) // 4 quads of trailing stale capacity
    buffer.set(live.flat())
    buffer.fill(0xdeadbeef, live.length * 2) // poison the tail
    const got = partition_quads(buffer, live.length)
    const want = reference_partition(buffer, live.length)
    expect(Array.from(got.solid)).toEqual(want.solid)
    expect(Array.from(got.foliage)).toEqual(want.foliage)
    expect(Array.from(got.liquid)).toEqual(want.liquid)
    expect(got.solid.length + got.foliage.length + got.liquid.length).toBe(live.length * 2)
  })

  test('all-foliage and all-liquid chunks partition wholly into their single bucket', () => {
    assert_partition_matches([tagged_quad(0, 6, CROSS_ID), tagged_quad(1, 7, CROSS_ID), tagged_quad(2, 6, 11)])
    assert_partition_matches([tagged_quad(0, 2, LIQUID_ID), tagged_quad(1, 2, LIQUID_ID)])
  })

  test('large pseudo-random interleave (250 quads) matches the reference filter word-for-word', () => {
    let s = 0x1234567
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff)
    /** @type {[number, number][]} */
    const quads = []
    for (let i = 0; i < 250; i++) {
      const roll = rnd()
      if (roll < 0.2) quads.push(tagged_quad(i, rnd() < 0.5 ? 6 : 7, rnd() < 0.5 ? CROSS_ID : 11))
      else if (roll < 0.4) quads.push(tagged_quad(i, 2, LIQUID_ID))
      else quads.push(tagged_quad(i, Math.floor(rnd() * 6), SOLID_IDS[Math.floor(rnd() * SOLID_IDS.length)]))
    }
    assert_partition_matches(quads)
  })
})

// ── [LEAVES-2X Rung 2] LEAF FACE SPLIT: a leaf id routes by FACE — cube (0-5) → canopy, sprite (6/7) →
// cutout. This is the whole seam that gives the opaque far shell its own early-Z pool while the near
// sprites keep alphaTest. A misrouted face here would either drop the far canopy or defeat the early-Z.
describe('partition_quads — leaf face split (canopy cubes vs cutout sprites)', () => {
  const LEAF = /** @type {number} */ (get_block_by_name('leaves')?.id)

  test('leaf id + face<6 → canopy; leaf id + face≥6 → cutout; word pairs intact', () => {
    const cube_px = quad(1, 2, 3, 4, 5, 0, LEAF) // leaf CUBE face (+x)
    const cube_py = quad(6, 7, 8, 2, 2, 2, LEAF) // leaf CUBE face (+y top)
    const sprite_a = quad(9, 1, 2, 1, 2, 6, LEAF) // leaf SPRITE plane A
    const sprite_b = quad(3, 4, 5, 1, 2, 7, LEAF) // leaf SPRITE plane B
    const buffer = new Uint32Array([...cube_px, ...sprite_a, ...cube_py, ...sprite_b])
    const { solid, foliage, cutout, canopy, liquid } = partition_quads(buffer, 4)

    expect(Array.from(canopy)).toEqual([...cube_px, ...cube_py]) // both cube faces, in order
    expect(Array.from(cutout)).toEqual([...sprite_a, ...sprite_b]) // both sprite faces, in order
    expect(solid.length).toBe(0) // a leaf is NEVER solid — even its cube face routes to canopy
    expect(foliage.length).toBe(0) // a leaf sprite is cutout, never foliage (that's grass)
    expect(liquid.length).toBe(0)
    // conservation: every input word lands in exactly one bucket
    expect(solid.length + foliage.length + cutout.length + canopy.length + liquid.length).toBe(4 * 2)
  })

  test('a non-leaf cross id on face≥6 still routes to foliage (leaf-split does not steal grass)', () => {
    const grass = quad(0, 0, 0, 1, 1, 6, 10) // grass_tuft cross (id 10, not a leaf)
    const leaf_cube = quad(1, 1, 1, 1, 1, 3, LEAF)
    const { foliage, canopy, cutout } = partition_quads(new Uint32Array([...grass, ...leaf_cube]), 2)
    expect(Array.from(foliage)).toEqual([...grass])
    expect(Array.from(canopy)).toEqual([...leaf_cube])
    expect(cutout.length).toBe(0)
  })
})

// ── RENDERER CONTRACT: upload → mega pool, stats, epochs, dispose ─────────────────────────────────
describe('pool terrain renderer — upload / stats / dispose', () => {
  test('constructs headless and adds exactly one pool Mesh per class to the scene (no BundleGroup)', () => {
    const scene = new Scene()
    make_renderer(scene)
    let meshes = 0
    let bundles = 0
    scene.traverse((o) => {
      if (/** @type {{isMesh?: boolean}} */ (o).isMesh) meshes += 1
      if (/** @type {{isBundleGroup?: boolean}} */ (o).isBundleGroup) bundles += 1
    })
    expect(meshes).toBe(6) // five class meshes + the post-water foliage scene-depth restore
    expect(bundles).toBe(0) // NO BundleGroup (survey F1) — the legacy sector path is gone
  })

  test('upload places a pure-solid chunk in one solid slot; get_stats reports draws=slots, quads', () => {
    const scene = new Scene()
    const terrain = make_renderer(scene)
    // 3 solid grass-top quads.
    const solid = new Uint32Array([
      ...quad(0, 0, 0, 32, 32, 2, 3),
      ...quad(1, 0, 0, 32, 32, 2, 3),
      ...quad(2, 0, 0, 32, 32, 2, 3),
    ])
    terrain.upload_chunk([0, 0, 0], solid, 3)
    const stats = terrain.get_stats()
    expect(stats.chunk_count).toBe(1)
    expect(stats.quads).toBe(3)
    expect(stats.draw_calls).toBe(1) // one occupied solid slot (3 ≤ slot_quads) ⇒ one indirect draw
    expect(stats.liquid_quads).toBe(0)
  })

  test('a mixed chunk lands quads across solid/foliage/liquid pools; liquid_quads is the water subset', () => {
    const scene = new Scene()
    const terrain = make_renderer(scene)
    const mixed = new Uint32Array([
      ...quad(0, 0, 0, 32, 32, 2, 3), // solid grass top
      ...quad(1, 0, 0, 1, 1, 6, 10), // foliage cross (face 6)
      ...quad(2, 0, 0, 32, 32, 2, 5), // liquid (water id 5)
    ])
    terrain.upload_chunk([0, 0, 0], mixed, 3)
    const stats = terrain.get_stats()
    expect(stats.quads).toBe(3)
    expect(stats.liquid_quads).toBe(1)
    expect(stats.draw_calls).toBe(3) // one occupied slot in each of the three class pools
    const pool = terrain.pool_stats?.()
    expect(pool?.dropped_uploads).toBe(0)
  })

  test('re-upload replaces in place; remove frees the slots (chunk_count / draws drop back)', () => {
    const scene = new Scene()
    const terrain = make_renderer(scene)
    terrain.upload_chunk([0, 0, 0], new Uint32Array(quad(0, 0, 0, 32, 32, 2, 3)), 1)
    terrain.upload_chunk(
      [0, 0, 0],
      new Uint32Array([...quad(0, 0, 0, 32, 32, 2, 3), ...quad(1, 0, 0, 32, 32, 2, 3)]),
      2
    )
    expect(terrain.get_stats().chunk_count).toBe(1) // replaced, not duplicated
    expect(terrain.get_stats().quads).toBe(2)
    terrain.remove_chunk([0, 0, 0])
    expect(terrain.get_stats().chunk_count).toBe(0)
    expect(terrain.get_stats().draw_calls).toBe(0)
  })

  test('update() with renderer:null is a no-op (no GPU cull) and never throws', () => {
    const scene = new Scene()
    const terrain = make_renderer(scene)
    terrain.upload_chunk([0, 0, 0], new Uint32Array(quad(0, 0, 0, 32, 32, 2, 3)), 1)
    expect(() => terrain.update(undefined, 0)).not.toThrow()
  })

  test('gpu_cull=false skips only cull dispatches even when renderer + camera handles exist', () => {
    const scene = new Scene()
    let culls = 0
    const terrain = create_terrain_renderer({
      renderer: /** @type {*} */ ({}),
      scene,
      camera: /** @type {*} */ ({}),
      gpu_cull: false,
      on_gpu_cull: () => {
        culls += 1
      },
    })
    expect(() => terrain.update(undefined, 0)).not.toThrow()
    expect(culls).toBe(0)
    terrain.dispose()
  })
})

// upload_epoch is the terrain-dirty signal the render lane diffs to decide when to re-render the
// cached sun shadow map; shadow_epoch is the SCOPED variant that only bumps for changes inside the
// sun box (so flight streaming beyond the box doesn't force a re-render). Runs headless.
describe('epochs — upload_epoch (all changes) + shadow_epoch (scoped to the sun box)', () => {
  test('upload_epoch advances on upload and removal, holds steady between changes', () => {
    const scene = new Scene()
    const terrain = make_renderer(scene)
    const e0 = terrain.upload_epoch()
    terrain.upload_chunk([0, 0, 0], new Uint32Array(quad(0, 0, 0, 32, 32, 2, 3)), 1)
    const e1 = terrain.upload_epoch()
    expect(e1).toBeGreaterThan(e0)
    terrain.update(undefined, 0) // steady frame → no change
    expect(terrain.upload_epoch()).toBe(e1)
    terrain.remove_chunk([0, 0, 0])
    expect(terrain.upload_epoch()).toBeGreaterThan(e1)
    const e2 = terrain.upload_epoch()
    terrain.remove_chunk([9, 9, 9]) // non-resident → no-op → no bump
    expect(terrain.upload_epoch()).toBe(e2)
  })

  test('shadow_epoch bumps only when the changed chunk XZ footprint intersects the sun box', () => {
    const scene = new Scene()
    const terrain = make_renderer(scene)
    terrain.set_shadow_box(0, 0, 64, 64) // world box x[0,64] z[0,64]
    const s0 = terrain.shadow_epoch()
    terrain.upload_chunk([0, 0, 0], new Uint32Array(quad(0, 0, 0, 32, 32, 2, 3)), 1) // world x[0,32] z[0,32] — IN box
    expect(terrain.shadow_epoch()).toBeGreaterThan(s0)
    const s1 = terrain.shadow_epoch()
    terrain.upload_chunk([10, 0, 10], new Uint32Array(quad(0, 0, 0, 32, 32, 2, 3)), 1) // world x[320,352] — OUT of box
    expect(terrain.shadow_epoch()).toBe(s1) // scoped: no shadow re-render for out-of-box streaming
  })
})

describe('dispose — full GPU teardown empties the resident set and clears the scene', () => {
  test('after dispose: stats zeroed, pool meshes removed, materials disposed, no throw', () => {
    const scene = new Scene()
    const terrain = make_renderer(scene)
    const mixed = new Uint32Array([
      ...quad(0, 0, 0, 32, 32, 2, 3),
      ...quad(1, 0, 0, 1, 1, 6, 10),
      ...quad(2, 0, 0, 32, 32, 2, 5),
    ])
    terrain.upload_chunk([0, 0, 0], mixed, 3)

    // Arm dispose spies on the three class materials.
    /** @type {Set<import('three').Material>} */
    const disposed = new Set()
    /** @type {import('three').Material[]} */
    const materials = []
    scene.traverse((o) => {
      const mesh = /** @type {{isMesh?: boolean, material?: import('three').Material}} */ (o)
      if (mesh.isMesh && mesh.material) {
        materials.push(mesh.material)
        mesh.material.addEventListener('dispose', () => disposed.add(/** @type {any} */ (mesh.material)))
      }
    })
    expect(materials.length).toBe(6) // five class materials + the post-water foliage scene-depth restore

    expect(() => terrain.dispose()).not.toThrow()

    const stats = terrain.get_stats()
    expect(stats.chunk_count).toBe(0)
    expect(stats.draw_calls).toBe(0)

    let meshes_left = 0
    scene.traverse((o) => {
      if (/** @type {{isMesh?: boolean}} */ (o).isMesh) meshes_left += 1
    })
    expect(meshes_left).toBe(0) // every pool + auxiliary mesh detached
    expect(disposed.size).toBe(6) // every class material + the foliage depth-restore clone is disposed
  })
})

// ── WATER-BED / FINAL SCENE-DEPTH CONTRACT (#303 + #454) ──────────────────────────────────────────
// Water samples viewport depth while its transparent pass draws. Non-solid cross flora must stay out of
// that bed, but the completed scene depth still needs the same alpha-tested silhouettes for post effects.
describe('foliage depth ordering', () => {
  test('water sees only solid terrain, then a colorless pass restores foliage to final scene depth', () => {
    const scene = new Scene()
    const terrain = make_renderer(scene)
    try {
      const foliage_mesh = /** @type {any} */ (
        scene.children.find((mesh) => mesh.userData?.render_class === 'foliage' && !mesh.userData?.scene_depth_restore)
      )
      const foliage_depth_mesh = /** @type {any} */ (
        scene.children.find((mesh) => mesh.userData?.scene_depth_restore === true)
      )
      const liquid_mesh = /** @type {any} */ (scene.children.find((mesh) => mesh.userData?.render_class === 'liquid'))

      expect(foliage_mesh.material.transparent).toBe(false)
      expect(foliage_mesh.material.alphaTest).toBe(0.5)
      expect(foliage_mesh.material.depthTest).toBe(true)
      expect(foliage_mesh.material.depthWrite).toBe(false)
      expect(liquid_mesh.material.transparent).toBe(true)
      expect(liquid_mesh.material.depthTest).toBe(true)
      expect(liquid_mesh.material.depthWrite).toBe(false)
      expect(foliage_mesh.renderOrder).toBeLessThan(liquid_mesh.renderOrder)

      expect(foliage_depth_mesh.material.transparent).toBe(true)
      expect(foliage_depth_mesh.material.alphaTest).toBe(0.5)
      expect(foliage_depth_mesh.material.colorWrite).toBe(false)
      expect(foliage_depth_mesh.material.depthTest).toBe(true)
      expect(foliage_depth_mesh.material.depthWrite).toBe(true)
      expect(foliage_depth_mesh.renderOrder).toBeGreaterThan(liquid_mesh.renderOrder)

      terrain.set_class_visible('foliage', false)
      expect(foliage_mesh.visible).toBe(false)
      expect(foliage_depth_mesh.visible).toBe(false)
    } finally {
      terrain.dispose()
    }
  })
})

// ── DEVICE STORAGE-BINDING SIZING (the HIGH-tier tab-crash guard, QA F2/B2) ───────────────────────
// core/renderer.js sizes the WebGPU maxStorageBufferBindingSize device limit from max_pool_storage_bytes()
// so the mega quad pool BINDS. The DEFAULT (128 MiB) is under the HIGH r8 solid pool → GPUValidationError
// → the tab crashes. These lock the sizing to the REAL buffer the GPU binds and to the "> default" tripwire
// that proves the raised-limit request is load-bearing (mirror of texture_baker.test.js's atlas-layer gate).
describe('max_pool_storage_bytes — device storage-binding sizing', () => {
  const DEFAULT_STORAGE_BINDING_BYTES = 128 * 1024 * 1024 // WebGPU spec default (128 MiB)

  test('equals the largest per-class quad pool buffer at each tier', () => {
    for (const tier of /** @type {const} */ (['low', 'medium', 'high'])) {
      const config = resolve_pool_config(tier)
      // The buffer each class allocates = capacity_quads · uvec2 (quad_pool.js pool_attr: 2 u32 = 8 B/quad).
      const per_class = Object.values(config).map((c) => c.max_slots * c.slot_quads * 8)
      expect(max_pool_storage_bytes(tier)).toBe(Math.max(...per_class))
    }
    // solid is the dominant class (widest resident footprint × 2048 quads/slot), so it sets the ceiling.
    const high = resolve_pool_config('high')
    expect(max_pool_storage_bytes('high')).toBe(high.solid.max_slots * SLOT_QUADS.solid * 8)
  })

  test('matches the byte size of the buffer quad_pool actually allocates (no drift)', () => {
    // Runtime provenance: build the REAL solid pool at the HIGH config and assert its storage buffer's
    // byteLength equals what renderer.js requests — the two can never drift out of the same source.
    const { solid } = resolve_pool_config('high')
    const pool = create_quad_pool(solid)
    expect(pool.pool_attr.array.byteLength).toBe(max_pool_storage_bytes('high'))
    pool.dispose()
  })

  test('HIGH exceeds the 128 MiB default (the request is load-bearing) while MEDIUM fits at the default', () => {
    // If HIGH ever fell to/under the default, the raised device-limit request would be dead code and the
    // world would silently crash on the HIGH tier again — fail HERE (re-confirm target adapters) instead.
    expect(max_pool_storage_bytes('high')).toBeGreaterThan(DEFAULT_STORAGE_BINDING_BYTES)
    // MEDIUM is the FROZEN owner-tuned tier: it must keep fitting at the untouched default (why it never
    // crashed) — so the renderer's clamp leaves MEDIUM at the 128 MiB default, raising only for HIGH.
    expect(max_pool_storage_bytes('medium')).toBeLessThanOrEqual(DEFAULT_STORAGE_BINDING_BYTES)
    console.log(
      `pool storage: low ${max_pool_storage_bytes('low')} · medium ${max_pool_storage_bytes('medium')} · ` +
        `high ${max_pool_storage_bytes('high')} B (WebGPU default binding ${DEFAULT_STORAGE_BINDING_BYTES})`
    )
  })
})

// ── LEAVES-2X Rung 1 + SHADER DIET D8: shadow-casting is tier-gated ────────────────────────────────
// Rung 1: leaf (cutout) + grass (foliage) cast ONLY at high (tiers.foliage_shadows); medium skips the
// alpha-tested sprite storm, letting the BFS sun-leak gate own the floor darkening.
// SHADER DIET D8: at LOW the whole sun shadow map is dropped (tiers.low.simple_shaders) — NOTHING casts
// (kills the ~70 KB solid-shadow pipeline) and NOTHING receives (sheds shadow sampling from every color
// fragment); cave/canopy-floor darkening moves to the sun-leak gate folded into the simple lighting
// model's direct term. So solid casts at MEDIUM/HIGH only; liquid never (depthWrite off).
describe('shadow casters — tier-gated leaf/grass (Rung 1) + LOW shadow-map drop (SHADER DIET D8)', () => {
  /** @param {'low'|'medium'|'high'} tier @param {'castShadow'|'receiveShadow'} field
   *  @returns {Record<string, boolean>} render_class → the mesh flag */
  const flags = (tier, field) => {
    const scene = new Scene()
    create_terrain_renderer({ renderer: null, scene, camera: null, tier })
    /** @type {Record<string, boolean>} */
    const out = {}
    for (const m of scene.children) if (m.userData?.render_class) out[m.userData.render_class] = m[field]
    return out
  }
  test('MEDIUM/HIGH: solid casts, liquid never, cutout+foliage cast ONLY at high', () => {
    const medium = flags('medium', 'castShadow')
    const high = flags('high', 'castShadow')
    for (const t of [medium, high]) {
      expect(t.solid).toBe(true)
      expect(t.liquid).toBe(false)
    }
    expect(medium.cutout).toBe(false) // medium tier — leaf sprite storm out of the shadow pass
    expect(high.cutout).toBe(true)
    expect(medium.foliage).toBe(false)
    expect(high.foliage).toBe(true)
  })
  test('LOW (SHADER DIET D8): nothing casts and nothing receives — the shadow map is dropped', () => {
    const cast = flags('low', 'castShadow')
    const recv = flags('low', 'receiveShadow')
    for (const cls of ['solid', 'foliage', 'cutout', 'canopy', 'liquid']) {
      expect(cast[cls]).toBe(false)
      expect(recv[cls]).toBe(false)
    }
  })
  test('MEDIUM/HIGH still receive shadows (only LOW drops receive)', () => {
    for (const tier of /** @type {const} */ (['medium', 'high'])) {
      const recv = flags(tier, 'receiveShadow')
      for (const cls of ['solid', 'foliage', 'cutout', 'canopy', 'liquid']) expect(recv[cls]).toBe(true)
    }
  })
})
