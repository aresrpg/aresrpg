// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Node } from 'three/webgpu'
import type { viewportTexture } from 'three/tsl'

/** Private copies per render target: reflection cameras must never overwrite the main view.
 * Releasing a target (quality switch) also releases its copy; world disposal releases the rest. */
export const create_viewport_capture = (node: ReturnType<typeof viewportTexture>) => {
  const copies = new Set([node.value])
  const get_texture = node.getTextureForReference.bind(node)
  node.getTextureForReference = (target = null) => {
    const copy = get_texture(target)
    if (!copies.has(copy)) {
      copies.add(copy)
      const owner: { addEventListener: (type: 'dispose', listener: () => void) => void } | null = target
      owner?.addEventListener('dispose', () => {
        copy.dispose()
        copies.delete(copy)
      })
    }
    return copy
  }
  return {
    sample: (uv: Node<'vec2'>) => {
      const sampled = node.sample(uv)
      // TextureNode.sample clones the node. Keep those clones on this capture's lifecycle.
      sampled.getTextureForReference = node.getTextureForReference
      return sampled
    },
    dispose: () => {
      copies.forEach((copy) => copy.dispose())
      copies.clear()
    },
  }
}
