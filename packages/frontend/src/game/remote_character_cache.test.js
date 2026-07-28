// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (TRANSPORT RULING): worn cosmetics, pet companions and the veteran-title aura are never taken from
// a peer's own word — all three load from the rpc directly. Proves the peer cache resolves a peer's hat/cloak AND equipped pet from the SAME
// /v1/characters row (the shape views.js's handle_characters serves — worn keyed by category
// {item_id,template_id,category}; pet/pet_equipped straight off character_pet_projection) in ONE fetch, batches
// every stale id, respects the TTL, and never latches an absence permanently. No peer-declared payload appears
// anywhere in this seam (#553's owner ruling: OWNERSHIP facts come from chain state, never a peer hint).

import { afterEach, describe, expect, it } from 'bun:test'
import { configure_assets } from '@aresrpg/sdk/jobs'

import '../test_helpers/env_mock.js'

import { _reset_log_for_test, get_log_buffer } from '../core/log.js'
import { set_catalog_for_test as set_mob_catalog_for_test } from './data/mob_catalog.js'
import { set_pet_catalog_for_test } from './data/pet_catalog.js'

const { create_remote_character_cache } = await import('./remote_character_cache.js')
const { has_veteran_title } = await import('./cosmetic_glb.js')

const HAT_TEMPLATE = '0xhat_template'
const CLOAK_TEMPLATE = '0xcloak_template'
// Explicit `appearance` (the "Future/read-authoring shape" worn_model_of already special-cases) — decoupled
// from the real seed's name→icon lookup table, so this suite never drifts if the live catalog changes.
const TEMPLATES = new Map([
  [HAT_TEMPLATE, { template_id: HAT_TEMPLATE, appearance: 'sui_helmet' }],
  [CLOAK_TEMPLATE, { template_id: CLOAK_TEMPLATE, appearance: 'cape_fuwa', variant: 'black' }],
])

// mob class config for pet_of — SAME registration pet_companion_resolver.test.js already makes (merge-only,
// process-shared per jobs.js's reset_assets_for_test doc — the identical values keep this idempotent
// regardless of bun test's file load order).
configure_assets({ aggregator: 'https://fake-assets', classes: { mob: { published: true }, cosmetic: { published: true } } })
const mob_url = (glb) => `https://fake-assets/models/mobs/${glb}.glb`

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

afterEach(() => {
  set_pet_catalog_for_test()
  set_mob_catalog_for_test()
  _reset_log_for_test()
})

describe('create_remote_character_cache — peer worn cosmetics resolve from /v1, never the p2p payload', () => {
  it('resolves a peer id to its {head,back} rig slots off a mocked /v1 characters + encyclopedia join', async () => {
    const calls = []
    const fetch_characters = async ({ ids }) => {
      calls.push(ids)
      return ids.map(CAPTURED_ROW)
    }
    const cache = create_remote_character_cache({ fetch_characters, templates: () => TEMPLATES })

    // Before any refresh: a genuinely unknown peer renders bare (never blocks the frame loop on a pending read).
    expect(cache.worn_of('0xPEER')).toEqual({ head: null, back: null })

    await cache.refresh(['0xPEER'])
    expect(calls).toEqual([['0xPEER']]) // ONE batched /v1 read, no per-frame spam
    expect(cache.worn_of('0xPEER')).toEqual({
      head: { url: 'https://fake-assets/models/cosmetics/sui_helmet.glb', variant: null },
      back: { url: 'https://fake-assets/models/cosmetics/cape_fuwa.glb', variant: 'black' },
    })
  })

  it('batches every stale id across ONE refresh call — never one fetch per peer', async () => {
    const calls = []
    const fetch_characters = async ({ ids }) => {
      calls.push([...ids])
      return ids.map(CAPTURED_ROW)
    }
    const cache = create_remote_character_cache({ fetch_characters, templates: () => TEMPLATES })
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
    const cache = create_remote_character_cache({ fetch_characters, templates: () => TEMPLATES, now: () => clock })
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
    const cache = create_remote_character_cache({ fetch_characters, templates: () => TEMPLATES, now: () => clock })
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
    const cache = create_remote_character_cache({ fetch_characters, templates: () => TEMPLATES })
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
    const cache = create_remote_character_cache({ fetch_characters, templates: () => TEMPLATES, now: () => clock })
    await cache.refresh(['0xPEER'])
    expect(cache.worn_of('0xPEER')).toEqual({ head: null, back: null }) // still bare — never a poisoned cache row
    clock += 61_000 // past the 60s TTL — the bound that makes this "never permanent"
    await cache.refresh(['0xPEER'])
    expect(hits).toBe(2) // retried once the TTL elapsed, not stuck forever
    expect(cache.worn_of('0xPEER')?.head).toBeTruthy()
  })

  it('a character with no equipped hat/cloak resolves an explicit {head:null,back:null}, not a cache miss', async () => {
    const fetch_characters = async ({ ids }) => ids.map((id) => ({ id, worn: {} }))
    const cache = create_remote_character_cache({ fetch_characters, templates: () => TEMPLATES })
    await cache.refresh(['0xPEER'])
    expect(cache.worn_of('0xPEER')).toEqual({ head: null, back: null })
  })

  it('a doc genuinely missing from the /v1 response resolves bare, never throws', async () => {
    const cache = create_remote_character_cache({ fetch_characters: async () => [], templates: () => TEMPLATES })
    await cache.refresh(['0xGHOST'])
    expect(cache.worn_of('0xGHOST')).toEqual({ head: null, back: null })
  })

  it('drop() forgets a despawned peer — bounds cache growth, a later re-sighting resolves fresh', async () => {
    let hits = 0
    const fetch_characters = async ({ ids }) => {
      hits += 1
      return ids.map(CAPTURED_ROW)
    }
    const cache = create_remote_character_cache({ fetch_characters, templates: () => TEMPLATES })
    await cache.refresh(['0xPEER'])
    expect(hits).toBe(1)
    cache.drop('0xPEER')
    expect(cache.worn_of('0xPEER')).toEqual({ head: null, back: null })
    await cache.refresh(['0xPEER'])
    expect(hits).toBe(2) // dropped → treated as unseen, not "recently resolved"
  })
})

describe('create_remote_character_cache — pet_of resolves a peer\'s equipped pet from the SAME /v1 doc (#553)', () => {
  const PET_ROW = (id, slug) => ({
    id,
    pet_equipped: true,
    pet: { item_id: '0xitem_pet', template_id: '0xtpl_pet', slug },
  })

  it("resolves a peer's equipped pet to spawn+glb_url through the SAME catalog resolver the local companion uses", async () => {
    set_mob_catalog_for_test({ bouloute: { appearance: 'Lamb', glb: 'hy_lamb' } })
    const cache = create_remote_character_cache({
      fetch_characters: async ({ ids }) => ids.map((id) => PET_ROW(id, 'pet_bouloute')),
      templates: () => TEMPLATES,
    })
    // Before any refresh: unresolved peer renders bare — no placeholder, never blocks the frame loop.
    expect(cache.pet_of('0xPEER')).toEqual({ spawn: false, glb_url: null, key: null })
    await cache.refresh(['0xPEER'])
    expect(cache.pet_of('0xPEER')).toEqual({ spawn: true, glb_url: mob_url('hy_lamb'), key: 'pet_bouloute' })
  })

  it('pet_equipped: false -> no-spawn even with a stale pet object still on the doc', async () => {
    const cache = create_remote_character_cache({
      fetch_characters: async ({ ids }) =>
        ids.map((id) => ({
          id,
          pet_equipped: false,
          pet: { item_id: '0xa', template_id: '0xb', slug: 'pet_bouloute' },
        })),
    })
    await cache.refresh(['0xPEER'])
    expect(cache.pet_of('0xPEER')).toEqual({ spawn: false, glb_url: null, key: null })
  })

  it('a doc carrying no pet slot at all -> no-spawn, never throws', async () => {
    const cache = create_remote_character_cache({ fetch_characters: async ({ ids }) => ids.map((id) => ({ id })) })
    await cache.refresh(['0xPEER'])
    expect(cache.pet_of('0xPEER')).toEqual({ spawn: false, glb_url: null, key: null })
  })

  it('an unresolvable slug (no catalog row anywhere) -> no-spawn, logged once — the no-silent-substitute law', async () => {
    const cache = create_remote_character_cache({
      fetch_characters: async ({ ids }) => ids.map((id) => PET_ROW(id, 'pet_totally_unknown_peer_slug')),
    })
    await cache.refresh(['0xPEER'])
    expect(cache.pet_of('0xPEER')).toEqual({ spawn: false, glb_url: null, key: null })
    const entries = get_log_buffer()
    expect(entries.some((e) => e.ns === 'pet' && e.message.includes('pet_totally_unknown_peer_slug'))).toBe(true)
  })

  it('an unequip folds away — a later refresh past the TTL clears a previously-spawned companion', async () => {
    set_mob_catalog_for_test({ modni_lyk: { appearance: 'Cat_Viki', glb: 'hy_cat_viki' } })
    let equipped = true
    let clock = 1_000
    const cache = create_remote_character_cache({
      fetch_characters: async ({ ids }) =>
        ids.map((id) => (equipped ? PET_ROW(id, 'pet_modni_lyk') : { id, pet_equipped: false, pet: null })),
      now: () => clock,
    })
    await cache.refresh(['0xPEER'])
    expect(cache.pet_of('0xPEER').spawn).toBe(true)
    equipped = false
    clock += 61_000 // past the 60s TTL — the SAME bound worn_of's re-equip test already relies on
    await cache.refresh(['0xPEER'])
    expect(cache.pet_of('0xPEER')).toEqual({ spawn: false, glb_url: null, key: null })
  })

  it("drop() forgets a despawned peer's pet too", async () => {
    set_mob_catalog_for_test({ bouloute: { appearance: 'Lamb', glb: 'hy_lamb' } })
    const cache = create_remote_character_cache({
      fetch_characters: async ({ ids }) => ids.map((id) => PET_ROW(id, 'pet_bouloute')),
    })
    await cache.refresh(['0xPEER'])
    expect(cache.pet_of('0xPEER').spawn).toBe(true)
    cache.drop('0xPEER')
    expect(cache.pet_of('0xPEER')).toEqual({ spawn: false, glb_url: null, key: null })
  })

  it('ONE /v1 fetch drives BOTH worn_of and pet_of — never a second batched-fetch cache for the same doc', async () => {
    set_mob_catalog_for_test({ bouloute: { appearance: 'Lamb', glb: 'hy_lamb' } })
    let hits = 0
    const cache = create_remote_character_cache({
      fetch_characters: async ({ ids }) => {
        hits += 1
        return ids.map((id) => ({ ...CAPTURED_ROW(id), ...PET_ROW(id, 'pet_bouloute') }))
      },
      templates: () => TEMPLATES,
    })
    await cache.refresh(['0xPEER'])
    expect(hits).toBe(1)
    expect(cache.worn_of('0xPEER').head).toBeTruthy()
    expect(cache.pet_of('0xPEER')).toEqual({ spawn: true, glb_url: mob_url('hy_lamb'), key: 'pet_bouloute' })
  })
})

// TR-5 — the remote veteran aura used to ride the peer's SELF-DECLARED p2p `state` payload; with the p2p
// transport gone it resolves where it always belonged: the equipped `title` slot of the SAME /v1 doc, through
// the SAME gate the local player reads (cosmetic_glb.js's has_veteran_title — one home, two consumers). A peer
// can no longer claim an aura it does not own.
describe('create_remote_character_cache — veteran_of resolves the aura gate from chain truth', () => {
  // The title item is not minted yet (crowdfund), so its wire shape is not pinnable from a capture. What IS
  // pinnable — and is the whole point of the move — is that the peer cache asks the SAME predicate the local
  // player asks, over the doc verbatim: no second, drifting copy of the rule. Every row below is asserted
  // against has_veteran_title directly, so this suite tracks the gate instead of freezing a guess about it.
  const ROWS = [
    { title: { item_type: 'title_veteran' } }, // the grant's own type identity
    { title: { name: 'Mark of the Unbroken' } }, // the display-name line
    { title: { item_type: 'title_fisher' } }, // an unrelated title
    { title: { id: '0xtitle_object', name: 'Mark of the Unbroken' } }, // id-first identity (see note below)
    {}, // no title slot at all
  ]

  it('mirrors has_veteran_title over the /v1 doc — one home for the rule, never a second copy', async () => {
    for (const row of ROWS) {
      const cache = create_remote_character_cache({
        fetch_characters: async ({ ids }) => ids.map((id) => ({ id, ...row })),
      })
      expect(cache.veteran_of('0xPEER')).toBe(false) // unresolved peers never flash an aura
      await cache.refresh(['0xPEER'])
      expect(cache.veteran_of('0xPEER')).toBe(has_veteran_title(row))
    }
  })

  it('a title-bearing peer lights the gate; an unrelated title and a bare doc never do', async () => {
    const cache_of = (row) =>
      create_remote_character_cache({ fetch_characters: async ({ ids }) => ids.map((id) => ({ id, ...row })) })
    const veteran = cache_of({ title: { item_type: 'title_veteran' } })
    const fisher = cache_of({ title: { item_type: 'title_fisher' } })
    const bare = cache_of({})
    await Promise.all([veteran.refresh(['0xPEER']), fisher.refresh(['0xPEER']), bare.refresh(['0xPEER'])])
    expect(veteran.veteran_of('0xPEER')).toBe(true)
    expect(fisher.veteran_of('0xPEER')).toBe(false)
    expect(bare.veteran_of('0xPEER')).toBe(false)
  })

  it('a removed title folds away past the TTL, and drop() forgets the aura too', async () => {
    let titled = true
    let clock = 1_000
    const cache = create_remote_character_cache({
      fetch_characters: async ({ ids }) =>
        ids.map((id) => (titled ? { id, title: { item_type: 'title_veteran' } } : { id })),
      now: () => clock,
    })
    await cache.refresh(['0xPEER'])
    expect(cache.veteran_of('0xPEER')).toBe(true)
    titled = false
    clock += 61_000
    await cache.refresh(['0xPEER'])
    expect(cache.veteran_of('0xPEER')).toBe(false)
    titled = true
    clock += 61_000
    await cache.refresh(['0xPEER'])
    expect(cache.veteran_of('0xPEER')).toBe(true)
    cache.drop('0xPEER')
    expect(cache.veteran_of('0xPEER')).toBe(false)
  })

  it('a failed read never latches an aura on or off — the same bounded TTL governs the retry', async () => {
    let hits = 0
    let clock = 1_000
    const cache = create_remote_character_cache({
      fetch_characters: async ({ ids }) => {
        hits += 1
        if (hits === 1) throw new Error('RPC_UNAVAILABLE')
        return ids.map((id) => ({ id, title: { item_type: 'title_veteran' } }))
      },
      now: () => clock,
    })
    await cache.refresh(['0xPEER'])
    expect(cache.veteran_of('0xPEER')).toBe(false)
    clock += 61_000
    await cache.refresh(['0xPEER'])
    expect(cache.veteran_of('0xPEER')).toBe(true)
  })
})
