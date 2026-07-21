// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { existsSync } from 'node:fs'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { DoubleSide, LinearMipmapLinearFilter, NearestFilter, SRGBColorSpace } from 'three'

import { create_mob_model as fight_mob_visual_factory } from '../player/mob_model.js'
import { SENSHI_MALE_GLB_AVAILABLE } from '../test_helpers/glb_fixture.js'

// MISSING-ARTIFACT (#117): `@aresrpg/engine3/player` resolves to character_controller.js, which
// unconditionally re-exports create_character_avatar (D193 "ONE home"); board_entities.js imports it
// directly too. Both static-import the absent-by-design senshi_male.glb — see test_helpers/glb_fixture.js.
const { create_mob_model: world_mob_visual_factory } = /** @type {typeof import('@aresrpg/engine3/player')} */ (
  SENSHI_MALE_GLB_AVAILABLE ? await import('@aresrpg/engine3/player') : {}
)
const { create_board_entities, entity_outline_color } = /** @type {typeof import('./board_entities.js')} */ (
  SENSHI_MALE_GLB_AVAILABLE ? await import('./board_entities.js') : {}
)

const globals = /** @type {any} */ (globalThis)
const previous_create_image_bitmap = globals.createImageBitmap
const previous_progress_event = globals.ProgressEvent

beforeAll(() => {
  globals.createImageBitmap = async () => ({ width: 1, height: 1, close() {} })
  globals.ProgressEvent = class {
    constructor(/** @type {string} */ type, /** @type {Record<string, any>} */ init = {}) {
      Object.assign(this, { type, ...init })
    }
  }
})

afterAll(() => {
  if (previous_create_image_bitmap === undefined) delete globals.createImageBitmap
  else globals.createImageBitmap = previous_create_image_bitmap
  if (previous_progress_event === undefined) delete globals.ProgressEvent
  else globals.ProgressEvent = previous_progress_event
})

const fixture_path = new URL('../../../frontend/public/sprites/mobs/models/hy_bunny.glb', import.meta.url)
// MISSING-ARTIFACT (#117): the hy_bunny mob GLB is authored art shipped by the content pipeline (private
// repo) — absent by design here. Only the fixture-driving parity test (below) needs real bytes.
const HY_BUNNY_GLB_AVAILABLE = existsSync(fixture_path)

async function fixture_data_url() {
  const bytes = await Bun.file(fixture_path).arrayBuffer()
  return `data:model/gltf-binary;base64,${Buffer.from(bytes).toString('base64')}`
}

function meshes_of(/** @type {import('three').Object3D} */ root) {
  /** @type {any[]} */
  const meshes = []
  root.traverse((obj) => {
    if (/** @type {any} */ (obj).isMesh) meshes.push(obj)
  })
  return meshes
}

function render_signature(/** @type {import('three').Object3D} */ root) {
  const signature = []
  for (const mesh of meshes_of(root)) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (let slot = 0; slot < materials.length; slot += 1) {
      const material = materials[slot]
      const { map } = material
      signature.push({
        mesh: mesh.name,
        slot,
        cast_shadow: mesh.castShadow,
        receive_shadow: mesh.receiveShadow,
        frustum_culled: mesh.frustumCulled,
        normal_count: mesh.geometry.getAttribute('normal')?.count ?? 0,
        vertex_color_count: mesh.geometry.getAttribute('color')?.count ?? 0,
        material_type: material.type,
        color: material.color?.getHex() ?? null,
        metalness: material.metalness ?? null,
        roughness: material.roughness ?? null,
        vertex_colors: material.vertexColors ?? null,
        side: material.side,
        tone_mapped: material.toneMapped,
        map_color_space: map?.colorSpace ?? null,
        map_flip_y: map?.flipY ?? null,
        map_mag_filter: map?.magFilter ?? null,
        map_min_filter: map?.minFilter ?? null,
        map_mipmaps: map?.generateMipmaps ?? null,
        map_anisotropy: map?.anisotropy ?? null,
        emissive_map_is_map: material.emissiveMap === map,
        emissive: material.emissive?.getHex() ?? null,
        emissive_intensity: material.emissiveIntensity ?? null,
      })
    }
  }
  return signature
}

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('real rabbit GLB — overworld/fight mob render parity', () => {
  test('world public import and tactical direct import resolve the SAME factory binding', () => {
    expect(world_mob_visual_factory).toBe(fight_mob_visual_factory)
  })

  test.skipIf(!HY_BUNNY_GLB_AVAILABLE)(
    'the real board consumer matches an overworld factory instance and restores its flash baseline',
    async () => {
      const url = await fixture_data_url()
      const overworld = await world_mob_visual_factory(url, { label: 'hy_bunny:overworld' })
      const added = /** @type {import('three').Object3D[]} */ ([])
      const engine = /** @type {any} */ ({
        add_to_scene: (/** @type {import('three').Object3D} */ object) => added.push(object),
        remove_from_scene() {},
        get_scene: () => null,
        get_camera: () => null,
      })
      const board = create_board_entities(
        /** @type {any} */ ({
          cell_center_world: () => [0, 0, 0],
          origin: { x: 0, y: 0, z: 0 },
          cell_size: 1.33,
        }),
        engine
      )
      board.upsert({
        id: 'rabbit',
        kind: 'mob',
        glb_variant: url,
        cell: { x: 0, y: 0 },
        outline: 0x000000,
      })
      const fight_root = added.find((object) => object.name === 'player_avatar')
      try {
        expect(fight_root).toBeDefined()
        if (!fight_root) throw new Error('board did not mount the rabbit avatar root')
        for (let i = 0; i < 200 && meshes_of(fight_root).length === 0; i += 1) await Bun.sleep(1)
        const overworld_meshes = meshes_of(overworld.root)
        const fight_meshes = meshes_of(fight_root)
        expect(overworld_meshes).toHaveLength(30)
        expect(fight_meshes).toHaveLength(overworld_meshes.length)

        for (let i = 0; i < overworld_meshes.length; i += 1) {
          const world_mesh = overworld_meshes[i]
          const fight_mesh = fight_meshes[i]
          expect(fight_mesh.geometry).toBe(world_mesh.geometry)
          expect(fight_mesh.material).not.toBe(world_mesh.material)
          expect(fight_mesh.material.map).toBe(world_mesh.material.map)
        }

        const baseline = render_signature(overworld.root)
        expect(baseline[0]).toMatchObject({
          cast_shadow: true,
          receive_shadow: false,
          frustum_culled: false,
          material_type: 'MeshStandardMaterial',
          color: 0xffffff,
          metalness: 0,
          vertex_colors: false,
          side: DoubleSide,
          tone_mapped: true,
          map_color_space: SRGBColorSpace,
          map_mag_filter: NearestFilter,
          map_min_filter: LinearMipmapLinearFilter,
          map_mipmaps: true,
          map_anisotropy: 8,
          emissive_map_is_map: true,
          emissive: 0xffffff,
          emissive_intensity: 0.3,
        })
        expect(baseline[0].normal_count).toBeGreaterThan(0)
        expect(render_signature(fight_root)).toEqual(baseline)
        expect(entity_outline_color('mob', 0x000000)).toBeNull()
        expect(entity_outline_color('player', 0x000000)).toBe(0x000000)

        board.flash('rabbit', { r: 1, g: 0.28, b: 0.28, peak: 0.6 })
        board.tick(0.15, /** @type {any} */ (null))
        expect(render_signature(overworld.root)).toEqual(baseline)
        expect(render_signature(fight_root)).not.toEqual(baseline)

        board.tick(1, /** @type {any} */ (null))
        expect(render_signature(fight_root)).toEqual(baseline)
        expect(meshes_of(fight_root).some((mesh) => mesh.userData.__outline_shell)).toBe(false)
      } finally {
        board.dispose()
        overworld.dispose()
      }
    }
  )
})
