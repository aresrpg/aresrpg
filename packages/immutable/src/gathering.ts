// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type GatheringJob = 'FARMER' | 'HERBALIST' | 'MINER'

export type Gatherable = Readonly<{
  item_type: string
  job: GatheringJob
  tier: number
  protector: string
  rare_item_type: string
}>

export type ProtectorLevelRange = Readonly<{ level_min: number; level_max: number }>

export const protector_level_range = (tier: number, resource_level: number): ProtectorLevelRange => {
  if (tier <= 1) return Object.freeze({ level_min: 1, level_max: 5 })
  if (tier === 2) return Object.freeze({ level_min: 8, level_max: 12 })
  if (tier === 3) return Object.freeze({ level_min: 15, level_max: 25 })
  return Object.freeze({ level_min: Math.max(1, resource_level - 10), level_max: resource_level + 10 })
}

const gatherable_rows: readonly Gatherable[] = [
  {
    item_type: 'wheat',
    job: 'FARMER',
    tier: 1,
    protector: 'protector_wheat_bricheton',
    rare_item_type: 'golden_wheat',
  },
  {
    item_type: 'green_mushroom',
    job: 'HERBALIST',
    tier: 1,
    protector: 'protector_shrooms_gaia',
    rare_item_type: 'golden_mushroom',
  },
  { item_type: 'quartz', job: 'MINER', tier: 1, protector: 'protector_quartz', rare_item_type: 'infinity_quartz' },
  {
    item_type: 'wheat_barley',
    job: 'FARMER',
    tier: 2,
    protector: 'protector_barley_bricheton',
    rare_item_type: 'shiny_barley',
  },
  {
    item_type: 'red_orchid',
    job: 'HERBALIST',
    tier: 2,
    protector: 'protector_orchid_gaia',
    rare_item_type: 'bloodveil_orchid',
  },
  { item_type: 'amber', job: 'MINER', tier: 2, protector: 'protector_amber', rare_item_type: 'infinity_amber' },
  {
    item_type: 'wheat_malt',
    job: 'FARMER',
    tier: 3,
    protector: 'protector_malt_bricheton',
    rare_item_type: 'pristine_malt',
  },
  {
    item_type: 'ivory_shrooms',
    job: 'HERBALIST',
    tier: 3,
    protector: 'protector_ivory_gaia',
    rare_item_type: 'ghost_cap',
  },
  { item_type: 'jade', job: 'MINER', tier: 3, protector: 'protector_jade', rare_item_type: 'infinity_jade' },
  {
    item_type: 'wheat_burnt',
    job: 'FARMER',
    tier: 4,
    protector: 'protector_burnt_bricheton',
    rare_item_type: 'smoldering_wheat',
  },
  {
    item_type: 'aloe_vera',
    job: 'HERBALIST',
    tier: 4,
    protector: 'protector_aloe_gaia',
    rare_item_type: 'verdant_aloe',
  },
  {
    item_type: 'moonstone',
    job: 'MINER',
    tier: 4,
    protector: 'protector_moonstone',
    rare_item_type: 'infinity_moonstone',
  },
  {
    item_type: 'wheat_tanjirize',
    job: 'FARMER',
    tier: 5,
    protector: 'protector_tanjirize_bricheton',
    rare_item_type: 'crystallized_tanjirize',
  },
  {
    item_type: 'nightcap',
    job: 'HERBALIST',
    tier: 5,
    protector: 'protector_nightcap_gaia',
    rare_item_type: 'golden_nightcap',
  },
  {
    item_type: 'bloodstone',
    job: 'MINER',
    tier: 5,
    protector: 'protector_bloodstone',
    rare_item_type: 'infinity_bloodstone',
  },
  {
    item_type: 'wheat_suize',
    job: 'FARMER',
    tier: 6,
    protector: 'protector_suize_bricheton',
    rare_item_type: 'genesis_suize',
  },
  {
    item_type: 'crimson_truffle',
    job: 'HERBALIST',
    tier: 6,
    protector: 'protector_truffle_gaia',
    rare_item_type: 'crimson_truffle_heart',
  },
  { item_type: 'duskite', job: 'MINER', tier: 6, protector: 'protector_duskite', rare_item_type: 'infinity_duskite' },
  {
    item_type: 'wheat_ukraine',
    job: 'FARMER',
    tier: 7,
    protector: 'protector_ukranize_bricheton',
    rare_item_type: 'ethereal_ukranize',
  },
  {
    item_type: 'phantom_spore',
    job: 'HERBALIST',
    tier: 7,
    protector: 'protector_phantom_gaia',
    rare_item_type: 'phantom_essence',
  },
  {
    item_type: 'obsidianite',
    job: 'MINER',
    tier: 7,
    protector: 'protector_obsidianite',
    rare_item_type: 'infinity_obsidianite',
  },
  {
    item_type: 'blood_wheat',
    job: 'FARMER',
    tier: 8,
    protector: 'protector_blood_bricheton',
    rare_item_type: 'abyssal_blood_wheat',
  },
  {
    item_type: 'witherbloom',
    job: 'HERBALIST',
    tier: 8,
    protector: 'protector_wither_gaia',
    rare_item_type: 'wither_petal',
  },
  {
    item_type: 'arcanite',
    job: 'MINER',
    tier: 8,
    protector: 'protector_arcanite',
    rare_item_type: 'infinity_arcanite',
  },
  {
    item_type: 'wheat_purple',
    job: 'FARMER',
    tier: 9,
    protector: 'protector_arcanize_bricheton',
    rare_item_type: 'spectral_arcanize',
  },
  {
    item_type: 'arcaneshroom',
    job: 'HERBALIST',
    tier: 9,
    protector: 'protector_arcane_gaia',
    rare_item_type: 'arcane_spore',
  },
  {
    item_type: 'draconite',
    job: 'MINER',
    tier: 9,
    protector: 'protector_draconite',
    rare_item_type: 'infinity_draconite',
  },
  {
    item_type: 'wheat_draconize',
    job: 'FARMER',
    tier: 10,
    protector: 'protector_draconize_bricheton',
    rare_item_type: 'primordial_draconize',
  },
  {
    item_type: 'dragonlily',
    job: 'HERBALIST',
    tier: 10,
    protector: 'protector_dragon_gaia',
    rare_item_type: 'dragon_pollen',
  },
  {
    item_type: 'cursed_gem',
    job: 'MINER',
    tier: 10,
    protector: 'protector_cursed_gem',
    rare_item_type: 'infinity_cursed_gem',
  },
  {
    item_type: 'wheat_white',
    job: 'FARMER',
    tier: 11,
    protector: 'protector_cursed_bricheton',
    rare_item_type: 'cursed_wheat',
  },
  {
    item_type: 'cursed_fungus',
    job: 'HERBALIST',
    tier: 11,
    protector: 'protector_cursed_gaia',
    rare_item_type: 'cursed_root',
  },
  {
    item_type: 'diamond',
    job: 'MINER',
    tier: 11,
    protector: 'protector_diamond',
    rare_item_type: 'infinity_diamond',
  },
]

export const gatherable_catalog: readonly Gatherable[] = Object.freeze(gatherable_rows.map((row) => Object.freeze(row)))

export const gatherable_item_types: readonly string[] = Object.freeze(
  gatherable_catalog.map(({ item_type }) => item_type)
)

const gatherables_by_type = Object.freeze(
  Object.fromEntries(gatherable_catalog.map((row) => [row.item_type, row]))
) as Readonly<Record<string, Gatherable>>

export const gatherable_of = (item_type: string): Gatherable | null => gatherables_by_type[item_type] ?? null

/** The three rare gathering identities of one tier form its pet food. Returns that tier only
 * for an exact farmer/herbalist/miner rare triad, independent of input order. */
export const rare_pet_food_tier = (input_types: readonly string[]): number | null => {
  if (input_types.length !== 3 || new Set(input_types).size !== 3) return null
  const inputs = new Set(input_types)
  const tier = gatherable_catalog.find(({ rare_item_type }) => inputs.has(rare_item_type))?.tier
  if (!tier) return null
  const expected = gatherable_catalog.filter((row) => row.tier === tier).map(({ rare_item_type }) => rare_item_type)
  return expected.length === 3 && expected.every((item_type) => inputs.has(item_type)) ? tier : null
}
