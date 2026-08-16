// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// One semantic roster. Consumers derive both the flat chain vocabulary and its encyclopedia groups.
export const job_groups = Object.freeze({
  gathering: Object.freeze(['FARMER', 'HERBALIST', 'MINER'] as const),
  weapon_craft: Object.freeze(['SWORD_SMITH', 'AXE_SMITH', 'BLUNT_SMITH', 'STAFF_CARVER', 'BOWYER'] as const),
  equipment_craft: Object.freeze(['ARMORSMITH', 'TAILOR', 'TANNER', 'JEWELER'] as const),
  consumable_craft: Object.freeze(['HANDYMAN', 'ALCHEMIST', 'BAKER'] as const),
})

export type JobKind = keyof typeof job_groups
export const job_slugs = Object.freeze(Object.values(job_groups).flat())

export type JobSlug = (typeof job_slugs)[number]

export const job_kind_of = (job: JobSlug): JobKind =>
  (Object.entries(job_groups) as readonly (readonly [JobKind, readonly JobSlug[]])[]).find(([, jobs]) =>
    jobs.includes(job)
  )![0]

// The allocatable characteristics — the raisable prefix of the stat order, mirroring
// character.move:223-233 exactly.
export const characteristic_names = Object.freeze([
  'vitality',
  'wisdom',
  'strength',
  'intelligence',
  'chance',
  'agility',
] as const)

export type CharacteristicName = (typeof characteristic_names)[number]

// Declaration order is chain-significant. Mirrors move-math/sources/item_stats.move:10-26;
// seed validation and PTB composition import this order instead of copying it.
export const stat_names = Object.freeze([
  ...characteristic_names,
  'range',
  'movement',
  'action',
  'critical',
  'raw_damage',
  'earth_resistance',
  'fire_resistance',
  'water_resistance',
  'air_resistance',
] as const)

export type StatName = (typeof stat_names)[number]

// Mirrors the accepted class vocabulary in character.move:246-260 exactly.
export const class_names = Object.freeze([
  'shugo',
  'tomoda',
  'rojin',
  'yajin',
  'tokei',
  'asobi',
  'iyashi',
  'senshi',
  'yogan',
  'mori',
  'ikari',
  'shusen',
] as const)

export type ClassName = (typeof class_names)[number]

export const is_job_slug = (slug: string): boolean => (job_slugs as readonly string[]).includes(slug)

export const is_stat_name = (name: string): name is StatName => (stat_names as readonly string[]).includes(name)

export const is_class_name = (name: string): boolean => (class_names as readonly string[]).includes(name)
