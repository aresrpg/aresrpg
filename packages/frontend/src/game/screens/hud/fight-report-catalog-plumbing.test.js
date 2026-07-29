// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { slug_by_template_id_from } from './loot-slug-map.js'

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('fight loot slugs arrive through composition-root props (#1522)', () => {
  test('the shared fight path stays free of virtual and seed-receipt imports', () => {
    for (const path of ['./FightReport.jsx', './FightResult.jsx', './FightSummary.jsx']) {
      expect(source(path)).not.toContain('virtual:item_catalog')
      expect(source(path)).not.toContain('seed_manifest')
    }
  })

  test('both legal composition roots inject the authored name-to-slug catalog', () => {
    const world = source('./world/GameWorldHud.jsx')
    const simulator_page = source('../../../pages/simulator.tsx')
    const simulator_hud = source('../../../simulator/FightHud.jsx')

    expect(world).toContain("import { slugs } from 'virtual:item_catalog'")
    expect(world).toContain('<FightResult slug_by_name={slugs} />')
    expect(simulator_page).toContain("import { slugs } from 'virtual:item_catalog'")
    expect(simulator_page).toContain('<SimulatorFightHud slug_by_name={slugs} />')
    expect(simulator_hud).toContain('<FightResult slug_by_name={slug_by_name} />')
  })

  test('a republished live template joins to authored art by stable name', () => {
    const template_id = `0x${'1522'.repeat(16)}`
    const template_map = new Map([[template_id, { name: 'Starfell Shard' }]])

    expect(
      slug_by_template_id_from(template_map, {
        'Starfell Shard': 'post_republish_starfell_shard',
      })
    ).toEqual({ [template_id]: 'post_republish_starfell_shard' })
  })

  test('the seed-receipt depcruise allowlist does not exempt FightReport', () => {
    const depcruise = source('../../../../../../.dependency-cruiser.cjs')
    const rule = depcruise.slice(
      depcruise.indexOf("name: 'seed-receipt-boot-paint-only'"),
      depcruise.indexOf("name: 'no-circular'")
    )

    expect(rule).not.toMatch(/pathNot:[\s\S]*FightReport/)
  })
})
