// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// One semantic roster. Consumers derive both the flat chain vocabulary and its encyclopedia groups.
export const job_groups = Object.freeze({
  gathering: Object.freeze(['FARMER', 'HERBALIST', 'MINER'] as const),
  weapon_craft: Object.freeze(['FORGER', 'CARVER'] as const),
  equipment_craft: Object.freeze(['TAILOR', 'JEWELER', 'TANNER'] as const),
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

/** THE CLASS SPELL LAW (owner 2026-08-24): every class has EXACTLY these twenty unlock
 * levels — three spells at level 1, then the Dofus 1.29 ladder. Which spell takes which
 * slot is design freedom; the shape is not. Enforced by the seed validator AND the admin
 * sync lane, because a class's kit on chain is "every spell object naming that class":
 * an extra spell can never be walked back (chain objects are forever). */
export const class_spell_unlocks = Object.freeze([
  1, 1, 1, 3, 6, 9, 13, 17, 21, 26, 31, 36, 42, 48, 54, 60, 70, 80, 90, 100,
] as const)

/** Plain-English violations of the class spell law — empty means the shape holds. */
export const class_spell_shape_errors = (
  spells: readonly Readonly<{ name: string; classe: string; unlock_level: number }>[]
): readonly string[] => {
  const errors: string[] = []
  const ladder = [...class_spell_unlocks].sort((a, b) => a - b)
  for (const classe of class_names) {
    const rows = spells.filter((spell) => spell.classe === classe)
    if (rows.length !== class_spell_unlocks.length) {
      errors.push(`${classe} has ${rows.length} spells; the law is exactly ${class_spell_unlocks.length}`)
      continue
    }
    const levels = rows.map(({ unlock_level }) => unlock_level).sort((a, b) => a - b)
    if (levels.some((level, index) => level !== ladder[index])) {
      const counts = new Map<number, number>()
      for (const level of levels) counts.set(level, (counts.get(level) ?? 0) + 1)
      const expected = new Map<number, number>()
      for (const level of ladder) expected.set(level, (expected.get(level) ?? 0) + 1)
      const extra = [...counts].filter(([level, n]) => n > (expected.get(level) ?? 0)).map(([level]) => level)
      const missing = [...expected].filter(([level, n]) => n > (counts.get(level) ?? 0)).map(([level]) => level)
      errors.push(
        `${classe} breaks the unlock ladder — too many at level ${extra.join(', ')}; none at level ${missing.join(', ')}`
      )
    }
  }
  return Object.freeze(errors)
}
