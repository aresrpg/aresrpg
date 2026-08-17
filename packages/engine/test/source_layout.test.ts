// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

const source_root = join(import.meta.dir, '../src')

const source_entries = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? [path, ...source_entries(path)] : [path]
  })

describe('engine source layout', () => {
  test('active runtime code contains neither vanilla JavaScript nor a legacy folder', () => {
    const entries = source_entries(source_root)
    expect(entries.filter((path) => /\.(?:js|jsx)$/.test(path))).toEqual([])
    expect(entries.filter((path) => path.split('/').includes('legacy'))).toEqual([])
    expect(entries.filter((path) => /(?:terrain_(?:materials|atlas)|voxel_textures)\.ts$/.test(path))).toEqual([])
    expect(entries.filter((path) => path.endsWith('/atmosphere.ts'))).toEqual([])
  })

  test('the procedural-color engine ships no extracted terrain atlases', () => {
    const package_entries = source_entries(join(source_root, '..'))
    expect(package_entries.filter((path) => /(?:block_atlas|extract_legacy_atlas)/.test(path))).toEqual([])
  })

  test('world-authored colors compile to one small procedural terrain texture', () => {
    const entries = source_entries(source_root)
    const terrain_pool = readFileSync(join(source_root, 'terrain_pool.ts'), 'utf8')

    expect(entries.filter((path) => /foliage_resources\.ts$/.test(path))).toEqual([])
    expect(terrain_pool).toContain('create_material_texture')
    expect(terrain_pool).toContain('texture(')
  })

  test('runtime rendering recognizes presets, never authored material names', () => {
    const runtime = source_entries(source_root)
      .filter((path) => path.endsWith('.ts'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')

    expect(runtime).not.toMatch(/\b(?:meadow|foundation|basalt|loam)\b/i)
  })

  test('terrain keeps one PBR material response and stable large-world pixel grain', () => {
    const near = readFileSync(join(source_root, 'terrain_pool.ts'), 'utf8')
    const far = readFileSync(join(source_root, 'far_terrain.ts'), 'utf8')

    expect(near).not.toContain('MeshLambertNodeMaterial')
    expect(far).not.toContain('MeshLambertNodeMaterial')
    expect(near).toContain('.div(float(SURFACE_HASH_WRAP))')
  })

  test('terrain streaming starts before the advanced sky finishes baking', () => {
    const backend = readFileSync(join(source_root, 'webgpu_backend.ts'), 'utf8')

    expect(backend).not.toContain('await use_sky_quality')
    expect(backend).toContain('void use_sky_quality')
  })

  test('water has no periodic surface caustic and terrace shadows keep contact', () => {
    const water = readFileSync(join(source_root, 'water.ts'), 'utf8')
    const backend = readFileSync(join(source_root, 'webgpu_backend.ts'), 'utf8')
    const normal_bias = Number(backend.match(/sun\.shadow\.normalBias = ([\d.]+)/)?.[1])

    expect(water).not.toContain('caustic_cross')
    expect(normal_bias).toBeLessThanOrEqual(0.005)
  })

  test('near and horizon water are one transparent draw with one sampled center', () => {
    const water = readFileSync(join(source_root, 'water.ts'), 'utf8')
    const sample_commit = water.slice(
      water.indexOf("worker.addEventListener('message'"),
      water.indexOf('const request =')
    )

    expect(water.match(/new Mesh\(/g)).toHaveLength(1)
    expect(sample_commit).toContain('surface.position.set(data.center[0]')
    expect(water).not.toContain('horizon_coverage')
  })

  test('water waves stay world-anchored and its finite horizon remains beyond the camera far plane', () => {
    const water = readFileSync(join(source_root, 'water.ts'), 'utf8')
    const layout = readFileSync(join(source_root, 'water_surface_layout.ts'), 'utf8')

    expect(water).not.toContain('sin(positionLocal')
    expect(layout).toContain('const OUTER_RADIUS = 4_096')
  })

  test('post-processed world tiers keep the common grade and the one FXAA edge pass', () => {
    const renderer = readFileSync(join(source_root, 'frame_renderer.ts'), 'utf8')
    const lens = readFileSync(join(source_root, 'lens_water.ts'), 'utf8')

    expect(renderer).toContain('scene_pass.setResolutionScale')
    expect(renderer).toContain('profile.render.sharpness === null')
    expect(renderer).toContain("from 'three/addons/tsl/display/FXAANode.js'")
    expect(renderer.match(/fxaa\(/g)).toHaveLength(1)
    expect(lens).toContain('if (!wet) return final_node')
    expect(renderer).toContain('const lens_dry = lens.apply(final_frame, false)')
    expect(renderer).toContain('const lens_wet = lens.apply(final_frame, true)')
  })

  test('the emergency grid follows world entities instead of cutting through them', () => {
    const fallback = readFileSync(join(source_root, 'grid_fallback.ts'), 'utf8')

    expect(fallback).toContain('presentation.set_ground_y(ground_y.position[1])')
  })

  test('far terrain interpolates appearance, never numeric palette identities', () => {
    const terrain = readFileSync(join(source_root, 'far_terrain.ts'), 'utf8')
    const worker = readFileSync(join(source_root, 'far_worker.ts'), 'utf8')

    expect(terrain).not.toContain("attribute('material_id'")
    expect(terrain).toContain("attribute('base_color'")
    expect(terrain).toContain("attribute('paired_color'")
    expect(worker).toContain('world.materials.entries[column.surface_id]')
    expect(worker).toContain('material_pattern(surface.preset')
    expect(terrain).not.toContain('const grain = hash(')
  })
})
