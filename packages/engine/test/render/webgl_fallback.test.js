// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-20 fallback — the node-material PARK invariant (the resolveIncludes crash class, 2026-07-12).
// The classic WebGLRenderer cannot compile three/webgpu NodeMaterials (undefined vertexShader →
// `resolveIncludes: Cannot read properties of undefined (reading 'replace')` — an UNHANDLED throw that
// killed the golden-path headless render loop when a spawn-rig VFX quad turned visible). The fallback
// parks such objects on a camera-invisible layer at add_to_scene time + self-heals in the render loop.
// These tests pin the pure helper: parks exactly the node-material objects, never classic ones,
// layer-based (visible flags untouched — app-side toggles can't re-arm the crash), idempotent.

import { describe, expect, test } from 'bun:test'
import { DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Texture } from 'three'

import { get_block_by_name } from '../../src/config/block_registry.js'
import { pick_renderer_backend } from '../../src/core/quality/backend.js'
import { create_gen_context } from '../../src/gen/column_gen.js'
import { surface_column } from '../../src/gen/heightmap.js'
import { id_is_solid } from '../../src/player/block_solidity.js'
import { ground_surface_y } from '../../src/player/spawn.js'
import { SENSHI_MALE_GLB_AVAILABLE } from '../../src/test_helpers/glb_fixture.js'
import * as fallback from '../../src/render/webgl_fallback.js'

// MISSING-ARTIFACT (#117): character_controller.js unconditionally re-exports create_character_avatar
// from character_avatar.js (D193 "ONE home"), which static-imports the absent-by-design senshi_male.glb —
// see test_helpers/glb_fixture.js. Guarded dynamic import so this file's OTHER describe block (no
// character_controller dependency) keeps running for real.
const { create_character_controller } = SENSHI_MALE_GLB_AVAILABLE
  ? await import('../../src/player/character_controller.js')
  : {}

const { park_node_material_objects } = fallback
const WATER = /** @type {number} */ (get_block_by_name('water')?.id)

/** A stand-in for any three/webgpu NodeMaterial (SpriteNodeMaterial / MeshBasicNodeMaterial / …) —
 *  the classic renderer identifies them by the `isNodeMaterial` brand, which is all the helper reads. */
const fake_node_material = () => /** @type {*} */ ({ isNodeMaterial: true })

describe('park_node_material_objects — the classic-renderer NodeMaterial guard', () => {
  test('parks node-material meshes off the default camera layer; classic materials untouched', () => {
    const root = new Group()
    const classic = new Mesh(undefined, new MeshBasicMaterial())
    const vfx = new Mesh(undefined, fake_node_material())
    const nested = new Group()
    const nested_vfx = new Mesh(undefined, fake_node_material())
    nested.add(nested_vfx)
    root.add(classic, vfx, nested)

    const parked = park_node_material_objects(root)
    expect(parked).toBe(2) // vfx + nested_vfx, found through the subtree

    const camera = new PerspectiveCamera() // default layer 0 — the fallback camera
    expect(vfx.layers.test(camera.layers)).toBe(false) // skipped by the render list → never compiled
    expect(nested_vfx.layers.test(camera.layers)).toBe(false)
    expect(classic.layers.test(camera.layers)).toBe(true) // classic mesh still renders
    expect(root.layers.test(camera.layers)).toBe(true) // group nodes untouched (no material)
  })

  test('visible flags are untouched — an app-side visibility toggle cannot re-arm the crash', () => {
    const vfx = new Mesh(undefined, fake_node_material())
    vfx.visible = true
    park_node_material_objects(vfx)
    expect(vfx.visible).toBe(true) // parked by LAYER, not by visible (the aura flips .visible per frame)
    const camera = new PerspectiveCamera()
    vfx.visible = true // the aura gate turning ON later…
    expect(vfx.layers.test(camera.layers)).toBe(false) // …still never reaches the classic compile
  })

  test('idempotent — a re-park counts 0 and a multi-material mesh parks on any node member', () => {
    const vfx = new Mesh(undefined, fake_node_material())
    expect(park_node_material_objects(vfx)).toBe(1)
    expect(park_node_material_objects(vfx)).toBe(0) // already parked — no re-count

    const multi = new Mesh(undefined)
    multi.material = /** @type {*} */ ([new MeshBasicMaterial(), fake_node_material()])
    expect(park_node_material_objects(multi)).toBe(1)

    const clean = new Mesh(undefined, new MeshBasicMaterial())
    expect(park_node_material_objects(clean)).toBe(0) // clean tree — nothing parked (the loud-rethrow gate)
  })
})

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('forced WebGL gameplay floor', () => {
  test('a submerged fallback column resolves a solid on-ground spawn after terrain readiness', () => {
    expect(pick_renderer_backend({ navigator_gpu: {}, force_webgl: true })).toBe('webgl')

    const gen = create_gen_context('aresrpg')
    const x = -300
    const z = 660
    const column = surface_column(gen, x, z)
    expect(column.block_id).toBe(WATER)

    const collision_sampler = fallback.sample_heightmap_collision
    expect(typeof collision_sampler).toBe('function')
    const sample_block = (/** @type {number} */ sx, /** @type {number} */ y, /** @type {number} */ sz) =>
      collision_sampler(gen, sx, y, sz)

    // Mirror the fallback handle's false→true is_column_resident edge: physics holds the provisional
    // position, then the shared gate resolves this collision sampler and teleports before the first tick.
    const provisional = /** @type {[number, number, number]} */ ([x + 0.5, 138, z + 0.5])
    const controller = /** @type {NonNullable<typeof create_character_controller>} */ (create_character_controller)({
      sample_block,
      position: provisional,
    })
    let terrain_ready = false
    const settle_spawn = () => {
      if (!terrain_ready) return false
      const ground_y = ground_surface_y(sample_block, x, z)
      if (ground_y === null) return false
      expect(ground_y).toBe(column.surface_y)
      expect(id_is_solid(sample_block(x, ground_y, z))).toBe(true)
      controller.teleport([provisional[0], ground_y + 1, provisional[2]])
      return true
    }
    expect(settle_spawn()).toBe(false)
    expect(controller.get_transform().position[1]).toBe(138)
    terrain_ready = true
    expect(settle_spawn()).toBe(true)

    controller.tick(1 / 30)
    const transform = controller.get_transform()
    expect(transform.position[1]).toBeCloseTo(column.surface_y + 1, 2)
    expect(transform.on_ground).toBe(true)
    controller.dispose()
  })

  test('late PBR avatar children become cheap unlit materials without losing their skin', () => {
    const root = new Group() // create_character_avatar mounts this empty root before its GLB resolves
    const prepare = fallback.prepare_webgl_scene_object
    expect(typeof prepare).toBe('function')
    prepare?.(root)

    const map = new Texture()
    const material = new MeshStandardMaterial({
      color: 0x6d4c41,
      map,
      opacity: 0.72,
      transparent: true,
      alphaTest: 0.25,
      side: DoubleSide,
    })
    const body = new Mesh(undefined, material)
    root.add(body) // async GLB completion: the already-mounted root receives its body later

    expect(body.material).toBeInstanceOf(MeshBasicMaterial)
    expect(body.material.map).toBe(map)
    expect(body.material.color.getHex()).toBe(material.color.getHex())
    expect(body.material.opacity).toBe(0.72)
    expect(body.material.transparent).toBe(true)
    expect(body.material.alphaTest).toBe(0.25)
    expect(body.material.side).toBe(DoubleSide)

    let replacement_disposes = 0
    body.material.addEventListener('dispose', () => {
      replacement_disposes += 1
    })
    material.dispose() // the mob-model's existing cleanup edge
    expect(replacement_disposes).toBe(1)
  })
})
