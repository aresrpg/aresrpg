// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { attribute, mix, float, texture } from 'three/tsl'

import { create_nature_texture } from './nature/surface_texture.ts'
import { plant_wind_position } from './nature/plant_wind.ts'
import type { FloraMeshData } from './scenery_flora_mesh.ts'

/** Bounded authored dressing shares ordinary ground-scatter silhouettes and rooted wind. */
export const scenery_flora = (data: FloraMeshData | null) => {
  if (!data) return null
  const geometry = new BufferGeometry()
  Object.entries(data).forEach(([name, values]) => {
    const size = name === 'position' || name === 'color' ? 3 : name === 'uv' ? 2 : 1
    geometry.setAttribute(name, new BufferAttribute(values, size))
  })
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  if (geometry.boundingSphere) geometry.boundingSphere.radius += 3
  const surface = create_nature_texture()
  const material = new MeshStandardNodeMaterial({ vertexColors: true, side: DoubleSide, roughness: 0.8, map: surface })
  material.addEventListener('dispose', () => surface.dispose())
  material.positionNode = plant_wind_position()
  material.roughnessNode = mix(float(0.85), float(0.18), attribute('ice', 'float' as const))
  material.emissiveNode = attribute('color', 'vec3' as const)
    .mul(attribute('glow', 'float' as const))
    .mul(texture(surface).r)
  return new Mesh(geometry, material)
}
