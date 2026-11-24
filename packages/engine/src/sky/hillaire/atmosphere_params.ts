// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Hillaire EGSR 2020 atmosphere parameters (sebh.github.io/publications/egsr2020.pdf, Table 1).
// Lengths are kilometres and coefficients are per kilometre: a 6360 km planet radius in metres would
// sit at the float32 precision floor and band the ray march.

import type { Rgb } from '../shared.ts'

export type AtmosphereParams = Readonly<{
  ground_radius_km: number
  top_radius_km: number
  rayleigh_scattering: Rgb
  rayleigh_density_h: number
  mie_scattering: number
  mie_absorption: number
  mie_g: number
  mie_density_h: number
  ozone_absorption: Rgb
  ozone_center_km: number
  ozone_width_km: number
  ground_albedo: Rgb
  sun_illuminance: Rgb
  /** Physical luminance to scene radiance. */
  exposure: number
  /** World units per metre. */
  length_unit_m: number
  aerial_range_km: number
  /** Froxel slice distribution exponent; 2 packs slices near the camera. */
  aerial_depth_power: number
}>

export const EARTH_ATMOSPHERE: AtmosphereParams = Object.freeze({
  ground_radius_km: 6360.0,
  top_radius_km: 6460.0,
  rayleigh_scattering: [5.802e-3, 13.558e-3, 33.1e-3] as const,
  rayleigh_density_h: 8.0,
  mie_scattering: 3.996e-3,
  mie_absorption: 4.4e-3,
  mie_g: 0.8,
  mie_density_h: 1.2,
  ozone_absorption: [0.65e-3, 1.881e-3, 0.085e-3] as const,
  ozone_center_km: 25.0,
  ozone_width_km: 15.0,
  ground_albedo: [0.3, 0.3, 0.3] as const,
  sun_illuminance: [1.0, 1.0, 1.0] as const,
  // At 3.0 the noon zenith matches the analytic sky's day zenith.
  exposure: 3.0,
  length_unit_m: 1.0,
  aerial_range_km: 32.0,
  aerial_depth_power: 2.0,
})

export type SkyTier = Readonly<{
  transmittance_w: number
  transmittance_h: number
  transmittance_steps: number
  multiscatter_res: number
  multiscatter_steps: number
  /** Square root of the sphere direction count. */
  multiscatter_sqrt_samples: number
  skyview_w: number
  skyview_h: number
  skyview_steps: number
  aerial_res: number
  aerial_slices: number
  aerial_steps: number
}>

// High uses the paper's resolutions. Medium is the paper's mobile configuration, which it reports as
// visually identical. Low quality never builds this sky.
export const SKY_TIERS: Readonly<Record<'medium' | 'high', SkyTier>> = {
  high: {
    transmittance_w: 256,
    transmittance_h: 64,
    transmittance_steps: 40,
    multiscatter_res: 32,
    multiscatter_steps: 20,
    multiscatter_sqrt_samples: 8,
    skyview_w: 200,
    skyview_h: 100,
    skyview_steps: 30,
    aerial_res: 32,
    aerial_slices: 32,
    aerial_steps: 30,
  },
  medium: {
    transmittance_w: 256,
    transmittance_h: 64,
    transmittance_steps: 40,
    multiscatter_res: 32,
    multiscatter_steps: 20,
    multiscatter_sqrt_samples: 4,
    skyview_w: 96,
    skyview_h: 50,
    skyview_steps: 8,
    aerial_res: 32,
    aerial_slices: 16,
    aerial_steps: 16,
  },
}
