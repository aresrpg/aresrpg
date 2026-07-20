// RED-FIRST (COSMETICS TRANSPORT RULING): cosmetics are not trusted over WebRTC — they load from the rpc
// directly. Proves the peer-worn cache resolves a peer's hat/cloak from a /v1/characters row (the
// SAME shape views.js's handle_characters serves — worn keyed by category {item_id,template_id,category})
// joined against a /v1/encyclopedia template catalog, batches every stale id into ONE fetch, respects the TTL,
// and never latches an absence permanently. No p2p payload appears anywhere in this seam.

import { describe, expect, it } from 'bun:test'

import '../test_helpers/env_mock.js'

const { create_remote_worn_cache } = await import('./remote_worn_cosmetics.js')

const HAT_TEMPLATE = '0xhat_template'
const CLOAK_TEMPLATE = '0xcloak_template'
// Explicit `appearance` (the "Future/read-authoring shape" worn_model_of already special-cases) — decoupled
// from the real seed's name→icon lookup table, so this suite never drifts if the live catalog changes.
const TEMPLATES = new Map([
  [HAT_TEMPLATE, { template_id: HAT_TEMPLATE, appearance: 'sui_helmet' }],
  [CLOAK_TEMPLATE, { template_id: CLOAK_TEMPLATE, appearance: 'cape_fuwa', variant: 'black' }],
])

// A captured/real `/v1/characters` row shape (views.js handle_characters): `worn` is keyed by CATEGORY, each
// slot {item_id, template_id, category} — NOT the engine's {head,back}/{url,variant} shape. resolve_worn_cosmetics
// (cosmetic_glb.js) is the ONE join between the two; this cache must reuse it verbatim, never a second mapping.
const CAPTURED_ROW = (id) => ({
  id,
  worn: {
    hat: { item_id: '0xitem_hat', template_id: HAT_TEMPLATE, category: 'hat' },
    cloak: { item_id: '0xitem_cloak', template_id: CLOAK_TEMPLATE, category: 'cloak' },
  },
})

describe('create_remote_worn_cache — peer worn cosmetics resolve from /v1, never the p2p payload', () => {
  it('resolves a peer id to its {head,back} rig slots off a mocked /v1 characters + encyclopedia join', async () => {
    const calls = []
    const fetch_characters = async ({ ids }) => {
      calls.push(ids)
      return ids.map(CAPTURED_ROW)
    }
    const cache = create_remote_worn_cache({ fetch_characters, templates: () => TEMPLATES })

    // Before any refresh: a genuinely unknown peer renders bare (never blocks the frame loop on a pending read).
    expect(cache.worn_of('0xPEER')).toEqual({ head: null, back: null })

    await cache.refresh(['0xPEER'])
    expect(calls).toEqual([['0xPEER']]) // ONE batched /v1 read, no per-frame spam
    expect(cache.worn_of('0xPEER')).toEqual({
      head: { url: 'https://cdn.test/cosmetics/sui_helmet.glb', variant: null },
      back: { url: 'https://cdn.test/cosmetics/cape_fuwa.glb', variant: 'black' },
    })
  })

  it('batches every stale id across ONE refresh call — never one fetch per peer', async () => {
    const calls = []
    const fetch_characters = async ({ ids }) => {
      calls.push([...ids])
      return ids.map(CAPTURED_ROW)
    }
    const cache = create_remote_worn_cache({ fetch_characters, templates: () => TEMPLATES })
    await cache.refresh(['0xA', '0xB', '0xC'])
    expect(calls).toHaveLength(1)
    expect(calls[0].sort()).toEqual(['0xA', '0xB', '0xC'])
  })

  it('a resolved entry is cached — a second refresh within the TTL fires no network call', async () => {
    let hits = 0
    const fetch_characters = async ({ ids }) => {
      hits += 1
      return ids.map(CAPTURED_ROW)
    }
    let clock = 1_000
    const cache = create_remote_worn_cache({ fetch_characters, templates: () => TEMPLATES, now: () => clock })
    await cache.refresh(['0xPEER'])
    expect(hits).toBe(1)
    clock += 30_000 // well inside the 60s TTL
    await cache.refresh(['0xPEER'])
    expect(hits).toBe(1) // still cached — no re-fetch
  })

  it('TTL expiry refreshes a stale entry (~60s bound — a remote re-equip is never stuck forever)', async () => {
    let hits = 0
    const fetch_characters = async ({ ids }) => {
      hits += 1
      return ids.map(CAPTURED_ROW)
    }
    let clock = 1_000
    const cache = create_remote_worn_cache({ fetch_characters, templates: () => TEMPLATES, now: () => clock })
    await cache.refresh(['0xPEER'])
    expect(hits).toBe(1)
    clock += 61_000 // past the 60s TTL
    await cache.refresh(['0xPEER'])
    expect(hits).toBe(2)
  })

  it('concurrent refreshes for the SAME pending id never double-fetch', async () => {
    let hits = 0
    let resolve_fetch
    const fetch_characters = ({ ids }) => {
      hits += 1
      return new Promise((resolve) => {
        resolve_fetch = () => resolve(ids.map(CAPTURED_ROW))
      })
    }
    const cache = create_remote_worn_cache({ fetch_characters, templates: () => TEMPLATES })
    const first = cache.refresh(['0xPEER'])
    const second = cache.refresh(['0xPEER']) // fired while the first is still in flight
    resolve_fetch()
    await Promise.all([first, second])
    expect(hits).toBe(1)
  })

  it('never caches an absence permanently — a failed read never poisons the cache, and the SAME bounded TTL (not a stuck forever-null) governs the retry', async () => {
    // resolve_character_docs (character_name_resolve.js — the shared fetch home) swallows a network throw to
    // an empty Map by its OWN established contract ("a failed read degrades to an empty Map, never throws into
    // the caller" — reused verbatim, never re-specialized here). This cache cannot distinguish "network down"
    // from "genuinely no doc" at that boundary, so BOTH decay through the identical TTL clock — never an
    // unbounded/frozen absence (the kiosk-cache incident this law exists for), and never a same-tick retry
    // storm either (that would hammer the endpoint every animation frame during a real outage).
    let hits = 0
    const fetch_characters = async () => {
      hits += 1
      if (hits === 1) throw new Error('RPC_UNAVAILABLE')
      return [CAPTURED_ROW('0xPEER')]
    }
    let clock = 1_000
    const cache = create_remote_worn_cache({ fetch_characters, templates: () => TEMPLATES, now: () => clock })
    await cache.refresh(['0xPEER'])
    expect(cache.worn_of('0xPEER')).toEqual({ head: null, back: null }) // still bare — never a poisoned cache row
    clock += 61_000 // past the 60s TTL — the bound that makes this "never permanent"
    await cache.refresh(['0xPEER'])
    expect(hits).toBe(2) // retried once the TTL elapsed, not stuck forever
    expect(cache.worn_of('0xPEER')?.head).toBeTruthy()
  })

  it('a character with no equipped hat/cloak resolves an explicit {head:null,back:null}, not a cache miss', async () => {
    const fetch_characters = async ({ ids }) => ids.map((id) => ({ id, worn: {} }))
    const cache = create_remote_worn_cache({ fetch_characters, templates: () => TEMPLATES })
    await cache.refresh(['0xPEER'])
    expect(cache.worn_of('0xPEER')).toEqual({ head: null, back: null })
  })

  it('a doc genuinely missing from the /v1 response resolves bare, never throws', async () => {
    const cache = create_remote_worn_cache({ fetch_characters: async () => [], templates: () => TEMPLATES })
    await cache.refresh(['0xGHOST'])
    expect(cache.worn_of('0xGHOST')).toEqual({ head: null, back: null })
  })

  it('drop() forgets a despawned peer — bounds cache growth, a later re-sighting resolves fresh', async () => {
    let hits = 0
    const fetch_characters = async ({ ids }) => {
      hits += 1
      return ids.map(CAPTURED_ROW)
    }
    const cache = create_remote_worn_cache({ fetch_characters, templates: () => TEMPLATES })
    await cache.refresh(['0xPEER'])
    expect(hits).toBe(1)
    cache.drop('0xPEER')
    expect(cache.worn_of('0xPEER')).toEqual({ head: null, back: null })
    await cache.refresh(['0xPEER'])
    expect(hits).toBe(2) // dropped → treated as unseen, not "recently resolved"
  })
})
