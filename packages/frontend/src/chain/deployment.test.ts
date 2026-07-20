import { describe, expect, it } from 'bun:test'

import {
  DEFAULT_ENGINE_RECIPE,
  BIOME_ENGINE_RECIPE,
  engine_recipe_for_biome,
  resolve_engine_recipe,
} from './deployment'

// Frontend wiring lane (DECISIONS 2026-07-13): the ONE pinned biome→recipe translator + the full boot-seam
// precedence (embed_voxel.js). Pure functions — no engine, no chain, no boot required.

// The AUTHORITATIVE 20-world truth: on-chain `biome` string (per world) → engine recipe key. Cross-checked
// against BOTH the seed corpus (seed/mainnet/NN/world.json) and the live /v1 encyclopedia worlds view — they
// agree on every string. Every biome string is unique, so this biome-keyed table is the sound shape.
const WORLD_BIOME_RECIPE: ReadonlyArray<readonly [string, string, string]> = [
  ['01_first_shore', 'archipelago', 'paradise'],
  ['02_verdant_hollow', 'canyon', 'rainforest'],
  ['03_emberfall_steppe', 'ash_steppe', 'ember_steppe'],
  ['04_mistral_heights', 'mesa', 'mistral_heights'],
  ['05_drowned_fen', 'swamp', 'drowned_fen'],
  ['06_pandora_reach', 'floating_islands', 'pandora_reach'],
  ['07_cinderforge_depths', 'magma_foundry', 'cinderforge_depths'],
  ['08_palewood', 'pale_forest', 'palewood'],
  ['09_coral_throne', 'reef_city', 'coral_throne'],
  ['10_sunspire_dunes', 'glass_desert', 'sunspire_dunes'],
  ['11_rootheart', 'world_tree', 'rootheart'],
  ['12_static_fields', 'storm_plateau', 'static_fields'],
  ['13_mirrormere', 'frost_lake', 'mirrormere'],
  ['14_charnel_marches', 'ashen_marsh', 'charnel_marches'],
  ['15_silent_atoll', 'dead_calm_sea', 'silent_atoll'],
  ['16_the_sundering', 'sundered_waste', 'the_sundering'],
  ['17_obsidian_choir', 'volcanic_cathedral', 'obsidian_choir'],
  ['18_abyssal_weald', 'abyssal_forest', 'abyssal_weald'],
  ['19_hollow_crown', 'celestial_ruin', 'hollow_crown'],
  ['20_zenith_scar', 'fractured_zenith', 'zenith_scar'],
]

describe('engine_recipe_for_biome — chain biome string → engine recipe key', () => {
  it('translates each of the 20 seeded mainnet worlds to ITS own recipe (corpus + /v1 chain agree)', () => {
    for (const [world, biome, recipe] of WORLD_BIOME_RECIPE) {
      expect({ world, recipe: engine_recipe_for_biome(biome) }).toEqual({ world, recipe })
    }
  })

  it('falls back to the DEFAULT recipe for a genuinely unmapped biome — never throws', () => {
    expect(engine_recipe_for_biome('nonexistent_biome')).toBe(DEFAULT_ENGINE_RECIPE)
    expect(engine_recipe_for_biome('testlands')).toBe(DEFAULT_ENGINE_RECIPE)
  })

  it('falls back to DEFAULT on null/undefined/empty — an absent chain doc never crashes the boot', () => {
    expect(engine_recipe_for_biome(null)).toBe(DEFAULT_ENGINE_RECIPE)
    expect(engine_recipe_for_biome(undefined)).toBe(DEFAULT_ENGINE_RECIPE)
    expect(engine_recipe_for_biome('')).toBe(DEFAULT_ENGINE_RECIPE)
  })

  it('Testlands\' own biome ("testlands") falls through to the default — a live session must not change recipe', () => {
    expect(engine_recipe_for_biome('testlands')).toBe(DEFAULT_ENGINE_RECIPE)
    expect(engine_recipe_for_biome('testlands')).toBe('rainforest') // today's literal boot-seam default, byte-exact
  })

  it('the pinned table is EXACTLY the 20-world map — no silent drift, no orphan entries', () => {
    expect(BIOME_ENGINE_RECIPE).toEqual(
      Object.fromEntries(WORLD_BIOME_RECIPE.map(([, biome, recipe]) => [biome, recipe]))
    )
  })
})

describe('resolve_engine_recipe — the FULL boot-seam precedence (url override > chain biome > default)', () => {
  it('an explicit URL override wins outright, even over a mapped chain biome', () => {
    expect(resolve_engine_recipe({ url_biome: 'everest', chain_biome: 'archipelago' })).toBe('everest')
  })

  it('a URL override is passed through UNTRANSLATED — it is already an engine recipe key', () => {
    expect(resolve_engine_recipe({ url_biome: 'paradise', chain_biome: null })).toBe('paradise')
  })

  it('no URL override → the chain biome translates via the pinned table', () => {
    expect(resolve_engine_recipe({ url_biome: null, chain_biome: 'ash_steppe' })).toBe('ember_steppe')
  })

  it('no URL override + no/unmapped chain biome → the default (Testlands today)', () => {
    expect(resolve_engine_recipe({ url_biome: null, chain_biome: null })).toBe(DEFAULT_ENGINE_RECIPE)
    expect(resolve_engine_recipe({ url_biome: '', chain_biome: 'testlands' })).toBe(DEFAULT_ENGINE_RECIPE)
  })

  it('an empty-string URL param (present but blank) is treated as absent, not as a literal recipe key', () => {
    expect(resolve_engine_recipe({ url_biome: '', chain_biome: 'canyon' })).toBe('rainforest')
  })
})
