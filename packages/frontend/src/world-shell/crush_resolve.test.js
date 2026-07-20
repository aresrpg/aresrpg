// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { resolve_crush_template } from './crush_resolve.js'

describe('resolve_crush_template', () => {
  test('exact owner-item template identity beats a lossy shared-slug row', () => {
    const exact = { id: '0xexact', item_type: 'hat' }
    const wrong = { id: '0xwrong', item_type: 'hat' }

    expect(
      resolve_crush_template(
        { template_id: exact.id, item_type: 'hat' },
        new Map([[exact.id, exact]]),
        new Map([['hat', wrong]])
      )
    ).toBe(exact)
  })

  test('an exact-id miss never guesses another template with the same slug', () => {
    const wrong = { id: '0xwrong', item_type: 'cloak' }

    expect(
      resolve_crush_template(
        { template_id: '0xremoved', item_type: 'cloak' },
        new Map([[wrong.id, wrong]]),
        new Map([['cloak', wrong]])
      )
    ).toBe(null)
  })

  test('legacy chain-read rows without template_id retain the item_type fallback', () => {
    const legacy = { id: '0xlegacy', item_type: 'sword' }
    expect(resolve_crush_template({ item_type: 'sword' }, null, new Map([['sword', legacy]]))).toBe(legacy)
  })
})
