// key_candidates — the pure §9 key selection from the loaded bag (the ~10s-stall fast path's core). It must
// keep ONLY key rows carrying the full burn-PTB {id, kiosk_id, kiosk_cap_id} triple, drop everything else, and
// never throw on an unloaded (non-array) bag.

import { describe, expect, it } from 'bun:test'
import { ITEM_CATEGORY } from '@aresrpg/sdk/items'

import { key_candidates } from './key_pick.js'

const { KEY } = ITEM_CATEGORY
/** @param {Record<string, any>} [over] */
const row = (over) => ({ id: '0xi', kiosk_id: '0xk', kiosk_cap_id: '0xc', item_category: KEY, ...over })

describe('key_candidates (pure bag → burn-ready key picks)', () => {
  it('keeps §9 keys carrying the full {id, kiosk_id, kiosk_cap_id} triple (and nothing else)', () => {
    expect(key_candidates([row({ name: 'Key', amount: 3 })])).toEqual([
      { id: '0xi', kiosk_id: '0xk', kiosk_cap_id: '0xc' },
    ])
  })

  it('drops non-key items', () => {
    expect(key_candidates([row({ item_category: 'sword' })])).toEqual([])
  })

  it('drops a key row missing its kiosk cap or kiosk (a /v1 null-cap row — unusable for the burn leg)', () => {
    expect(key_candidates([row({ kiosk_cap_id: null })])).toEqual([])
    expect(key_candidates([row({ kiosk_id: undefined })])).toEqual([])
    expect(key_candidates([row({ id: '' })])).toEqual([])
  })

  it('preserves bag order across multiple key stacks, filtering non-keys between them', () => {
    const out = key_candidates([row({ id: '0xa' }), row({ item_category: 'x' }), row({ id: '0xb' })])
    expect(out.map((c) => c.id)).toEqual(['0xa', '0xb'])
  })

  it('tolerates a non-array bag (unloaded)', () => {
    expect(key_candidates(null)).toEqual([])
    expect(key_candidates(undefined)).toEqual([])
    expect(key_candidates(/** @type {any} */ ({}))).toEqual([])
  })
})
