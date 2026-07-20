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

import { describe, expect, test, spyOn } from 'bun:test'

import '../test_helpers/env_mock.js'

const {
  is_mount_item,
  models_dev_url,
  cosmetic_glb_url,
  read_worn_templates,
  resolve_mount,
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
  test("an item's Walrus blob ref is re-homed onto the CDN", () => {
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
    expect(r.glb_url).toBe('https://cdn.aresrpg.world/walrus/v1/blobs/by-quilt-id/MOUNT_Q/zot.glb')
  })
  test("an item's arbitrary absolute glb ref is discarded for the template convention", () => {
    const r = resolve_mount(
      { id: 'c1', mount: { id: 'm1', template_id: 'mount_zot', glb: 'https://legacy-origin.example/zot.glb' } },
      ''
    )
    expect(r.glb_url).toBe('https://cdn.test/cosmetics/mount_zot.glb')
  })
  test('no mount / empty / null → not available (never throws)', () => {
    expect(resolve_mount({ id: 'c1' }, '').available).toBe(false)
    expect(resolve_mount({ id: 'c1', mount: null }, '').available).toBe(false)
    expect(resolve_mount(null, '').available).toBe(false)
    // a stray scalar in the slot never grants a mount (mirrors the mount_speed item-like gate)
    expect(resolve_mount({ id: 'c1', mount: 1 }, '').available).toBe(false)
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
  test('a full URL / absolute served path passes through; empty → null', () => {
    expect(worn_dev_url('/sui_helmet.glb')).toBe('/sui_helmet.glb')
    expect(worn_dev_url('https://cdn.test/cosmetics/x.glb')).toBe('https://cdn.test/cosmetics/x.glb')
    expect(worn_dev_url('')).toBe(null)
    expect(worn_dev_url(null)).toBe(null)
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
  test('every table height is a sane rideable size (0.8–2.2 blocks)', async () => {
    const { MOUNT_TABLE } = await import('./cosmetic_glb.js')
    for (const h of Object.values(MOUNT_TABLE)) {
      expect(h).toBeGreaterThanOrEqual(0.8)
      expect(h).toBeLessThanOrEqual(2.2)
    }
  })
})
