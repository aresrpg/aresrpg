// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

const history_panel_source = readFileSync(new URL('./history_panel.tsx', import.meta.url), 'utf8')

// #1296 (was #491): present()'s icon computation was a hand-copy of sell_panel's inline chain — a fourth home
// for one fact, which could not track the ruled chain when it changed. It derives through
// marketplace_listing_icon_slug + marketplace_item_icon now; the chain's own behaviour is pinned by
// marketplace_icon.test.ts.
describe('marketplace history panel', () => {
  test('the sales rows resolve icons through the one slug chain, never a hand-copied one', () => {
    expect(history_panel_source).toContain('marketplace_listing_icon_slug({ slug: item_type, template_id }')
    expect(history_panel_source).not.toContain('cosmetic_icon_of')
  })
})
