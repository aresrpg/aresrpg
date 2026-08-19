// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The night lantern — a warm point light riding the followed character so the player keeps
// local visibility after sundown. Pure dusk ramp + a slow two-sine flicker; no geometry, no
// shadow casting (one more shadow map for a moving light is not worth its cost).

import { PointLight, type Scene } from 'three'

/** Fully lit below this sun elevation, off above the upper bound — the dusk crossfade. */
const NIGHT_ELEVATION = -0.12
const DAY_ELEVATION = 0.04
const BASE_INTENSITY = 9
const RANGE = 48
/** The halo centers on the ground under the character — just high enough to not sink into it. */
const HEIGHT_ABOVE_FOCUS = 0.5

/** 0 in daylight, 1 at night, smooth through dusk — pure so the ramp is testable. */
export const lantern_intensity = (sun_elevation: number): number => {
  const amount = (DAY_ELEVATION - sun_elevation) / (DAY_ELEVATION - NIGHT_ELEVATION)
  const clamped = Math.max(0, Math.min(1, amount))
  return clamped * clamped * (3 - 2 * clamped)
}

/** Slow breathing flicker around 1 — organic, never strobing. */
export const lantern_flicker = (now_ms: number): number =>
  1 + Math.sin(now_ms * 0.0021) * 0.06 + Math.sin(now_ms * 0.0053 + 1.7) * 0.04

export type Lantern = Readonly<{
  set_focus: (x: number, y: number, z: number) => void
  /** Off while nobody is followed (spectate, fights) — a lantern with no carrier is a ghost. */
  set_active: (active: boolean) => void
  set_sun_elevation: (elevation: number) => void
  tick: (now_ms: number) => void
  dispose: () => void
}>

export const create_lantern = ({ scene }: Readonly<{ scene: Scene }>): Lantern => {
  const light = new PointLight(0xffc37a, 0, RANGE, 1.4)
  light.castShadow = false
  scene.add(light)
  let night_amount = 0
  let carried = false
  return Object.freeze({
    set_focus: (x: number, y: number, z: number) => {
      light.position.set(x, y + HEIGHT_ABOVE_FOCUS, z)
    },
    set_active: (active: boolean) => {
      carried = active
    },
    set_sun_elevation: (elevation: number) => {
      night_amount = lantern_intensity(elevation)
    },
    tick: (now_ms: number) => {
      const intensity = carried ? night_amount * BASE_INTENSITY : 0
      light.intensity = intensity > 0 ? intensity * lantern_flicker(now_ms) : 0
      light.visible = intensity > 0
    },
    dispose: () => {
      scene.remove(light)
      light.dispose()
    },
  })
}
