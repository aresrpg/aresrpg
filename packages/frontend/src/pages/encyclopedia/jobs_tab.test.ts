// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { related_items_for_job } from './item_catalog'

describe('related_items_for_job — gathering jobs show only their own economy', () => {
  test('miner includes its gatherable, rare twin, and craft output — not an unrelated high-tier intermediate', () => {
    const items = [
      { template_id: '0xquartz', level: 1 },
      { template_id: '0xrare_quartz', level: 1 },
      { template_id: '0xcut_quartz', level: 5 },
      { template_id: '0xdiadem_lattice', level: 180 },
    ]
    const gatherables = [{ id: '0xquartz', job: 2, tier: 1 }]
    const rare_links = [
      { template_id: '0xquartz', rare_template_id: '0xrare_quartz' },
      { template_id: '0xother_resource', rare_template_id: '0xother_rare' },
    ]
    const recipes = [
      { output_template_id: '0xcut_quartz', required_job: 2 },
      { output_template_id: '0xdiadem_lattice', required_job: 13 },
    ]

    expect(related_items_for_job(items, gatherables, rare_links, recipes, 2).map((item) => item.template_id)).toEqual([
      '0xquartz',
      '0xrare_quartz',
      '0xcut_quartz',
    ])
  })
})
