// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { AgXToneMapping, AmbientLight, DirectionalLight, OrthographicCamera, Scene, WebGLRenderer } from 'three'

import { create_resource_node_layer } from '../src/resource_nodes.ts'
import { gatherable_catalog } from '../../immutable/src/gathering.ts'

export const render_grain_gallery = (canvas: HTMLCanvasElement) => {
  const renderer = new WebGLRenderer({ canvas, antialias: true })
  renderer.setSize(1200, 990)
  renderer.setClearColor('#282333')
  renderer.toneMapping = AgXToneMapping
  renderer.setScissorTest(true)
  const camera = new OrthographicCamera(-1.3, 1.3, 1.43, -1.43, 0.1, 30)
  camera.position.set(3, 2.3, 4)
  camera.lookAt(0, 0.85, 0)
  const grains = gatherable_catalog.filter(({ job }) => job === 'FARMER')
  return grains.map((grain, index) => {
    const scene = new Scene()
    scene.add(new AmbientLight('#ffffff', 2))
    const sun = new DirectionalLight('#ffffff', 2.4)
    sun.position.set(-3, 5, 4)
    scene.add(sun)
    const layer = create_resource_node_layer({ scene })
    layer.set_markers([{ ...grain, id: grain.item_type, x: 0, y: 0, z: 0 }])
    layer.set_visible(true)
    const x = (index % 4) * 300
    const y = Math.floor(index / 4) * 330
    renderer.setViewport(x, 990 - y - 330, 300, 330)
    renderer.setScissor(x, 990 - y - 330, 300, 330)
    renderer.render(scene, camera)
    return { item_type: grain.item_type, x, y }
  })
}
