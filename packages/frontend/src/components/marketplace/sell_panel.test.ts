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

  // #491: asset_slug_of used to dead-end at '' whenever template_of()/slugs[name] missed (every non-cosmetic
  // owned item, since templates_item rarely carries a matching row) — no icon rendered except cosmetics.
  test('asset_slug_of falls back to the raw identity instead of dead-ending at an empty icon slug', () => {
    expect(sell_panel_source).toContain('cosmetic_icon_of({ slug: template_slug, name }) ?? template_slug ?? identity')
    expect(sell_panel_source).not.toContain("cosmetic_icon_of({ slug: template_slug, name }) ?? template_slug ?? ''")
  })
})
