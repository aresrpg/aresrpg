// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { resolve_equip_templates } from './equip_version_gate.js'

/** MIRROR of equip_actions.js `refusal_copy` — keep 1:1. */
const refusal_copy = (unresolved) =>
  `Couldn't equip ${unresolved.map((r) => r.item_type || 'unknown item').join(', ')} — its item template wasn't found on-chain. Unstage it and try again.`

const emerald_id = '0xf296a0233b9e055364eae64e4f5cf639105c8e846b71ec7008162b8f8af213a1'
const amethyst_id = '0x01229549bb153e4f44b59190590a572180bdb2939e22e6ff917ccdaebe830c23'
const previous_emerald_id = '0xa6a4b12ab46d2dd1518f823aeeaac5d48d5e47debd51192606bcd0fc10f63425'

describe('resolve_equip_templates (exact template-identity gate)', () => {
  test('fresh-universe items pass their own stamped ids even when both share generic item_type cloak', () => {
    const rows = [
      { item_id: '0x1', slot: 'cloak', item_type: 'cloak', item_template_id: emerald_id },
      { item_id: '0x2', slot: 'cloak', item_type: 'cloak', item_template_id: amethyst_id },
    ]
    const { resolved, unresolved, stale } = resolve_equip_templates(rows)
    expect(unresolved).toEqual([])
    expect(stale).toEqual([])
    expect(resolved.map((r) => r.item_template_id)).toEqual([emerald_id, amethyst_id])
  })

  test('a genuinely previous-generation item remains refused', () => {
    const row = { item_id: '0xold', slot: 'cloak', item_type: 'cloak', item_template_id: previous_emerald_id }
    const { resolved, unresolved, stale } = resolve_equip_templates([row])
    expect(resolved).toEqual([])
    expect(unresolved).toEqual([])
    expect(stale).toEqual([row])
  })

  test('missing canonical provenance refuses before building a transaction', () => {
    expect(resolve_equip_templates([{ item_id: '0x1', slot: 'cloak', item_type: 'cloak' }]).unresolved).toHaveLength(1)
  })
})

describe('refusal_copy (honest player line for unresolvable items)', () => {
  test('names the item SLUGS and stays decoder-safe: no 0x… id (JARGON_RE would degrade it to the generic line)', () => {
    const msg = refusal_copy([
      { item_id: '0xdeadbeefdeadbeef', item_type: 'ghost_ring_not_seeded' },
      { item_id: '0xfeedfacefeedface', item_type: undefined },
    ])
    expect(msg).toContain('ghost_ring_not_seeded')
    expect(msg).toContain('unknown item')
    // the shared decoder's jargon gate (abort_copy.js JARGON_RE) — an object id in the copy would swallow it
    expect(/0x[0-9a-f]{6,}/i.test(msg)).toBe(false)
    expect(/MoveAbort|\[object Object\]/i.test(msg)).toBe(false)
  })
})
