// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ISSUE #1467 — "DROPPED BY" read "no known drop sources" on Wooling Fleece while the live /v1 mobs family
// served Wooling / Wooligan / Woolkin Celestial each carrying it in their drops rows. The server data was
// correct; the client's reverse-join was fenced through the BUILD-TIME seed receipt (`is_living_mob`), whose
// mob ids belong to whatever generation the last redeploy froze.
//
// The fixture is a REAL captured payload (fixtures/live_wooling_drops.json carries its own provenance
// header): the seven live mob rows that drop Wooling Fleece, and the measurement that proves the class —
// ZERO of them appear in the bundled manifest's 374 mob ids. Encoding these rows with the same model that
// decodes them would prove nothing; these are the bytes the deployed read API actually served.
import { describe, expect, test } from 'bun:test'

import { invert_mob_drops } from '../../../src/pages/encyclopedia/dropped_by'

import fixture from './fixtures/live_wooling_drops.json'

const { mobs, wooling_fleece_template_id: FLEECE } = fixture

describe('invert_mob_drops — item → droppers, off the live mob rows', () => {
  test('Wooling Fleece resolves its seven live droppers, best chance first', () => {
    const index = invert_mob_drops(mobs)
    const droppers = index.get(FLEECE)

    expect(droppers?.map((row) => row.name)).toEqual([
      'Wooligan',
      'Wooling',
      'Eternwool',
      'Hornhead',
      'Woolly Doom',
      'Woolice',
      'Woolkin Celestial',
    ])
    // Chances are the row's own basis-point-derived percentages, carried verbatim and sorted descending.
    expect(droppers?.map((row) => row.chance_percent)).toEqual([66.2, 60, 56.3, 45.1, 45.1, 41.7, 32.6])
    const wooling = droppers?.find((row) => row.name === 'Wooling')
    expect(wooling).toMatchObject({ minLevel: 1, maxLevel: 5 })
    // The dropper's id is the MOB's template id — what "navigate to this mob" routes on.
    expect(wooling?.id).toBe(mobs.find((mob) => mob.name === 'Wooling')!.template_id)
  })

  // THE CLASS: the bundled manifest is boot paint, never the join's truth. Fencing these same rows through
  // it produced the empty screen — the fixture's provenance header records 0 of 7 surviving.
  test('the join reads only the live rows — no bundled id set can empty it', () => {
    expect(fixture._provenance.bundled_manifest_mob_ids_matching_these_rows).toBe(0)
    expect(invert_mob_drops(mobs).get(FLEECE)).toHaveLength(7)
  })

  test('every dropped template is indexed, not just the queried one', () => {
    const index = invert_mob_drops(mobs)
    const dropped_templates = new Set(mobs.flatMap((mob) => mob.drops.map((drop) => drop.template_id)))
    expect(index.size).toBe(dropped_templates.size)
    for (const template_id of dropped_templates) expect(index.get(template_id)!.length).toBeGreaterThan(0)
  })

  // ABSENCE IS NOT EMPTINESS: the inversion degrades to an empty index and NOTHING is memoized — a caller
  // handed the failed/absent read gets no index it could mistake for "this item has no droppers", and a
  // later successful read is inverted afresh.
  test('an absent or empty mob list degrades to an empty index without poisoning a later read', () => {
    expect(invert_mob_drops(undefined).size).toBe(0)
    expect(invert_mob_drops(null).size).toBe(0)
    expect(invert_mob_drops([]).size).toBe(0)
    expect(invert_mob_drops(mobs).get(FLEECE)).toHaveLength(7)
  })

  test('a row with no drops table is skipped, never a fabricated source', () => {
    const index = invert_mob_drops([{ template_id: '0xdead', name: 'Silent', drops: null }, ...mobs])
    expect(index.get(FLEECE)).toHaveLength(7)
    expect([...index.values()].flat().some((row) => row.id === '0xdead')).toBe(false)
  })

  test('display names are injected, never derived inside the join', () => {
    const index = invert_mob_drops(mobs, (name) => `${name}!`)
    expect(index.get(FLEECE)?.[0].name).toBe('Wooligan!')
  })
})
