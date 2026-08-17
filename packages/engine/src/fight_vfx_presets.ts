// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The irreducible fight-VFX art table: legacy timing, palette, footprint, and anchor facts.

export type FightVfxProfile = Readonly<{
  color: number
  accent: number
  windup_size: number
  windup_ground: boolean
  projectile_size: number
  impact_size: number
  impact_big_size: number | null
  impact_ground: boolean
  remnant_size: number
  remnant_seconds: number
}>

export const FIGHT_VFX_BEAT = Object.freeze({
  windup_seconds: 0.45,
  travel_seconds: 0.55,
  impact_seconds: 0.5,
  sky_height: 10,
  ground_drop: 1.2,
})

export const FIGHT_VFX_PROFILES: Readonly<Record<string, FightVfxProfile>> = Object.freeze({
  fire: Object.freeze({
    color: 0xff6a3d,
    accent: 0xffd070,
    windup_size: 3.4,
    windup_ground: false,
    projectile_size: 1.9,
    impact_size: 4.6,
    impact_big_size: 6,
    impact_ground: true,
    remnant_size: 2.6,
    remnant_seconds: 2.4,
  }),
  water: Object.freeze({
    color: 0x55d8ff,
    accent: 0xd8f7ff,
    windup_size: 2.6,
    windup_ground: true,
    projectile_size: 1.5,
    impact_size: 4,
    impact_big_size: 5.5,
    impact_ground: true,
    remnant_size: 2.8,
    remnant_seconds: 2.6,
  }),
  air: Object.freeze({
    color: 0x8fd8ff,
    accent: 0xffffff,
    windup_size: 2.6,
    windup_ground: false,
    projectile_size: 1.7,
    impact_size: 4,
    impact_big_size: 5.5,
    impact_ground: true,
    remnant_size: 2.8,
    remnant_seconds: 2.6,
  }),
  neutral: Object.freeze({
    color: 0xa762ff,
    accent: 0xf1d8ff,
    windup_size: 2.4,
    windup_ground: true,
    projectile_size: 1.4,
    impact_size: 3.8,
    impact_big_size: null,
    impact_ground: false,
    remnant_size: 2.6,
    remnant_seconds: 2.2,
  }),
  heal: Object.freeze({
    color: 0xffd070,
    accent: 0xfff7d6,
    windup_size: 2.2,
    windup_ground: true,
    projectile_size: 1.4,
    impact_size: 3.6,
    impact_big_size: 4.8,
    impact_ground: true,
    remnant_size: 2.6,
    remnant_seconds: 2,
  }),
})

export const FIGHT_VFX_BURSTS = Object.freeze({
  earth: Object.freeze({ color: 0xc2a05e, accent: 0xffdf8a, size: 4, delay_seconds: 0.55 }),
  weapon: Object.freeze({ color: 0xdc6058, accent: 0xffd0bd, size: 3.2, delay_seconds: 0.55 }),
  death: Object.freeze({ color: 0x5fe39a, accent: 0xd8ffe9, size: 3.4, delay_seconds: 0 }),
})

export const fight_vfx_magnitude = (amount: number, target_max_hp: number | null): number => {
  const reference = target_max_hp === null ? 40 : Math.max(1, target_max_hp * 0.07)
  return Math.min(1.6, Math.max(0.8, 0.85 + 0.5 * Math.log10(1 + Math.max(0, amount) / reference)))
}
