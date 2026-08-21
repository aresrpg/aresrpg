// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved.
// Planted fight swords — the join-window clock made physical. A sword slams in from the sky,
// then sinks linearly across the placement window until only the handle shows (the dapp's
// exact geometry, ported beat for beat minus the spin/jitter theatrics). Each marker carries
// an optional DOM element slot floating above it (the prompt/lock tag), positioned by the
// SAME CSS2D pass the entity labels use.

import { Object3D, type Scene } from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

import { load_gltf_source } from './gltf_loader.ts'
import type { FightSwordMarker } from './types.ts'

export type { FightSwordMarker }

const WINDOW_MS = 60_000
const SKY_HEIGHT = 10
const EXPOSED_HEIGHT = 2.5
const HANDLE_HEIGHT = 0.2
const INTRO_MS = 2_000
const GROW_MS = 500
const START_SCALE = 0.1
const PLANT_SCALE = 2.5

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))
const ease_out_quad = (t: number): number => t * (2 - t)
const ease_in_expo = (t: number): number => (t >= 1 ? 1 : 2 ** (10 * t - 10))

type Planted = Readonly<{ root: Object3D; marker: FightSwordMarker; label: CSS2DObject | null }>

export const create_fight_sword_layer = ({ scene, url }: Readonly<{ scene: Scene; url: string }>) => {
  let template: Object3D | null = null
  void load_gltf_source(url)
    .then((gltf) => {
      template = gltf.scene
      // late arrival: markers registered before the model may now materialize
      planted.forEach(({ root }) => rebuild(root))
    })
    .catch((error: unknown) => console.error('fight_sword.glb failed to load', error))

  const planted = new Map<string, Planted>()

  /** blade-down stance baked ONCE — no per-frame rotation theatrics */
  const rebuild = (root: Object3D): void => {
    if (!template) return
    const inner = template.clone(true)
    inner.rotation.x = Math.PI
    root.add(inner)
  }

  const set_markers = (markers: readonly FightSwordMarker[]): void => {
    const wanted = new Set(markers.map(({ id }) => id))
    for (const [id, entry] of planted)
      if (!wanted.has(id)) {
        scene.remove(entry.root)
        planted.delete(id)
      }
    for (const marker of markers) {
      if (planted.has(marker.id)) {
        // anchor facts may refresh (ground re-projection) — update in place
        const existing = planted.get(marker.id)!
        const updated = { ...existing, marker }
        planted.set(marker.id, updated)
        continue
      }
      const root = new Object3D()
      root.position.set(marker.x, marker.y, marker.z)
      rebuild(root)
      scene.add(root)
      planted.set(marker.id, { root, marker, label: null })
    }
  }

  /** attach (or detach) the DOM tag floating above a sword */
  const set_label = (id: string, element: HTMLElement | null): void => {
    const entry = planted.get(id)
    if (!entry) return
    if (entry.label) {
      entry.root.remove(entry.label)
      planted.set(id, { ...entry, label: null })
    }
    if (!element) return
    const label = new CSS2DObject(element)
    label.position.set(0, PLANT_SCALE * 2, 0) // clears the standing sword's crown
    entry.root.add(label)
    planted.set(id, { ...entry, label })
  }

  const tick = (now: number): void => {
    if (planted.size === 0) return
    planted.forEach(({ root, marker }) => {
      const elapsed = now - marker.placement_ms
      const track = EXPOSED_HEIGHT - clamp01(elapsed / WINDOW_MS) * (EXPOSED_HEIGHT - HANDLE_HEIGHT)
      const intro = clamp01(elapsed / INTRO_MS)
      const height = elapsed <= INTRO_MS ? SKY_HEIGHT + (track - SKY_HEIGHT) * ease_in_expo(intro) : track
      const grow = clamp01(elapsed / GROW_MS)
      const scale = START_SCALE + (PLANT_SCALE - START_SCALE) * ease_out_quad(grow)
      root.position.set(marker.x, marker.y + height, marker.z)
      root.scale.setScalar(Math.max(scale, 0.001))
      root.updateWorldMatrix(true, false)
    })
  }

  const dispose = (): void => {
    planted.forEach(({ root }) => scene.remove(root))
    planted.clear()
    template = null
  }

  return Object.freeze({ set_markers, set_label, tick, dispose })
}

export type FightSwordLayer = ReturnType<typeof create_fight_sword_layer>
