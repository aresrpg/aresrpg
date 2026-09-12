// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { PerspectiveCamera, Scene, Vector3 } from 'three'

import { create_entity_label_layer } from '../src/entity_labels.ts'

export const probe_label_scene = (canvas: HTMLCanvasElement) => {
  const scene = new Scene()
  const camera = new PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.z = 10
  let world_updates = 0
  const update_world = scene.updateMatrixWorld.bind(scene)
  scene.updateMatrixWorld = (force) => {
    world_updates++
    update_world(force)
  }
  const context = { canvas, scene, camera, entities: { live_crown: () => new Vector3() } }
  const layer = create_entity_label_layer(context)
  const element = document.createElement('div')
  const anchor = new Vector3()
  layer.resize(640, 480)
  layer.set_static('resource', element, () => anchor)
  layer.render()
  const first = element.style.transform
  const attached = element.isConnected
  anchor.x = 2
  layer.render()
  const moved = element.style.transform !== first
  layer.dispose()
  return { world_updates, attached, moved, detached: !element.isConnected, world_children: scene.children.length }
}
