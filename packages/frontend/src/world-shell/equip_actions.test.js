// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { resolve_equip_templates } from './equip_version_gate.js'

/** MIRROR of equip_actions.js `refusal_copy` — keep 1:1. */
const refusal_copy = (unresolved) =>
  `Couldn't equip ${unresolved.map((r) => r.item_type || 'unknown item').join(', ')} — its item template wasn't found on-chain. Unstage it and try again.`

// Two DISTINCT template identities; the gate only ever compares them for presence and equality, so these
// are deliberately NOT address-shaped — a hardcoded 0x… in a test reads as a live chain pointer.
const id_a = 'template-identity-a'
const id_b = 'template-identity-b'

describe('resolve_equip_templates (exact template-identity gate)', () => {
  test('items pass their own stamped ids even when both share generic item_type cloak', () => {
    const rows = [
      { item_id: '0x1', slot: 'cloak', item_type: 'cloak', item_template_id: id_a },
      { item_id: '0x2', slot: 'cloak', item_type: 'cloak', item_template_id: id_b },
    ]
    const { resolved, unresolved } = resolve_equip_templates(rows)
    expect(unresolved).toEqual([])
    expect(resolved.map((r) => r.item_template_id)).toEqual([id_a, id_b])
  })

  // ISSUE #1467 — the gate used to also refuse any id absent from the BUILD-TIME seed receipt. That receipt
  // is frozen into the deployed bundle, so a republish that outran a redeploy made EVERY equip refuse. Which
  // templates are alive is the chain's call: `equipment::equip` aborts ETemplateMismatch (abort_copy 110) and
  // run_tx dry-runs first, so a retired template costs zero gas.
  test('a template the deployed bundle never heard of still reaches the chain', () => {
    const row = {
      item_id: '0xold',
      slot: 'cloak',
      item_type: 'cloak',
      item_template_id: '0xa6a4b12ab46d2dd1518f823aeeaac5d48d5e47debd51192606bcd0fc10f63425',
    }
    const { resolved, unresolved } = resolve_equip_templates([row])
    expect(unresolved).toEqual([])
    expect(resolved).toHaveLength(1)
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
