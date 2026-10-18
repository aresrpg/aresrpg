// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash } from 'node:crypto'

import { expect, test } from 'bun:test'

import { build_scatter_mesh } from '../src/scatter_mesh.ts'
import type { ScatterInstance, ScatterKind } from '../src/scatter.ts'

// Captured from the original main-thread scatter renderer on 2026-10-17, before worker extraction.
// Every attribute and the culling sphere cover all eight variants of every authored scatter kind.
import captured from './fixtures/scatter_mesh.json'

const kinds: readonly ScatterKind[] = [
  'tuft',
  'bush',
  'flower',
  'mushroom',
  'twig',
  'pebble',
  'spike',
  'cobweb',
  'dry_reed',
  'city_shrub',
  'field_crop',
]

test('worker geometry preserves the original merged meshes and conservative culling bounds', () => {
  const instances: readonly ScatterInstance[] = kinds.flatMap((kind, index) =>
    Array.from({ length: 8 }, (_, variant) => ({
      kind,
      variant,
      x: index * 2 - 5,
      y: variant / 2 + 100,
      z: variant * 3 - 12,
      yaw: 0.73,
      scale: 0.87,
      color: [0.2, 0.6, 0.1] as const,
      accent: [0.3, 0.8, 0.2] as const,
      climate_tint: 1 as const,
    }))
  )
  const data = build_scatter_mesh([-32, 96, -32], instances)!
  const attributes = Object.fromEntries(
    Object.entries(data.attributes).map(([name, { values }]) => [
      name,
      createHash('sha256').update(Buffer.from(values.buffer)).digest('hex'),
    ])
  )
  expect(attributes).toEqual(captured.attributes)
  expect([...data.bounds.center]).toEqual(captured.center)
  expect(data.bounds.radius).toBe(captured.radius)
  expect(build_scatter_mesh([0, 0, 0], [])).toBeNull()
})
