// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

const sell_panel_source = readFileSync(new URL('./sell_panel.tsx', import.meta.url), 'utf8')

describe('marketplace sell panel', () => {
  test('does not expose stack-shaping plumbing or readiness states', () => {
    for (const forbidden of [
      'data-shape-your-stack',
      'submit_split_stack',
      'submit_merge_stacks',
      'marketplace.lots.stack_ready',
      'marketplace.lots.shape_title',
      'marketplace.lots.shape_hint',
      'marketplace.lots.split_action',
      'marketplace.lots.split_unavailable',
      'marketplace.lots.merge_action',
      'marketplace.lots.merge_unavailable',
    ]) {
      expect(sell_panel_source).not.toContain(forbidden)
    }
  })

  // #1296 (was #491): the card's icon slug is NOT this panel's fact. It renders SellItemHeader, which derives
  // the slug through marketplace_listing_icon_slug — the one ruled chain. The inline `asset_slug_of` this panel
  // used to carry read that chain backwards (template_id before the item slug) and drew the placeholder cube
  // for every item the private catalog misses. The behaviour is pinned by the SellItemHeader render tests
  // (marketplace_render.test.tsx); this row only forbids the chain from growing a home here again.
  test('the sell card resolves its icon through the shared header, never an inline slug chain', () => {
    expect(sell_panel_source).toContain('<SellItemHeader')
    expect(sell_panel_source).not.toContain('asset_slug_of')
    expect(sell_panel_source).not.toContain('cosmetic_icon_of')
  })
})
