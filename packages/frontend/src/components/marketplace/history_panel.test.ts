// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

const history_panel_source = readFileSync(new URL('./history_panel.tsx', import.meta.url), 'utf8')

// #491: present()'s icon computation dead-ended at '' whenever the template_id/slugs[name] hop missed —
// exactly the same missing template-icon leg as sell_panel's asset_slug_of, on the HISTORY sales rows.
describe('marketplace history panel', () => {
  test('the icon resolver falls back to item_type instead of dead-ending at an empty icon slug', () => {
    expect(history_panel_source).toContain(
      'cosmetic_icon_of({ slug: template_slug, name: authored_name }) ?? template_slug ?? item_type'
    )
    expect(history_panel_source).not.toContain(
      "cosmetic_icon_of({ slug: template_slug, name: authored_name }) ?? template_slug ?? ''"
    )
  })
})
