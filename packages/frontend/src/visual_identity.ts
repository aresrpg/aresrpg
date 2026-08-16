// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import agility_icon from './assets/statistics/agility.png'
import chance_icon from './assets/statistics/chance.png'
import intelligence_icon from './assets/statistics/intelligence.png'
import strength_icon from './assets/statistics/strength.png'
import vitality_icon from './assets/statistics/vitality.png'
import wisdom_icon from './assets/statistics/wisdom.png'

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

export const stat_identities: Readonly<Record<string, Readonly<{ icon: string; tint: string }>>> = Object.freeze({
  vitality: Object.freeze({ icon: vitality_icon, tint: '#ef5350' }),
  wisdom: Object.freeze({ icon: wisdom_icon, tint: '#b07cff' }),
  strength: Object.freeze({ icon: strength_icon, tint: '#c9905a' }),
  intelligence: Object.freeze({ icon: intelligence_icon, tint: '#5db4ff' }),
  chance: Object.freeze({ icon: chance_icon, tint: '#4fd6a0' }),
  agility: Object.freeze({ icon: agility_icon, tint: '#ffce85' }),
})

export const item_category_colors: Readonly<Record<string, string>> = Object.freeze({
  helmet: '#4a9eff',
  chestplate: '#4a9eff',
  belt: '#4a9eff',
  gauntlets: '#4a9eff',
  pants: '#4a9eff',
  boots: '#4a9eff',
  longsword: '#c8963c',
  daggers: '#c8963c',
  bow: '#c8963c',
  staff: '#c8963c',
  axe: '#c8963c',
  spellbook: '#c8963c',
  battleaxe: '#c8963c',
  sword: '#c8963c',
  club: '#c8963c',
  mace: '#c8963c',
  spear: '#c8963c',
  amulet: '#c084fc',
  ring: '#c084fc',
  pet: '#4ade80',
  relic: '#fbbf24',
  tool_herbalist: '#22c55e',
  tool_farmer: '#22c55e',
  tool_miner: '#22c55e',
  consumable: '#6b7280',
  resource: '#6b7280',
})
