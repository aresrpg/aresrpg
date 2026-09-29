// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { CanvasTexture, Group, LinearFilter, Mesh, PlaneGeometry, SRGBColorSpace, type Scene } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'

import type { WorldPanel } from './types.ts'

/** Fixed planes in the ordinary world scene: depth-tested, world-sized, never camera-facing. */
export const create_world_panels = (scene: Scene) => {
  const group = new Group()
  scene.add(group)
  const entries = new Map<string, ReturnType<typeof create_panel>>()
  const remove = (id: string) => {
    const entry = entries.get(id)
    if (!entry) return
    group.remove(entry.mesh)
    entry.mesh.geometry.dispose()
    entry.mesh.material.dispose()
    entry.texture.dispose()
    entries.delete(id)
  }
  return {
    set: (id: string, panel: WorldPanel | null) => {
      if (!panel) return remove(id)
      const previous = entries.get(id)
      if (previous && previous.canvas !== panel.canvas) remove(id)
      const entry = entries.get(id) ?? create_panel(panel)
      entries.set(id, entry)
      group.add(entry.mesh)
      entry.mesh.position.set(...panel.position)
      entry.mesh.rotation.y = panel.yaw
      entry.mesh.scale.set(panel.size[0], panel.size[1], 1)
      entry.mesh.visible = panel.visible
      entry.texture.needsUpdate = true
    },
    set_visible: (visible: boolean) => {
      group.visible = visible
    },
    dispose: () => {
      for (const id of entries.keys()) remove(id)
      scene.remove(group)
    },
  }
}

const create_panel = (panel: WorldPanel) => {
  const texture = new CanvasTexture(panel.canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  const material = new MeshBasicNodeMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    opacity: 0.88,
  })
  const mesh = new Mesh(new PlaneGeometry(1, 1), material)
  return { canvas: panel.canvas, texture, mesh }
}
