// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { stat_art } from '@aresrpg/ui/art'

import crit_icon from './assets/statistics/crit.png'
import range_icon from './assets/statistics/range.png'
import raw_damage_icon from './assets/statistics/raw_damage.png'

export const element_colors: Readonly<Record<string, string>> = Object.freeze({
  earth: '#8b6914',
  fire: '#ff4500',
  water: '#1e90ff',
  air: '#01be44',
})

export const stat_colors: Readonly<Record<string, string>> = Object.freeze({
  vitality: '#ff66b2',
  wisdom: '#b366ff',
  strength: element_colors.earth!,
  intelligence: element_colors.fire!,
  chance: element_colors.water!,
  agility: element_colors.air!,
  movement: '#00cccc',
  action: '#00cccc',
  critical: '#ffee00',
  raw_damage: '#ffffff',
  earth_resistance: element_colors.earth!,
  fire_resistance: element_colors.fire!,
  water_resistance: element_colors.water!,
  air_resistance: element_colors.air!,
})

/** Every stat/channel with authored icon art — keyed by BOTH the stat vocabulary and the
 *  fight-channel vocabulary (ap/mp/hp) so every effect surface resolves the same asset. */
export const stat_identities: Readonly<Record<string, Readonly<{ icon: string; tint: string }>>> = Object.freeze({
  vitality: Object.freeze({ icon: stat_art.vitality, tint: '#ef5350' }),
  wisdom: Object.freeze({ icon: stat_art.wisdom, tint: '#b07cff' }),
  strength: Object.freeze({ icon: stat_art.strength, tint: '#c9905a' }),
  intelligence: Object.freeze({ icon: stat_art.intelligence, tint: element_colors.fire! }),
  chance: Object.freeze({ icon: stat_art.chance, tint: element_colors.water! }),
  agility: Object.freeze({ icon: stat_art.agility, tint: element_colors.air! }),
  range: Object.freeze({ icon: range_icon, tint: '#9d7bd8' }),
  critical: Object.freeze({ icon: crit_icon, tint: '#ffb454' }),
  raw_damage: Object.freeze({ icon: raw_damage_icon, tint: '#ef5350' }),
  action: Object.freeze({ icon: stat_art.action, tint: '#efbd45' }),
  ap: Object.freeze({ icon: stat_art.action, tint: '#efbd45' }),
  movement: Object.freeze({ icon: stat_art.movement, tint: '#4a9eff' }),
  mp: Object.freeze({ icon: stat_art.movement, tint: '#4a9eff' }),
  hp: Object.freeze({ icon: stat_art.health, tint: '#ff6b86' }),
  health: Object.freeze({ icon: stat_art.health, tint: '#ff6b86' }),
})

export const item_category_colors: Readonly<Record<string, string>> = Object.freeze({
  hat: '#4a9eff',
  cloak: '#4a9eff',
  belt: '#4a9eff',
  boots: '#4a9eff',
  daggers: '#c8963c',
  bow: '#c8963c',
  axe: '#c8963c',
  sword: '#c8963c',
  spear: '#c8963c',
  amulet: '#c084fc',
  ring: '#c084fc',
  title: '#c084fc',
  pet: '#4ade80',
  relic: '#fbbf24',
  tool_herbalist: '#22c55e',
  tool_farmer: '#22c55e',
  tool_miner: '#22c55e',
  consumable: '#6b7280',
  resource: '#6b7280',
  pet_food: '#ef8bbd',
})
