// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// In-scene DOM labels over entities — three's CSS2DRenderer positions each element from the SAME
// camera matrices the frame renders with, in the same draw, so a label never lags or glitches
// the way an out-of-band overlay does. The element anchors at the entity's rendered crown
// (live_crown = animated bounds top), so off-pivot or mid-animation models still tag the head.

import type { Camera, Scene, Vector3 } from 'three'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'

type LabelAnchors = Readonly<{ live_crown: (id: string) => Vector3 | null }>

export const create_entity_label_layer = ({
  canvas,
  scene,
  camera,
  entities,
}: Readonly<{ canvas: HTMLCanvasElement; scene: Scene; camera: Camera; entities: LabelAnchors }>) => {
  const renderer = new CSS2DRenderer()
  const surface = renderer.domElement
  surface.style.position = 'absolute'
  surface.style.inset = '0'
  surface.style.pointerEvents = 'none'
  surface.style.overflow = 'hidden'
  canvas.parentElement?.appendChild(surface)
  const labels = new Map<string, CSS2DObject>()
  /** world-dressing tags (the star gate) — anchored at one fixed point, never an entity */
  const statics = new Map<string, CSS2DObject>()
  /** static tags track LIVE anchors — a fixed world point goes stale the moment the world
   *  itself moves under it (the flatten projection), so anchors are getters, re-read per frame */
  const static_anchors = new Map<string, () => Vector3 | null>()

  return Object.freeze({
    /** attach (or replace) the DOM element floating over an entity; null detaches */
    set: (id: string, element: HTMLElement | null): void => {
      const existing = labels.get(id)
      if (existing?.element === element) return
      if (existing) {
        scene.remove(existing)
        labels.delete(id)
      }
      if (!element) return
      const label = new CSS2DObject(element)
      labels.set(id, label)
      scene.add(label)
    },
    /** attach a DOM element at a world position that may MOVE (a getter re-read every frame —
     *  the flatten projection drags anchors around); null detaches */
    set_static: (id: string, element: HTMLElement | null, anchor: (() => Vector3 | null) | Vector3): void => {
      const existing = statics.get(id)
      const read_anchor = typeof anchor === 'function' ? anchor : () => anchor
      if (existing?.element === element) {
        const next = read_anchor()
        existing.visible = next !== null
        if (next) existing.position.copy(next)
        static_anchors.set(id, read_anchor)
        return
      }
      if (existing) {
        scene.remove(existing)
        statics.delete(id)
        static_anchors.delete(id)
      }
      if (!element) return
      const label = new CSS2DObject(element)
      const next = read_anchor()
      label.visible = next !== null
      if (next) label.position.copy(next)
      statics.set(id, label)
      static_anchors.set(id, read_anchor)
      scene.add(label)
    },
    resize: (width: number, height: number): void => renderer.setSize(width, height),
    render: (): void => {
      if (labels.size === 0 && statics.size === 0) return
      labels.forEach((label, id) => {
        const anchor = entities.live_crown(id)
        label.visible = anchor !== null
        if (anchor) label.position.copy(anchor)
      })
      statics.forEach((label, id) => {
        const anchor = static_anchors.get(id)?.()
        label.visible = anchor !== null && anchor !== undefined
        if (anchor) label.position.copy(anchor)
      })
      renderer.render(scene, camera)
    },
    dispose: (): void => {
      labels.forEach((label) => scene.remove(label))
      labels.clear()
      statics.forEach((label) => scene.remove(label))
      statics.clear()
      static_anchors.clear()
      surface.remove()
    },
  })
}
