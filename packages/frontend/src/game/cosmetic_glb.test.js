// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TR-97 — the mount RESOLUTION state machine (the pure half of the ride toggle): a mount is available to ride
// when the character has an item-like `.mount` slot (or the trailer `?mount=` dev override), else not; the GLB
// URL derives by convention from the template id. `../env` is mocked so the ASSETS_URL assertions are hermetic.
//
// bun's mock.module persists for the WHOLE test process (no un-mock API): every test file loaded after this
// one resolves src/env to THIS object. The mock must therefore mirror env.ts's FULL export surface — a missing
// export is a hard module-load error in whichever file imports it next (proven: item_detail_view.test.tsx died
// on RPC_URL in full-suite runs when this mock exported ASSETS_URL alone; the S-64 GAS_STATION_* pair went
// missing the same way — TWO consecutive missing-export load failures segfaulted the Bun 1.3.5 runtime in a
// full `bun test src` sweep, bisected 2026-07-10 (that pair has since been DELETED from env.ts — the
// station is server-side-only). Keep this object's keys in lockstep with env.ts's exports.)

import { afterEach, describe, expect, test, spyOn } from 'bun:test'
import { configure_assets } from '@aresrpg/sdk/jobs'

import '../test_helpers/env_mock.js'
import { set_pet_catalog_for_test } from './data/pet_catalog.js'
import { set_catalog_for_test as set_mob_catalog_for_test } from './data/mob_catalog.js'

// configure_assets has no test-reset seam (packages/sdk/src/jobs.js overwrites the aggregator with no
// way to clear it back) — an earlier-run file (asset_manifest.test.ts) leaves a test aggregator configured
// for the rest of the process (bun test runs every file in ONE process). The "re-homed onto the CDN" tests
// below expect the real default aggregator, so force it back before this file's tests run.
configure_assets({ aggregator: 'https://cdn.aresrpg.world' })
// #594's pet fallback resolves through the SAME mob-quilt asset_url join resolve_pet_model_url uses
// (pet_companion_resolver.test.js's own MOB_QUILT convention) — configure it here too rather than depend on
// another file having configured `classes.mob` first (classes only ever MERGE for the process lifetime, per
// the header note above, so this file's own pet-fallback tests must not assume load order).
configure_assets({ classes: { mob: { published: true } } })

const {
  is_mount_item,
  models_dev_url,
  cosmetic_glb_url,
  read_worn_templates,
  resolve_mount,
  pet_mount_hint_visible,
  worn_dev_url,
  resolve_worn_cosmetics,
} = await import('./cosmetic_glb.js')

test('read_worn_templates retries one transient catalog failure', async () => {
  const client = await import('../rpc/client')
  let calls = 0
  const read = spyOn(client, 'get_encyclopedia').mockImplementation(async () => {
    calls += 1
    if (calls === 1) throw new Error('transient catalog read')
    return { items: [{ template_id: '0xtemplate', name: 'Berserker Helm' }] }
  })
  try {
    expect(await read_worn_templates()).toEqual(
      new Map([['0xtemplate', { template_id: '0xtemplate', name: 'Berserker Helm' }]])
    )
    expect(read).toHaveBeenCalledTimes(2)
  } finally {
    read.mockRestore()
  }
})

describe('is_mount_item — category vocab', () => {
  test('category "mount" (any case) is a mount', () => {
    expect(is_mount_item({ category: 'mount' })).toBe(true)
    expect(is_mount_item({ category: 'Mount' })).toBe(true)
    expect(is_mount_item({ type: 'mount' })).toBe(true)
    expect(is_mount_item({ item_type: 'mount' })).toBe(true)
  })
  test('anything else / non-object is not a mount', () => {
    expect(is_mount_item({ category: 'hat' })).toBe(false)
    expect(is_mount_item({})).toBe(false)
    expect(is_mount_item(null)).toBe(false)
    expect(is_mount_item('mount')).toBe(false)
  })
})

describe('models_dev_url — repo ./models GLB resolution (trailer path)', () => {
  test('a bare name → a pet-folder mount', () => {
    expect(models_dev_url('suicune')).toBe('/models/pet/suicune.glb')
  })
  test('an explicit models-relative path passes through (leading slash stripped)', () => {
    expect(models_dev_url('pet/suicune.glb')).toBe('/models/pet/suicune.glb')
    expect(models_dev_url('equipment/drakar.glb')).toBe('/models/equipment/drakar.glb')
    expect(models_dev_url('/pet/suicune.glb')).toBe('/models/pet/suicune.glb')
  })
  test('empty → null', () => {
    expect(models_dev_url('')).toBe(null)
    expect(models_dev_url(null)).toBe(null)
  })
})

describe('cosmetic_glb_url — identifier-derived served URL', () => {
  test('builds ${ASSETS}/cosmetics/<id>.glb', () => {
    expect(cosmetic_glb_url('mount_suicune')).toBe('https://cdn.test/cosmetics/mount_suicune.glb')
  })
  test('empty id → null', () => {
    expect(cosmetic_glb_url('')).toBe(null)
  })
})

describe('resolve_mount — availability state machine', () => {
  test('an item-like `.mount` slot → available, glb by convention (equip source)', () => {
    const r = resolve_mount({ id: 'c1', mount: { id: 'm1', template_id: 'mount_suicune' } }, '')
    expect(r.available).toBe(true)
    expect(r.source).toBe('equip')
    expect(r.glb_url).toBe('https://cdn.test/cosmetics/mount_suicune.glb')
  })
  test("an item's own glb ref wins over the convention", () => {
    const r = resolve_mount({ id: 'c1', mount: { id: 'm1', glb: '/models/pet/zot.glb' } }, '')
    expect(r.glb_url).toBe('/models/pet/zot.glb')
  })
  test("an item's Walrus-shaped blob ref is still re-homed onto the CDN (old minted Display data)", () => {
    const r = resolve_mount(
      {
        id: 'c1',
        mount: {
          id: 'm1',
          glb: 'https://raw-origin.example/v1/blobs/by-quilt-id/MOUNT_Q/zot.glb',
        },
      },
      ''
    )
    expect(r.glb_url).toBe('https://cdn.aresrpg.world/v1/blobs/by-quilt-id/MOUNT_Q/zot.glb')
  })
  test("an item's arbitrary absolute glb ref is ALSO re-homed onto the CDN — any host, not just Walrus (#650)", () => {
    // The old guard only recognized a `/v1/blobs/` marker and discarded anything else, falling through to
    // the template convention. The new guard re-homes ANY absolute origin (host-confinement, not a
    // Walrus-specific shape) — an attacker-hosted origin can never survive, but it no longer needs to BE
    // Walrus-shaped for that property to hold.
    const r = resolve_mount(
      { id: 'c1', mount: { id: 'm1', template_id: 'mount_zot', glb: 'https://legacy-origin.example/zot.glb' } },
      ''
    )
    expect(r.glb_url).toBe('https://cdn.aresrpg.world/zot.glb')
  })
  test("an item's OWN object address is NEVER used as the art key (owner ruling: one image per type, never per address)", () => {
    // No template_id / item_type on the equipped mount — only its live Sui object id (a short stand-in
    // here, same 'm1' shape the other cases in this describe use; the real read-model id is a 0x address).
    // Before the fix this fell through to `item?.id`, building a garbage per-instance URL
    // (.../cosmetics/<id>.glb) that could never resolve; the honest behavior is no art, never a wrong request.
    const r = resolve_mount({ id: 'c1', mount: { id: 'm1' } }, '')
    expect(r.available).toBe(true)
    expect(r.glb_url).toBeNull()
  })
  test('no mount / empty / null → not available (never throws)', () => {
    expect(resolve_mount({ id: 'c1' }, '').available).toBe(false)
    expect(resolve_mount({ id: 'c1', mount: null }, '').available).toBe(false)
    expect(resolve_mount(null, '').available).toBe(false)
    // a stray scalar in the slot never grants a mount (mirrors the mount_speed item-like gate)
    expect(resolve_mount({ id: 'c1', mount: 1 }, '').available).toBe(false)
  })
})

// #594 RED-FIRST: pressing the mount key with an equipped pet companion out said "no mount to ride" — the
// resolver only ever looked at the `.mount` equip slot (inert pre-republish), never the pet. Fixed by
// falling back to resolve_pet_companion's own catalog join (the SAME one the trailing-companion rig uses).
describe('resolve_mount — pet fallback (#594: the pet is BOTH a companion AND a mountable ride)', () => {
  afterEach(() => {
    set_pet_catalog_for_test()
    set_mob_catalog_for_test()
  })

  test('no dedicated mount equipped, an active pet resolves as the ride target — source "pet"', () => {
    set_mob_catalog_for_test({ bouloute: { appearance: 'Lamb', glb: 'hy_lamb' } })
    const r = resolve_mount({ id: 'c1', pet_equipped: true, pet: { item_id: '0xa004', slug: 'pet_bouloute' } }, '')
    expect(r.available).toBe(true)
    expect(r.source).toBe('pet')
    expect(r.glb_url).toContain('hy_lamb')
  })

  test('a dedicated equipped mount still wins over an active pet (equip stays authoritative)', () => {
    set_mob_catalog_for_test({ bouloute: { appearance: 'Lamb', glb: 'hy_lamb' } })
    const r = resolve_mount(
      {
        id: 'c1',
        mount: { id: 'm1', template_id: 'mount_suicune' },
        pet_equipped: true,
        pet: { item_id: '0xa004', slug: 'pet_bouloute' },
      },
      ''
    )
    expect(r.source).toBe('equip')
  })

  test('pet_equipped but the slug has no catalog entry -> still unavailable (no placeholder mount)', () => {
    const r = resolve_mount({ id: 'c1', pet_equipped: true, pet: { item_id: '0xa004', slug: 'pet_unknown_xyz' } }, '')
    expect(r.available).toBe(false)
    expect(r.glb_url).toBeNull()
  })

  test('no mount, no pet -> still unavailable (regression guard on the pre-#594 behavior)', () => {
    expect(resolve_mount({ id: 'c1' }, '').available).toBe(false)
  })
})

describe('pet_mount_hint_visible — the [X] world-hint arm condition (#594)', () => {
  afterEach(() => {
    set_pet_catalog_for_test()
    set_mob_catalog_for_test()
  })

  const with_pet = { id: 'c1', pet_equipped: true, pet: { item_id: '0xa004', slug: 'pet_bouloute' } }

  test('an active, resolvable pet while grounded and out of a fight -> visible', () => {
    set_mob_catalog_for_test({ bouloute: { appearance: 'Lamb', glb: 'hy_lamb' } })
    expect(pet_mount_hint_visible(with_pet, false, false, '')).toBe(true)
  })

  test('already riding -> hidden even with an active pet (no dead re-prompt mid-ride)', () => {
    set_mob_catalog_for_test({ bouloute: { appearance: 'Lamb', glb: 'hy_lamb' } })
    expect(pet_mount_hint_visible(with_pet, true, false, '')).toBe(false)
  })

  test('mid-fight -> hidden (mount_up refuses mid-fight; a hint there would be a dead click)', () => {
    set_mob_catalog_for_test({ bouloute: { appearance: 'Lamb', glb: 'hy_lamb' } })
    expect(pet_mount_hint_visible(with_pet, false, true, '')).toBe(false)
  })

  test('no active pet -> hidden', () => {
    expect(pet_mount_hint_visible({ id: 'c1' }, false, false, '')).toBe(false)
  })

  test('a dedicated equipped mount with no pet -> hidden (this hint is pet-specific copy only)', () => {
    const r = pet_mount_hint_visible({ id: 'c1', mount: { id: 'm1', template_id: 'mount_suicune' } }, false, false, '')
    expect(r).toBe(false)
  })
})

describe('worn_dev_url — DEV worn-slot override → served /models GLB', () => {
  test('a bare slug → the shop-cosmetic equipment folder', () => {
    expect(worn_dev_url('sui_helmet')).toBe('/models/equipment/sui_helmet.glb')
  })
  test('an explicit models-relative .glb path streams verbatim', () => {
    expect(worn_dev_url('equipment/cape_fuwa.glb')).toBe('/models/equipment/cape_fuwa.glb')
    expect(worn_dev_url('equipment/solomonk.glb')).toBe('/models/equipment/solomonk.glb')
  })
  test('a same-origin absolute served path passes through; empty → null', () => {
    expect(worn_dev_url('/sui_helmet.glb')).toBe('/sui_helmet.glb')
    expect(worn_dev_url('')).toBe(null)
    expect(worn_dev_url(null)).toBe(null)
  })
  test('a full external URL is ALSO re-homed onto the CDN — the host-confinement guard applies here too (#650)', () => {
    expect(worn_dev_url('https://cdn.test/cosmetics/x.glb')).toBe('https://cdn.aresrpg.world/cosmetics/x.glb')
  })
})

describe('resolve_worn_cosmetics — equipped hat/cloak GLBs (live via the /v1 worn slots rpc_to_card spreads)', () => {
  test('hat + cloak resolve to their convention GLB urls (the /v1 worn-slot shape: { item_id, template_id, category })', () => {
    const r = resolve_worn_cosmetics({
      id: 'c1',
      hat: { item_id: '0xhat', template_id: 'solomonk', category: 'hat' },
      cloak: { item_id: '0xcloak', template_id: 'cape_kamui', category: 'cloak' },
    })
    expect(r).toEqual({
      head: { url: 'https://cdn.test/cosmetics/solomonk.glb', variant: null },
      back: { url: 'https://cdn.test/cosmetics/cape_kamui.glb', variant: null },
    })
  })
  test('the cosmetic_* on-chain vocab resolves too (cosmetic_hat / cosmetic_helmet / cosmetic_cloak)', () => {
    expect(resolve_worn_cosmetics({ id: 'c1', cosmetic_helmet: { id: 'drakar' } }).head).toEqual({
      url: 'https://cdn.test/cosmetics/drakar.glb',
      variant: null,
    })
    expect(resolve_worn_cosmetics({ id: 'c1', cosmetic_cloak: { id: 'cape_kamui' } }).back).toEqual({
      url: 'https://cdn.test/cosmetics/cape_kamui.glb',
      variant: null,
    })
  })
  test('combat gear NEVER resolves a worn GLB (helmet/weapon = the vanilla appearance system, not a worn hat)', () => {
    const r = resolve_worn_cosmetics({ id: 'c1', helmet: { id: 'iron_helm' }, weapon: { id: 'longsword' } })
    expect(r).toEqual({ head: null, back: null })
  })
  test('no equipped slots / null character → every slot null (a character with no worn cosmetics)', () => {
    expect(resolve_worn_cosmetics({ id: 'c1' })).toEqual({ head: null, back: null })
    expect(resolve_worn_cosmetics(null)).toEqual({ head: null, back: null })
  })
  test('an item with no identity field resolves nothing (no placeholder — loud-fail is at load)', () => {
    expect(resolve_worn_cosmetics({ id: 'c1', hat: { foo: 'bar' } }).head).toBe(null)
  })
})

describe('resolve_worn_cosmetics — ?equip dev override (js/remote-property-injection hardening)', () => {
  // The `?equip=` slot key comes straight from location.search — a remotely-influenced property
  // name (codeql js/remote-property-injection at the spec[] write). Only the two rig slots may
  // ever be honored; any other key must be inert: no own-property write, no override hijack.
  const live_char = { id: 'c1', hat: { item_id: '0xhat', template_id: 'solomonk', category: 'hat' } }
  const with_dev = (fn) => {
    process.env.DEV = '1'
    try {
      return fn()
    } finally {
      delete process.env.DEV
    }
  }

  test('a legit ?equip override still applies to both slots (the QA path)', () => {
    const r = with_dev(() =>
      resolve_worn_cosmetics(live_char, new Map(), '?equip=head:sui_helmet,back:equipment/cape_fuwa.glb')
    )
    expect(r).toEqual({
      head: { url: '/models/equipment/sui_helmet.glb', variant: null },
      back: { url: '/models/equipment/cape_fuwa.glb', variant: null },
    })
  })

  test('an attacker-shaped slot key is inert — it neither writes a property nor suppresses the live path', () => {
    // Pre-fix, spec['constructor'] = 'pwn' materialized an own property, engaged the override
    // gate, and returned EMPTY cosmetics for a character with a live hat.
    const r = with_dev(() => resolve_worn_cosmetics(live_char, new Map(), '?equip=constructor:pwn'))
    expect(r.head).toEqual({ url: 'https://cdn.test/cosmetics/solomonk.glb', variant: null })
  })

  test('__proto__ can never pollute Object.prototype through the equip query', () => {
    const r = with_dev(() =>
      resolve_worn_cosmetics(live_char, new Map(), '?equip=__proto__:pwn,head:sui_helmet')
    )
    expect(/** @type {any} */ ({}).pwn).toBeUndefined()
    expect(r.head).toEqual({ url: '/models/equipment/sui_helmet.glb', variant: null })
  })

  test('DEV off: the query is inert and the live equip renders (prod ignores ?equip entirely)', () => {
    const r = resolve_worn_cosmetics(live_char, new Map(), '?equip=head:sui_helmet')
    expect(r.head).toEqual({ url: 'https://cdn.test/cosmetics/solomonk.glb', variant: null })
  })
})

// The rig reads "is this mount ridden airborne" from the MODEL (here, one home with the world-height table),
// not from live flight state — so BOTH rider paths get it: the local pilot's dragon (embed_voxel_player's
// mount_dragon) and a peer's dragon rebuilt from the p2p `mount_glb` broadcast (remote_players), which
// carries no flight flag at all. mount_rig.js turns it into the fly-clip preference (see its #370 fixture).
describe('mount_is_flight — which mounts are ridden in the air', () => {
  test('every fast-travel dragon skin is a flight mount, whatever URL shape it arrives in', async () => {
    const { mount_is_flight } = await import('./cosmetic_glb.js')
    expect(mount_is_flight('https://assets.aresrpg.world/models/mobs/dragon-fire.glb')).toBe(true)
    expect(mount_is_flight('/sprites/mobs/models/dragon-frost.glb?v=2')).toBe(true)
    expect(mount_is_flight('/models/pet/DRAGON-VOID.GLB')).toBe(true)
  })
  test('ground mounts, unknown models and empty ids are not flight mounts', async () => {
    const { mount_is_flight } = await import('./cosmetic_glb.js')
    expect(mount_is_flight('/models/pet/corbac.glb')).toBe(false)
    expect(mount_is_flight('/cosmetics/mystery_mount.glb')).toBe(false)
    expect(mount_is_flight('')).toBe(false)
    expect(mount_is_flight(null)).toBe(false)
  })
})

describe('mount_target_height — per-mount world-size normalisation table', () => {
  test('resolves the file stem from any URL shape (dev models path, cosmetics CDN, query)', async () => {
    const { mount_target_height, MOUNT_TABLE } = await import('./cosmetic_glb.js')
    expect(mount_target_height('/models/pet/corbac.glb')).toBe(MOUNT_TABLE.corbac)
    expect(mount_target_height('https://cdn.test/cosmetics/siluri.glb?v=3')).toBe(MOUNT_TABLE.siluri)
    expect(mount_target_height('/models/pet/SUICUNE.GLB')).toBe(MOUNT_TABLE.suicune)
  })
  test('unknown / empty ids fall back to MOUNT_FALLBACK_H', async () => {
    const { mount_target_height, MOUNT_FALLBACK_H } = await import('./cosmetic_glb.js')
    expect(mount_target_height('/cosmetics/mystery_mount.glb')).toBe(MOUNT_FALLBACK_H)
    expect(mount_target_height('')).toBe(MOUNT_FALLBACK_H)
    expect(mount_target_height(null)).toBe(MOUNT_FALLBACK_H)
  })
  test('every non-dragon table height is a sane rideable size (0.8–2.2 blocks)', async () => {
    const { MOUNT_TABLE } = await import('./cosmetic_glb.js')
    for (const [key, h] of Object.entries(MOUNT_TABLE)) {
      if (key.startsWith('dragon-')) continue // the fast-travel dragons are the deliberate exception below
      expect(h).toBeGreaterThanOrEqual(0.8)
      expect(h).toBeLessThanOrEqual(2.2)
    }
  })
  // #175 second live report: "the dragon should read a bit bigger than current" — RED before the fix
  // (dragons sat at the same 2.2 ceiling as every other mount); GREEN once they're a deliberate ~1.3-1.5×
  // exception, still bounded so a future tune can't drift it into "comical" territory unnoticed.
  test('the fast-travel dragons read bigger than the old 2.2 ceiling — ~1.3-1.5× (#175)', async () => {
    const { MOUNT_TABLE } = await import('./cosmetic_glb.js')
    const OLD_DRAGON_H = 2.2 // the pre-#175 height every dragon variant shared with the rest of the table
    for (const key of ['dragon-fire', 'dragon-frost', 'dragon-void']) {
      const h = MOUNT_TABLE[key]
      const ratio = h / OLD_DRAGON_H
      expect(ratio).toBeGreaterThanOrEqual(1.3)
      expect(ratio).toBeLessThanOrEqual(1.5)
    }
  })
})
