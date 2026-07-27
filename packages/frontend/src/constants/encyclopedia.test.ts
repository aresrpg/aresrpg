// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { CATEGORY_GROUPS, ITEM_CATEGORIES } from './encyclopedia'

describe('encyclopedia item categories', () => {
  test('uses the farmer tool category exposed by the chain', () => {
    expect(ITEM_CATEGORIES).toContain('TOOL_FARMER')
    expect(CATEGORY_GROUPS.TOOLS).toContain('TOOL_FARMER')
    expect(ITEM_CATEGORIES).not.toContain('TOOL_PAYSAN')
    expect(CATEGORY_GROUPS.TOOLS).not.toContain('TOOL_PAYSAN')
  })
})
