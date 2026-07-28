// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { is_object_id, seed_manifest } from '../content/seed_manifest'

import { resolve_equip_templates } from './equip_version_gate.js'

/** MIRROR of equip_actions.js `refusal_copy` — keep 1:1. */
const refusal_copy = (unresolved) =>
  `Couldn't equip ${unresolved.map((r) => r.item_type || 'unknown item').join(', ')} — its item template wasn't found on-chain. Unstage it and try again.`

// The passing pair is DERIVED from the same living corpus the gate reads (one home per fact): the test only
// needs two DIFFERENT ids of the CURRENT generation, and every republish mints a fresh set — literals copied
// out of the manifest reddened this test at each ceremony (the d034e13a → ceremony-#3 repin treadmill).
// retired_generation_id is a real previous-generation id, stamped by no live manifest: it must stay absent,
// which the `stale` assertion below proves at run time.
const [living_id_a, living_id_b] = Object.values(seed_manifest.items).filter(is_object_id)
const retired_generation_id = '0xa6a4b12ab46d2dd1518f823aeeaac5d48d5e47debd51192606bcd0fc10f63425'

describe('resolve_equip_templates (exact template-identity gate)', () => {
  test('fresh-universe items pass their own stamped ids even when both share generic item_type cloak', () => {
    // The premise, not the subject: a corpus that shipped fewer than two items would make this vacuous.
    expect(living_id_b).toBeTruthy()
    expect(living_id_a).not.toBe(living_id_b)
    const rows = [
      { item_id: '0x1', slot: 'cloak', item_type: 'cloak', item_template_id: living_id_a },
      { item_id: '0x2', slot: 'cloak', item_type: 'cloak', item_template_id: living_id_b },
    ]
    const { resolved, unresolved, stale } = resolve_equip_templates(rows)
    expect(unresolved).toEqual([])
    expect(stale).toEqual([])
    expect(resolved.map((r) => r.item_template_id)).toEqual([living_id_a, living_id_b])
  })

  test('a genuinely previous-generation item remains refused', () => {
    const row = { item_id: '0xold', slot: 'cloak', item_type: 'cloak', item_template_id: retired_generation_id }
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
