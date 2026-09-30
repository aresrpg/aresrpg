// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { SRGBColorSpace, type Texture } from 'three'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import { attribute, float, texture, uv, vec2, vec4, workingToColorSpace } from 'three/tsl'

export const create_caption_material = (atlas: Texture) => {
  const parameters = { transparent: true, depthTest: true, depthWrite: true, toneMapped: false, alphaTest: 0.02 }
  const material = new MeshBasicNodeMaterial(parameters)
  const rect = vec4(attribute<'vec4'>('caption_uv', 'vec4'))
  const tint = vec4(attribute<'vec4'>('caption_tint', 'vec4'))
  const sample = texture(atlas, rect.xy.add(vec2(uv().x, float(1).sub(uv().y)).mul(rect.zw)))
  material.colorNode = workingToColorSpace(sample.rgb.mul(tint.rgb), SRGBColorSpace) as unknown as Node<'vec3'>
  material.opacityNode = sample.a.mul(tint.a)
  return material
}
