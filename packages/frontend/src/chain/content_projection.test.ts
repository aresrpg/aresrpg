// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import { is_living_item, is_living_mob, is_living_world } from '../pages/encyclopedia/living_corpus'
import { has_world_corpus } from '../pages/encyclopedia/world_corpus'
import seed_manifest from '../../../move/scripts/out/seed_manifest.json'

import { T62_WORLDS } from './deployment'

const source = (relative_path: string) => readFileSync(new URL(relative_path, import.meta.url), 'utf8')

describe('seed-receipt content projections', () => {
  test('derive in code and never import copied ID artifacts', () => {
    expect(source('../pages/encyclopedia/living_corpus.ts')).not.toContain("from './living_ids.json'")
    expect(source('../pages/encyclopedia/world_corpus.ts')).not.toContain("from './world_corpus.json'")
    expect(source('../game/screens/hud/fight-spells.js')).not.toContain("from './fight-spells.json'")
  })

  test('preserve every public content id from the current seed receipt', () => {
    expect(T62_WORLDS.map(({ id }) => id)).toEqual(seed_manifest.worlds.map(({ id }) => id))

    for (const id of Object.values(seed_manifest.items)) expect(is_living_item({ template_id: id })).toBe(true)
    for (const { id } of Object.values(seed_manifest.mobs)) expect(is_living_mob({ template_id: id })).toBe(true)
    for (const { id } of seed_manifest.worlds) expect(is_living_world({ world_id: id })).toBe(true)
  })

  // RUNTIME BLOBS (#196 / #106): WORLD_CORPUS loads from the Walrus world_corpus blob (load_world_corpus)
  // and fight_spells_data from the spell_corpus blob (load_spell_corpus) — both async at boot in main.tsx,
  // neither fetched by this headless test, so both legitimately degrade to empty. Neither blob ships in this
  // public repo; this full-corpus case runs only where the content is seeded.
  test.skipIf(!has_world_corpus())(
    'WORLD_CORPUS and fight_spells_data mirror every public content id from the current seed receipt',
    async () => {
      const { WORLD_CORPUS } = await import('../pages/encyclopedia/world_corpus')
      const { fight_spells_data } = await import('../game/screens/hud/fight-spells.js')

      expect(WORLD_CORPUS.worlds.map(({ id }) => id)).toEqual(seed_manifest.worlds.map(({ id }) => id))
      const seeded_spell_ids = new Set(Object.values(seed_manifest.spells).map(({ id }) => id))
      expect(fight_spells_data.spells).toHaveLength(240)
      for (const spell of fight_spells_data.spells) expect(seeded_spell_ids.has(spell.object_id)).toBe(true)
    }
  )
})
