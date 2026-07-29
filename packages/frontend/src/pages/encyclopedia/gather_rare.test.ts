// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST for #1670 ask 3: the gathering progression table lists the base resource per tier but never
// its RARE VARIANT, so the golden twin a player is actually hunting was invisible on the job page. The
// link is authored on chain and served by /v1/rare-links; the display name comes from the same /v1 items
// list the rest of the page joins against.
import { describe, expect, test } from 'bun:test'

import { rare_variants_by_base } from './gather_rare'

const WHEAT = { template_id: '0xtpl_wheat', name: 'Wheat' }
const GOLDEN_WHEAT = { template_id: '0xtpl_golden_wheat', name: 'Golden Wheat' }
const BARLEY = { template_id: '0xtpl_barley', name: 'Barley' }

describe('rare_variants_by_base — the gather table’s base → rare twin join', () => {
  test('keys the live rare item by its BASE resource template id', () => {
    const map = rare_variants_by_base(
      [{ template_id: WHEAT.template_id, rare_template_id: GOLDEN_WHEAT.template_id }],
      [WHEAT, GOLDEN_WHEAT, BARLEY]
    )
    expect(map.get(WHEAT.template_id)).toEqual(GOLDEN_WHEAT)
    expect(map.get(BARLEY.template_id)).toBeUndefined()
  })

  test('a rare twin that has not snapshotted yet is dropped — honest gap, never a fabricated row', () => {
    const map = rare_variants_by_base(
      [{ template_id: BARLEY.template_id, rare_template_id: '0xtpl_never_minted' }],
      [BARLEY]
    )
    expect(map.size).toBe(0)
  })

  test('empty / absent reads are an empty map, never a throw', () => {
    expect(rare_variants_by_base(undefined, [WHEAT]).size).toBe(0)
    expect(rare_variants_by_base([], undefined).size).toBe(0)
  })
})
