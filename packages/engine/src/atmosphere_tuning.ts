// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { atmosphere_profile, type AtmospherePreset } from './atmosphere_profile.ts'

export const ATMOSPHERE_CONTROLS = Object.freeze({
  density: { min: 0, max: 12, step: 0.1, group: 'haze' },
  max_opacity: { min: 0, max: 1, step: 0.01, group: 'haze' },
  near: { min: 0, max: 1000, step: 5, group: 'haze' },
  full: { min: 1, max: 2000, step: 5, group: 'haze' },
  tint: { min: 0, max: 1, step: 0.01, group: 'haze' },
  height_density: { min: 0, max: 0.003, step: 0.00005, group: 'ground' },
  height_max: { min: 0, max: 0.6, step: 0.01, group: 'ground' },
  height_falloff: { min: 1, max: 150, step: 1, group: 'ground' },
  horizon_cap: { min: 0.05, max: 2, step: 0.01, group: 'sky' },
  exposure: { min: 0.1, max: 8, step: 0.1, group: 'sky' },
  mie_scattering: { min: 0, max: 0.04, step: 0.0005, group: 'sky' },
  mie_g: { min: 0, max: 0.95, step: 0.01, group: 'sky' },
} as const)

export type AtmosphereTuning = Readonly<Record<keyof typeof ATMOSPHERE_CONTROLS, number>>

/** Preview overrides never mutate a preset. Reset and invalid inputs resolve at this boundary. */
export const resolve_atmosphere_tuning = (
  preset?: AtmospherePreset,
  overrides: Partial<AtmosphereTuning> | null = null
): AtmosphereTuning => {
  const defaults = atmosphere_profile(preset)
  const values = Object.fromEntries(
    Object.entries(ATMOSPHERE_CONTROLS).map(([name, range]) => {
      const key = name as keyof AtmosphereTuning
      const value = overrides?.[key] ?? defaults[key]
      return [key, Number.isFinite(value) ? Math.max(range.min, Math.min(range.max, value)) : defaults[key]]
    })
  ) as AtmosphereTuning
  return Object.freeze({ ...values, full: Math.max(values.near + 1, values.full) })
}
