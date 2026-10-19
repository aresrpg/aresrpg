// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Matrix4, Vector2, Vector3, Vector4, type Texture } from 'three'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import { screenCoordinate, texture, uniform, vec4, wgslFn } from 'three/tsl'

import { SPELL_SHADER } from './generated/claude_spell_wgsl.js'

export type SpellUniforms = Readonly<Record<string, number | readonly number[] | Float32Array>>
const create_uniform = (type: string) => {
  switch (type) {
    case 'vec2':
      return uniform(new Vector2())
    case 'vec3':
      return uniform(new Vector3())
    case 'vec4':
      return uniform(new Vector4())
    case 'mat4':
      return uniform(new Matrix4())
    case 'bool':
      return uniform(false, 'bool')
    case 'int':
      return uniform(0, 'int')
    default:
      return uniform(0)
  }
}

export const create_spell_effect_material = (maps: Readonly<Record<string, Texture>>) => {
  const values = SPELL_SHADER.inputs.map((input) => ({ input, node: create_uniform(input.type) }))
  const textures = Object.fromEntries(SPELL_SHADER.textures.map((name) => [name, texture(maps[name]!)]))
  const parameters: Record<string, Node> = Object.fromEntries(
    values.map(({ input, node }) => [`input_${input.name}`, node])
  )
  Object.entries(textures).forEach(([name, node]) => {
    parameters[`${name}_texture`] = node
    parameters[`${name}_sampler`] = node
  })
  const resolution = values.find(({ input }) => input.name === 'uRes')!.node as Node<'vec2'>
  parameters.pixel = vec4(screenCoordinate.x, resolution.y.sub(screenCoordinate.y), 0, 1)
  const material = new MeshBasicNodeMaterial({ toneMapped: false, depthTest: false, depthWrite: false })
  material.name = 'spell_effect'
  material.fragmentNode = wgslFn(SPELL_SHADER.code)(parameters)
  return {
    material,
    set_texture: (name: string, value: Texture): void => {
      textures[name]!.value = value
    },
    update: (frame: SpellUniforms): void => {
      values.forEach(({ input, node }) => {
        const value = frame[input.source]
        if (typeof node.value === 'number' || typeof node.value === 'boolean') {
          // WebGL coerced omitted integer selectors to zero; never retain another cast's selector.
          node.value = input.type === 'bool' ? Boolean(value) : Number(value ?? 0)
        } else if (value !== undefined) {
          node.value.fromArray(value as readonly number[], input.count > 1 ? input.index * 3 : 0)
        }
      })
    },
  }
}
