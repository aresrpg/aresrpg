// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { resolve_equip_templates } from './equip_version_gate.js'

/** MIRROR of equip_actions.js `refusal_copy` — keep 1:1. */
const refusal_copy = (unresolved) =>
  `Couldn't equip ${unresolved.map((r) => r.item_type || 'unknown item').join(', ')} — its item template wasn't found on-chain. Unstage it and try again.`

// emerald_id/amethyst_id are synthetic "two distinct fresh-universe cloaks" stand-ins, not real slugs —
// they just need to be two DIFFERENT ids currently living in the manifest. Repinned to the ceremony #3
// corpus (cape_kamui / cape_fuwa_black from packages/move/scripts/out/seed_manifest.json); the prior pair
// predated ceremony #3 and no longer resolves (same drift class as d034e13a). previous_emerald_id is
// deliberately NOT in any manifest generation — it only needs to stay absent, so it is untouched.
const emerald_id = '0x1edd164881dba58cd54f8b30fc174d3a7074e39c6889d250d41fe66152f3d395'
const amethyst_id = '0x5da6ad1b4191ffe13ae9426019580e57e7f46d8d979ad753e13bb00befe37366'
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
