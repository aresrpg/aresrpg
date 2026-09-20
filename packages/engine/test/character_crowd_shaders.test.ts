// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { BoxGeometry, Mesh, MeshStandardMaterial, Texture } from 'three'

import { create_instance_buffers, prepare_mesh } from '../src/character_crowd_mesh.ts'

test('compatible pose geometries share shader expressions while binding separate instance buffers', () => {
  const base = new Texture()
  base.name = 'body_base'
  const mask = new Texture()
  mask.name = 'body_color1'
  const make = (mask_texture: Texture) => {
    const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: base }))
    const source = { geometry: mesh.geometry, material: mesh.material }
    const buffers = create_instance_buffers()
    const batch = prepare_mesh(
      mesh,
      new Map([
        [base.name, base],
        [mask.name, mask_texture],
      ]),
      buffers.base_matrices,
      buffers.colors,
      null
    )
    return { batch, source, buffers }
  }
  const first = make(mask),
    second = make(mask),
    different = make(new Texture())
  try {
    expect(first.batch.materials[0]!.customProgramCacheKey()).toBe(second.batch.materials[0]!.customProgramCacheKey())
    expect(first.batch.materials[0]!.customProgramCacheKey()).not.toBe(
      different.batch.materials[0]!.customProgramCacheKey()
    )
    expect(first.batch.geometry.getAttribute('crowdMatrix0')).not.toBe(
      second.batch.geometry.getAttribute('crowdMatrix0')
    )
    expect(first.batch.mesh).not.toHaveProperty('isInstancedMesh')
    expect(first.batch.mesh.count).toBe(1)
    expect(first.batch.geometry.instanceCount).toBe(0)
    expect(first.batch.geometry.index).not.toBeNull()
    expect(first.batch.geometry.groups).toEqual(first.source.geometry.groups)
  } finally {
    for (const { batch, source } of [first, second, different]) {
      batch.dispose()
      source.geometry.dispose()
      source.material.dispose()
    }
    base.dispose()
    mask.dispose()
  }
})
