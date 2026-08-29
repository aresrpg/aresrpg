// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved.
// Planted fight swords — the join-window clock made physical. A sword slams in from the sky,
// then sinks linearly across the placement window until only the handle shows (the dapp's
// exact geometry, including its grow, spin, wobble and one impact edge). Each marker carries
// an optional DOM element slot floating above it (the prompt/lock tag), positioned by the
// SAME CSS2D pass the entity labels use.

import { Box3, Object3D, type Scene } from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

import { project_height } from './flatten.ts'
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
const LABEL_WORLD_HEIGHT = 3

export const FIGHT_SWORD_TILT = Object.freeze({ x: 0.035, z: -0.09 })
export const fight_sword_plant_height = (minimum_y: number, maximum_y: number): number => -(minimum_y + maximum_y) / 2
export const fight_sword_label_offset = (scale: number): number => LABEL_WORLD_HEIGHT / Math.max(scale, 0.001)
export const fight_sword_ground_height = (source_y: number, flatten_amount: number): number =>
  project_height(source_y, flatten_amount)

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))
const ease_out_quad = (t: number): number => t * (2 - t)
const ease_in_expo = (t: number): number => (t >= 1 ? 1 : 2 ** (10 * t - 10))
const ease_out_elastic = (t: number): number =>
  t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * 2 * Math.PI) / 3) + 1

export const fight_swords_visible = (board_active: boolean): boolean => !board_active

export const fight_sword_frame = (
  placement_ms: number,
  spawned_ms: number,
  now_ms: number,
  terminal_height = HANDLE_HEIGHT
): Readonly<{ height: number; scale: number; yaw: number; impacted: boolean }> => {
  const elapsed = Math.max(0, now_ms - spawned_ms)
  const placement_age = Math.max(0, spawned_ms - placement_ms)
  const time_left = Math.max(0, WINDOW_MS - placement_age)
  const target = EXPOSED_HEIGHT - clamp01(placement_age / WINDOW_MS) * (EXPOSED_HEIGHT - terminal_height)
  const grow = clamp01(elapsed / GROW_MS)
  const scale = START_SCALE + (PLANT_SCALE - START_SCALE) * ease_out_quad(grow)
  if (elapsed <= GROW_MS) return Object.freeze({ height: SKY_HEIGHT, scale, yaw: 0, impacted: false })
  const fall = clamp01((elapsed - GROW_MS) / (INTRO_MS - GROW_MS))
  if (elapsed < INTRO_MS)
    return Object.freeze({
      height: SKY_HEIGHT + (target - SKY_HEIGHT) * ease_in_expo(fall),
      scale,
      yaw: ease_out_elastic(fall) * Math.PI * 2,
      impacted: false,
    })
  const sink = clamp01((elapsed - INTRO_MS) / Math.max(1, time_left))
  return Object.freeze({
    height: target + (terminal_height - target) * sink,
    scale,
    yaw: Math.PI * 2,
    impacted: true,
  })
}

type Planted = Readonly<{
  root: Object3D
  marker: FightSwordMarker
  label: CSS2DObject | null
  spawned_ms: number
  impacted: boolean
}>

export const create_fight_sword_layer = ({
  scene,
  url,
  impact_sound_url,
  impact,
}: Readonly<{
  scene: Scene
  url: string
  impact_sound_url: string
  impact?: (position: readonly [number, number, number]) => void
}>) => {
  const impact_audio = typeof Audio === 'undefined' ? null : new Audio(impact_sound_url)
  if (impact_audio) impact_audio.preload = 'auto'
  let template: Object3D | null = null
  let plant_height = HANDLE_HEIGHT
  void load_gltf_source(url)
    .then((gltf) => {
      template = gltf.scene
      const measuring_root = new Object3D()
      const measuring_inner = template.clone(true)
      measuring_inner.rotation.x = Math.PI
      measuring_root.add(measuring_inner)
      measuring_root.scale.setScalar(PLANT_SCALE)
      measuring_root.updateWorldMatrix(true, true)
      const bounds = new Box3().setFromObject(measuring_root)
      if (!bounds.isEmpty()) plant_height = fight_sword_plant_height(bounds.min.y, bounds.max.y)
      // late arrival: markers registered before the model may now materialize
      planted.forEach(({ root }) => rebuild(root))
    })
    .catch((error: unknown) => console.error('fight_sword.glb failed to load', error))

  const planted = new Map<string, Planted>()
  let visible = true
  let flatten_amount = 0

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
      root.position.set(marker.x, fight_sword_ground_height(marker.y, flatten_amount), marker.z)
      root.visible = visible
      rebuild(root)
      scene.add(root)
      planted.set(marker.id, { root, marker, label: null, spawned_ms: Date.now(), impacted: !visible })
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
    label.position.set(0, fight_sword_label_offset(entry.root.scale.y), 0)
    entry.root.add(label)
    planted.set(id, { ...entry, label })
  }

  const tick = (_frame_now: number): void => {
    if (planted.size === 0) return
    const now_ms = Date.now()
    planted.forEach((entry, id) => {
      const { root, marker } = entry
      const { height, scale, yaw, impacted } = fight_sword_frame(
        marker.placement_ms,
        entry.spawned_ms,
        now_ms,
        plant_height
      )
      const ground_y = fight_sword_ground_height(marker.y, flatten_amount)
      root.position.set(marker.x, ground_y + height, marker.z)
      root.scale.setScalar(Math.max(scale, 0.001))
      entry.label?.position.set(0, fight_sword_label_offset(scale), 0)
      root.rotation.y = yaw
      if (!impacted) {
        root.rotation.x = Math.random() * 0.02 - 0.01
        root.rotation.z += Math.random() * 0.02 - 0.01
      } else {
        root.rotation.x = FIGHT_SWORD_TILT.x
        root.rotation.z = FIGHT_SWORD_TILT.z
      }
      if (impacted && !entry.impacted) {
        impact?.([marker.x, ground_y, marker.z])
        if (impact_audio) {
          impact_audio.currentTime = 0
          void impact_audio.play().catch((error: unknown) => console.warn('Fight sword impact sound failed.', error))
        }
        planted.set(id, Object.freeze({ ...entry, impacted: true }))
      }
      root.updateWorldMatrix(true, false)
    })
  }

  const dispose = (): void => {
    planted.forEach(({ root }) => scene.remove(root))
    planted.clear()
    template = null
  }

  return Object.freeze({
    set_markers,
    set_label,
    set_flatten: (amount: number) => {
      flatten_amount = amount
    },
    set_visible: (next: boolean) => {
      visible = next
      planted.forEach((entry, id) => {
        entry.root.visible = next
        if (!next && !entry.impacted) planted.set(id, Object.freeze({ ...entry, impacted: true }))
      })
    },
    tick,
    dispose,
  })
}

export type FightSwordLayer = ReturnType<typeof create_fight_sword_layer>
