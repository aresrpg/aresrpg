// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { item_stat_center, stat_names, type StatName } from '@aresrpg/immutable'
import { EFFECT_KINDS, TARGET_FILTERS } from '@aresrpg/fight/move_contract'

import adventure from '../../../../seed/content/adventure.json'
import { encyclopedia_catalog, titleize, type SeedItem, type SeedMob, type SpellLevel } from '../content/catalog.ts'

// Deliberately simulated content: never published, indexed, or merged into the live catalogue.
const equipment = (
  item_type: string,
  category: SeedItem['category'],
  bonuses: Readonly<Partial<Record<StatName, number>>>
): SeedItem => {
  const stats = Object.freeze(
    Object.fromEntries(stat_names.map((stat) => [stat, bonuses[stat] ?? 0])) as Record<StatName, number>
  )
  return Object.freeze({
    item_type,
    name: titleize(item_type.replace('demo_goblin_', 'muru_')),
    category,
    level: 200,
    stats: { min: stats, max: stats },
  })
}

export const ADVENTURE_ITEMS = Object.freeze([
  equipment('zukin_muru', 'hat', { vitality: 350, strength: 100, intelligence: 100 }),
  equipment('enka_muru', 'cloak', { vitality: 300, strength: 100, intelligence: 100 }),
  equipment('demo_goblin_relic', 'relic', { action: 1, strength: 100, intelligence: 100 }),
  equipment('demo_goblin_ring', 'ring', { vitality: 200, action: 1, strength: 80, intelligence: 80 }),
  equipment('demo_goblin_boots', 'boots', { vitality: 250, movement: 1, strength: 80, intelligence: 80 }),
])
export const ADVENTURE_PET = 'beru'
export const ADVENTURE_PET_ITEM = encyclopedia_catalog.items.find(({ item_type }) => item_type === ADVENTURE_PET)!

export const ADVENTURE_LOOT = Object.freeze(
  [...ADVENTURE_ITEMS, ADVENTURE_PET_ITEM].map(({ item_type }) => ({
    item_type,
    chance_bp: 10_000,
    min_qty: 1,
    max_qty: 1,
  }))
)
export const adventure_item = (id: string) =>
  [...ADVENTURE_ITEMS, ADVENTURE_PET_ITEM].find(({ item_type }) => item_type === id)

const attack = ({
  damage,
  range,
  line_of_sight,
  casts_per_target,
}: Readonly<(typeof adventure.encounters)[number]>): SpellLevel => {
  const effect = Object.freeze({
    kind: Number(EFFECT_KINDS.damage),
    element: 'earth' as const,
    value: damage,
    value_max: damage,
    area_shape: 0,
    area_size: 0,
    target_filter: Number(TARGET_FILTERS.not_team),
    chance_bp: 10_000,
    turns: 0,
    stat: 0,
  })
  return Object.freeze({
    ap_cost: 3,
    range_min: 1,
    range_max: range,
    modifiable_range: false,
    line_of_sight,
    line_launch: false,
    free_cell: false,
    casts_per_turn: 2,
    casts_per_target,
    cooldown_turns: 0,
    crit_1_in: 0,
    effects: [effect],
    crit_effects: [effect],
  })
}

const goblin = (source: Readonly<(typeof adventure.encounters)[number]>): SeedMob => {
  const { model, name, hp, boss, spell } = source
  return Object.freeze({
    mob_type: `demo_goblin_${model}`,
    name,
    family: 'demo',
    element: 'earth',
    role: boss ? 'boss' : 'normal',
    level_min: source.level_min,
    level_max: source.level_max,
    hp,
    ap: 6,
    mp: 4,
    agility: 0,
    wisdom: 0,
    resistances: { earth: item_stat_center, fire: item_stat_center, water: item_stat_center, air: item_stat_center },
    spells: [{ name: spell, levels: [attack(source)] }],
    loot: model === 1 ? ADVENTURE_LOOT : [],
    xp: 0,
  })
}
export const ADVENTURE_MOBS = Object.freeze(adventure.encounters.map(goblin))
export const ADVENTURE_ENCOUNTERS = Object.freeze(
  adventure.encounters.map((row, index) => ({
    mob: ADVENTURE_MOBS[index]!,
    count: row.count,
    position: row.position,
  }))
)
export const ADVENTURE_COMPANION_ITEMS: readonly SeedItem[] = [
  equipment(adventure.companion.loadout.hat, 'hat', adventure.companion.hat_bonuses),
  encyclopedia_catalog.items.find(({ item_type }) => item_type === adventure.companion.loadout.cloak)!,
]

export const adventure_group = (encounter: number) => {
  const { mob, count, position } = ADVENTURE_ENCOUNTERS[encounter]!
  return Object.freeze({
    id: `adventure_pack_${encounter}`,
    x: position.x,
    z: position.z,
    members: Array.from({ length: count }, (_, index) => ({
      mob_type: mob.mob_type,
      level_scalar: count === 1 ? 50 : index * 50,
    })),
  })
}
export const adventure_mob = (mob_type: string) => ADVENTURE_MOBS.find((mob) => mob.mob_type === mob_type)

export const ADVENTURE_NAMES = Object.freeze(
  Object.fromEntries(ADVENTURE_MOBS.map(({ mob_type, name }) => [mob_type, name]))
)

/** The active fight identity keeps its world anchor even after progression advances. */
export const adventure_fight_position = (fight_id: string | null) =>
  ADVENTURE_ENCOUNTERS.find((_, index) => `adventure_${index}` === fight_id)?.position ?? null
