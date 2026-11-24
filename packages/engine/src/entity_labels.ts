// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// In-scene DOM labels. three's CSS2DRenderer positions each element from the same camera matrices the
// frame renders with, so a label never lags the way an out-of-band overlay does. Each label reads its
// anchor every frame; a null anchor hides it.

import { Scene, type Camera, type Vector3 } from 'three'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'

type Label = Readonly<{ object: CSS2DObject; anchor: () => Vector3 | null }>

export const create_entity_label_layer = ({
  canvas,
  camera,
}: Readonly<{ canvas: HTMLCanvasElement; camera: Camera }>) => {
  // CSS2D traverses its input tree, so labels live in their own root instead of the game scene.
  const scene = new Scene()
  const renderer = new CSS2DRenderer()
  const surface = renderer.domElement
  surface.style.position = 'absolute'
  surface.style.inset = '0'
  surface.style.pointerEvents = 'none'
  surface.style.overflow = 'hidden'
  canvas.parentElement?.appendChild(surface)
  const labels = new Map<string, Label>()

  const place = ({ object, anchor }: Label): void => {
    const position = anchor()
    object.visible = position !== null
    if (position) object.position.copy(position)
  }

  return Object.freeze({
    /** Attach or replace the element for `id`; a null element detaches it. */
    set: (id: string, element: HTMLElement | null, anchor: () => Vector3 | null): void => {
      const existing = labels.get(id)
      if (existing && existing.object.element !== element) {
        scene.remove(existing.object)
        labels.delete(id)
      }
      if (!element) return
      const label = {
        object: existing?.object.element === element ? existing.object : new CSS2DObject(element),
        anchor,
      }
      labels.set(id, label)
      scene.add(label.object)
      place(label)
    },
    resize: (width: number, height: number): void => renderer.setSize(width, height),
    render: (): void => {
      if (labels.size === 0) return
      labels.forEach(place)
      renderer.render(scene, camera)
    },
    dispose: (): void => {
      labels.forEach(({ object }) => scene.remove(object))
      labels.clear()
      surface.remove()
    },
  })
}
