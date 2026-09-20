// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { MeshBasicMaterial, SRGBColorSpace, type Texture } from 'three'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import { attribute, float, texture, uv, vec2, vec4, workingToColorSpace } from 'three/tsl'

export const create_caption_material = (atlas: Texture, webgpu: boolean) => {
  const parameters = { transparent: true, depthTest: true, depthWrite: true, toneMapped: false, alphaTest: 0.02 }
  if (webgpu) {
    const material = new MeshBasicNodeMaterial(parameters)
    const rect = vec4(attribute<'vec4'>('caption_uv', 'vec4'))
    const tint = vec4(attribute<'vec4'>('caption_tint', 'vec4'))
    const sample = texture(atlas, rect.xy.add(vec2(uv().x, float(1).sub(uv().y)).mul(rect.zw)))
    material.colorNode = workingToColorSpace(sample.rgb.mul(tint.rgb), SRGBColorSpace) as unknown as Node<'vec3'>
    material.opacityNode = sample.a.mul(tint.a)
    return material
  }
  const material = new MeshBasicMaterial({ ...parameters, map: atlas })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 caption_uv;\nattribute vec4 caption_tint;\nvarying vec4 v_caption_tint;'
      )
      .replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\nvMapUv = caption_uv.xy + vec2(uv.x, 1.0 - uv.y) * caption_uv.zw;\nv_caption_tint = caption_tint;'
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 v_caption_tint;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor *= v_caption_tint;')
      .replace('#include <colorspace_fragment>', 'gl_FragColor = sRGBTransferOETF(gl_FragColor);')
  }
  material.customProgramCacheKey = () => 'instanced-captions-v1'
  return material
}
