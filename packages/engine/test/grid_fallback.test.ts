// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { AgXToneMapping, LinearSRGBColorSpace, NoToneMapping, Scene, SRGBColorSpace, type WebGLRenderer } from 'three'

import {
  add_grid_fallback_lights,
  configure_grid_renderer,
  flatten_grid_camera,
  flatten_grid_entity,
} from '../src/grid_fallback.ts'

test('the degraded grid keeps lit world models readable', () => {
  const scene = new Scene()
  const remove = add_grid_fallback_lights(scene)

  expect(scene.children.map(({ type }) => type)).toEqual(['HemisphereLight', 'DirectionalLight'])
  expect(
    scene.children
      .map((child) => Reflect.get(child, 'intensity'))
      .every((value) => typeof value === 'number' && value > 0)
  ).toBeTrue()

  remove()
  expect(scene.children).toEqual([])
})

test('the legacy neon palette keeps its authored AgX display transform', () => {
  const renderer = {
    outputColorSpace: LinearSRGBColorSpace,
    toneMapping: NoToneMapping,
    toneMappingExposure: 0,
  } as Pick<WebGLRenderer, 'outputColorSpace' | 'toneMapping' | 'toneMappingExposure'>
  configure_grid_renderer(renderer)
  expect(renderer).toEqual({ outputColorSpace: SRGBColorSpace, toneMapping: AgXToneMapping, toneMappingExposure: 1.1 })
})

test('grid animation uses continuous world and camera coordinates across snapped recentering', () => {
  const source = readFileSync(new URL('../src/hack_presentation.ts', import.meta.url), 'utf8')
  expect(source).toContain('v_camera_relative = v_world - cameraPosition.xz')
  expect(source).toContain('float distance_from_camera = length(v_camera_relative)')
  expect(source).toContain('float shimmer = sin(v_world.y * 0.05')
  expect(source).not.toContain('float distance_from_camera = length(p)')
})

test('the fallback ground is the forced zero plane and never follows entity ordering', () => {
  const source = readFileSync(new URL('../src/grid_fallback.ts', import.meta.url), 'utf8')
  expect(source).toContain('set_character_anchor: () => {}')
  expect(source).not.toContain("next.find(({ anchor }) => anchor.kind === 'world')")
})

test('cached world entities are projected onto the forced grid plane', () => {
  expect(
    flatten_grid_entity({
      id: 'mob',
      kind: 'mob',
      model_url: '/mob.glb',
      anchor: { kind: 'world', position: [4, 93, 8] },
      facing: { kind: 'yaw', yaw: 0 },
    })
  ).toMatchObject({ anchor: { kind: 'world', position: [4, 0, 8] } })
  expect(
    flatten_grid_entity({
      id: 'fighter',
      kind: 'mob',
      model_url: '/mob.glb',
      anchor: { kind: 'fight_cell', cell: 3 },
      facing: { kind: 'yaw', yaw: 0 },
    })
  ).toMatchObject({
    anchor: { kind: 'fight_cell', cell: 3 },
  })
})

test('the grid camera preserves eye height while projecting its target to zero', () => {
  expect(flatten_grid_camera([10, 105, 20], [12, 100, 22])).toEqual({
    position: [10, 5, 20],
    target: [12, 0, 22],
  })
})
