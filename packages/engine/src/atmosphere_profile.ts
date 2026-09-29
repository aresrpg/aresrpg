// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { HEIGHT_FOG } from './height_fog.ts'
import { EARTH_ATMOSPHERE } from './sky/hillaire/atmosphere_params.ts'

export type AtmospherePreset = 'cinematic' | 'clear' | 'winter'

const SKY_DEFAULTS = Object.freeze({
  height_falloff: HEIGHT_FOG.falloff_height,
  horizon_cap: 0.25,
  exposure: EARTH_ATMOSPHERE.exposure,
  mie_scattering: EARTH_ATMOSPHERE.mie_scattering,
  mie_g: EARTH_ATMOSPHERE.mie_g,
})

const ATMOSPHERES = Object.freeze({
  cinematic: {
    ...SKY_DEFAULTS,
    ambient_gain: 1,
    ambient_tint: [1, 1, 1],
    tint: 1,
    density: 8,
    max_opacity: 0.85,
    near: 40,
    full: 150,
    height_density: HEIGHT_FOG.density,
    height_max: HEIGHT_FOG.max_opacity,
    distance_near_scale: 1,
    distance_far_scale: 1,
  },
  clear: {
    ...SKY_DEFAULTS,
    ambient_gain: 1,
    ambient_tint: [1, 1, 1],
    tint: 0,
    density: 9.3,
    max_opacity: 0.75,
    near: 0,
    full: 251,
    height_density: 0.0006,
    height_max: 0.14,
    horizon_cap: 1.02,
    exposure: 5.9,
    mie_scattering: 0.0215,
    distance_near_scale: 1,
    distance_far_scale: 1,
  },
  winter: {
    ...SKY_DEFAULTS,
    ambient_gain: 1.5,
    ambient_tint: [0.8, 1.03, 1.4],
    tint: 0.5,
    density: 1.1,
    max_opacity: 0.4,
    near: 80,
    full: 360,
    height_density: 0.00025,
    height_max: 0.1,
    distance_near_scale: 0.3,
    distance_far_scale: 0.6,
  },
})

export const atmosphere_profile = (preset: AtmospherePreset = 'cinematic') => ATMOSPHERES[preset]
export const validate_atmosphere = (value: unknown): readonly string[] =>
  [undefined, 'cinematic', 'clear', 'winter'].some((preset) => preset === value)
    ? []
    : ['atmosphere must be cinematic, clear or winter']
