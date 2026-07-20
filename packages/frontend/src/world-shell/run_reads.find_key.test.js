// Dungeon-ENTRY key resolution: the ~10s-stall fast path + its /v1 refetch-then-refuse fallback (V1 sweep —
// the old O(kiosks×items) live kiosk walk `find_key_item` is DELETED; NO chain-direct kiosk scan remains).
//
// SINGLE SOURCE (P0: `0x2::kiosk::list` code 11 EItemNotFound observed on ENTER): the key id and the kiosk
// that holds it MUST ride together — the burn leg (`extract::extract_for_burn` → `kiosk.list<Item>`) aborts
// EItemNotFound the instant it lists the key against a kiosk that doesn't hold it. Every candidate carries the
// whole {id, kiosk_id, kiosk_cap_id} triple (key_candidates threads it off the /v1 owner-items row), so no
// second source can point the burn leg elsewhere.
//
// FAST PATH (a live regression: "Entering the dungeon… ~10s, this is a violation"): resolve_entry_key verifies an
// already-held bag candidate with ONE read. On an empty/stale bag it does ONE injected /v1 refetch of owned
// items (get_owned_items → fresh candidates), verifies once more, then honestly refuses (null) — never a live
// kiosk walk. Pure injection (sdk + refetch are params), zero mock.module (process-global collision law).

import { describe, expect, it } from 'bun:test'

import { resolve_entry_key } from './run_reads.js'

const ADDR = '0xowner'
const KEY_TEMPLATE = '0xkeytemplate'

const KIOSK_A = '0xkioskA',
  CAP_A = '0xcapA'
const KIOSK_KEY = '0xkioskKey',
  CAP_KEY = '0xcapKey'
const KEY_ID = '0xkeyitem',
  STALE_ID = '0xstalekey'

const KEY_ROW = { id: KEY_ID, kiosk_id: KIOSK_KEY, kiosk_cap_id: CAP_KEY }

/**
 * @param {Record<string,string>} templates objectId → on-chain template id (the per-candidate verify read)
 * @param {{ getOwnedKiosks: number, getKiosk: number, getObject: number }} [spy] call counters
 */
function make_sdk(templates, spy) {
  const bump = (/** @type {string} */ k) => spy && (spy[k] += 1)
  return {
    // kiosk_client present ONLY to PROVE the deleted live scan never touches it — every counter must stay 0.
    kiosk_client: {
      getOwnedKiosks: async () => {
        bump('getOwnedKiosks')
        return { kioskOwnerCaps: [] }
      },
      getKiosk: async () => {
        bump('getKiosk')
        return { items: [] }
      },
    },
    grpc_client: {
      core: {
        // singular — read_object (resolve_entry_key's per-candidate verify)
        getObject: async ({ objectId }) => {
          bump('getObject')
          return { object: { json: { template: templates[objectId] ?? '0xnope' } } }
        },
      },
    },
  }
}

const fresh_spy = () => ({ getOwnedKiosks: 0, getKiosk: 0, getObject: 0 })

describe('resolve_entry_key (bag fast path → /v1 refetch-then-refuse; NO live kiosk walk)', () => {
  it('verifies a fresh bag candidate with ONE read; NEVER refetches, NEVER walks kiosks', async () => {
    const spy = fresh_spy()
    const sdk = make_sdk({ [KEY_ID]: KEY_TEMPLATE }, spy)
    let refetched = 0
    const refetch = async () => {
      refetched += 1
      return []
    }
    const key = await resolve_entry_key(sdk, {
      address: ADDR,
      key_template: KEY_TEMPLATE,
      candidates: [KEY_ROW],
      refetch,
    })
    expect(key).toEqual(KEY_ROW)
    expect(spy.getObject).toBe(1) // exactly ONE verify read
    expect(refetched).toBe(0) // fast path — the refetch never fires
    expect(spy.getOwnedKiosks).toBe(0) // the deleted live scan never runs
    expect(spy.getKiosk).toBe(0)
  })

  it('a STALE candidate → ONE /v1 refetch → re-derived fresh candidate verifies (no kiosk walk)', async () => {
    const spy = fresh_spy()
    // the held candidate id now reads a DIFFERENT template (moved/consumed since load_roster) — the /v1 refetch
    // surfaces the TRUE key row.
    const sdk = make_sdk({ [STALE_ID]: '0xstaletemplate', [KEY_ID]: KEY_TEMPLATE }, spy)
    let refetched = 0
    const refetch = async () => {
      refetched += 1
      return [KEY_ROW]
    }
    const stale = [{ id: STALE_ID, kiosk_id: KIOSK_A, kiosk_cap_id: CAP_A }]
    const key = await resolve_entry_key(sdk, { key_template: KEY_TEMPLATE, candidates: stale, refetch })
    expect(key).toEqual(KEY_ROW) // the refetched row's TRUE kiosk
    expect(refetched).toBe(1) // refetched EXACTLY once
    expect(spy.getObject).toBe(2) // stale verify (1) + fresh verify (1)
    expect(spy.getOwnedKiosks).toBe(0) // never the live kiosk walk
    expect(spy.getKiosk).toBe(0)
  })

  it('no bag candidates (empty/dev-rig bag) → /v1 refetch → found', async () => {
    const spy = fresh_spy()
    const sdk = make_sdk({ [KEY_ID]: KEY_TEMPLATE }, spy)
    let refetched = 0
    const refetch = async () => {
      refetched += 1
      return [KEY_ROW]
    }
    const key = await resolve_entry_key(sdk, { key_template: KEY_TEMPLATE, candidates: [], refetch })
    expect(key).toEqual(KEY_ROW)
    expect(refetched).toBe(1) // nothing to verify pre-refetch → straight to the refetch
    expect(spy.getObject).toBe(1) // one verify, post-refetch
    expect(spy.getOwnedKiosks).toBe(0)
    expect(spy.getKiosk).toBe(0)
  })

  it('stale candidate + refetch STILL finds no key → null (honest refuse, no kiosk walk, no loop)', async () => {
    const spy = fresh_spy()
    // both the held row AND the refetched row fail the template re-read (all-stale / genuinely keyless).
    const sdk = make_sdk({ [STALE_ID]: '0xstale', [KEY_ID]: '0xnotthekey' }, spy)
    let refetched = 0
    const refetch = async () => {
      refetched += 1
      return [KEY_ROW]
    }
    const stale = [{ id: STALE_ID, kiosk_id: KIOSK_A, kiosk_cap_id: CAP_A }]
    const key = await resolve_entry_key(sdk, { key_template: KEY_TEMPLATE, candidates: stale, refetch })
    expect(key).toBeNull()
    expect(refetched).toBe(1) // refetched exactly once — never twice, never a retry loop
    expect(spy.getObject).toBe(2) // one stale verify + one post-refetch verify
    expect(spy.getOwnedKiosks).toBe(0)
    expect(spy.getKiosk).toBe(0)
  })

  it('no refetch provided + stale bag → null (pure candidate verify — back-compat)', async () => {
    const spy = fresh_spy()
    const sdk = make_sdk({ [STALE_ID]: '0xstale' }, spy)
    const stale = [{ id: STALE_ID, kiosk_id: KIOSK_A, kiosk_cap_id: CAP_A }]
    const key = await resolve_entry_key(sdk, { key_template: KEY_TEMPLATE, candidates: stale })
    expect(key).toBeNull()
    expect(spy.getObject).toBe(1) // one verify, then a straight null (no refetch wired)
    expect(spy.getOwnedKiosks).toBe(0)
    expect(spy.getKiosk).toBe(0)
  })
})
