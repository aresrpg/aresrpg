// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type Locator, type Page } from '@playwright/test'

const GOLD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_PATH = path.join(GOLD, '.gold-deployment.json')
const manifest = fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) : null
const API: string = manifest?.api ?? 'http://127.0.0.1:3100'
const missing_icons = new Set<string>(
  JSON.parse(
    fs.readFileSync(path.resolve(GOLD, '..', '..', 'packages', 'sdk', 'src', 'missing_item_icons.json'), 'utf8')
  ).flatMap((row: { id: string; name: string }) => [row.id, row.name])
)

type GoldWallet = { address: string; privkey: string }
type CosmeticFixture = {
  sale_id: string
  template_id: string
  item_type: string
  category: string
  name: string
  price_mist: string
  legacy_template_id: string
}
type OwnerItem = {
  id: string
  kiosk_id: string
  template_id: string
  item_type: string
  item_category: string
  name: string
}

async function v1(pathname: string): Promise<any> {
  const response = await fetch(`${API}${pathname}`)
  return response.json()
}

async function anchor_boot(page: Page, wallet: GoldWallet, pathname = '/?dev') {
  await page.addInitScript(
    (payload: { key: string; ids: any }) => {
      ;(window as any).__ARES_DEV_KEY = payload.key
      ;(window as any).__ARES_LOCALNET_IDS = payload.ids
    },
    { key: wallet.privkey, ids: manifest.ids.aresrpg }
  )
  await page.goto(pathname)
}

async function wait_ui_ready(page: Page) {
  await expect
    .poll(() => page.evaluate(() => !!(window as any).__ARES_ENGINE?.get_state().sui?.loaded), {
      timeout: 45_000,
      message: 'gold UI roster store did not resolve',
    })
    .toBe(true)
}

async function sibling_cosmetic(page: Page): Promise<CosmeticFixture | null> {
  return page.evaluate(async () => {
    const { get_shop_sales } = await import('/src/chain/read_shop_sales.js')
    const sales = (await get_shop_sales()).filter((sale: any) => !sale.paused && (sale.infinite || sale.supply > 0))
    const name_of = (sale: any) => sale.template?.display?.name || sale.template?.name || ''
    const variants = sales.filter((sale: any) => /^Lorito Cloak \(/.test(name_of(sale)))
    const legacy_template_id = variants[0]?.template_id ?? null
    const target = variants.find((sale: any) => sale.template_id !== legacy_template_id)
    if (!target || !legacy_template_id) return null
    return {
      sale_id: target.id,
      template_id: target.template_id,
      item_type: target.template.item_type,
      category: target.template.category,
      name: name_of(target),
      price_mist: target.price_mist,
      legacy_template_id,
    }
  })
}

async function buy_fixture(page: Page, target: CosmeticFixture) {
  return page.evaluate(async (fixture) => {
    const { buy_items_sale } = await import('/src/world-shell/items_sale_actions.js')
    const bought = await buy_items_sale({
      sale_id: fixture.sale_id,
      template_id: fixture.template_id,
      price_mist: fixture.price_mist,
      quantity: 1,
    })
    return { created_item_ids: bought.created_item_ids, kiosk_id: bought.kiosk_id }
  }, target)
}

async function fresh_owner_rows(page: Page, address: string, ids: string[]): Promise<OwnerItem[]> {
  let rows: OwnerItem[] = []
  await expect
    .poll(
      async () => {
        rows = await page.evaluate(
          async ({ owner, item_ids }) => {
            const { rpc_get } = await import('/src/rpc/client')
            const result = await rpc_get('/v1/owner-items', { address: owner }, undefined, true)
            return (result.items ?? []).filter((item: any) => item_ids.includes(item.id))
          },
          { owner: address, item_ids: ids }
        )
        return rows.length
      },
      { timeout: 30_000, message: '/v1 owner-items did not project the bought fixture' }
    )
    .toBe(ids.length)
  return rows
}

async function hydrate_items(page: Page, rows: OwnerItem[]) {
  await page.evaluate(async (items) => {
    const { hydrate_bought_items } = await import('/src/world-shell/store_patch.js')
    hydrate_bought_items(items)
  }, rows)
}

async function cosmetic_cell_index(page: Page, item_id: string) {
  return page.evaluate(async (id) => {
    const { is_cosmetic_item } = await import('/src/game/item_classification')
    const items = (window as any).__ARES_ENGINE.get_state().sui?.items ?? []
    return items.filter((item: any) => is_cosmetic_item(item)).findIndex((item: any) => item.id === id)
  }, item_id)
}

async function install_toast_recorder(page: Page) {
  return page.evaluate(async () => {
    const [{ use_toast }, i18n] = await Promise.all([import('/src/toast'), import('/src/i18n')])
    const target = window as any
    target.__GOLD_TOAST_UNSUB?.()
    target.__GOLD_TOAST_MESSAGES = []
    target.__GOLD_TOAST_EVENTS = []
    target.__GOLD_TOAST_UNSUB = use_toast.subscribe((state) => {
      target.__GOLD_TOAST_MESSAGES.push(...state.toasts.map((toast) => toast.message))
      target.__GOLD_TOAST_EVENTS.push(...state.toasts.map((toast) => ({ message: toast.message, type: toast.type })))
    })
    return {
      pending: i18n.default.t('inventory.tx_equip_pending'),
      success: i18n.default.t('inventory.tx_equip_success'),
      mismatch: i18n.default.t('errors.equip_template_mismatch'),
    }
  })
}

async function set_speed_budget(speed: number) {
  // @ts-expect-error The vendored gold ESM harness intentionally has no TypeScript declaration file.
  const { makeClient, signerOf, adminDials } = await import('../lib_gold.mjs')
  const client = await makeClient(manifest.rpc)
  const signer = await signerOf(manifest.publisher.privkey)
  return adminDials({
    client,
    signer,
    ids: manifest.ids.aresrpg,
    world_id: manifest.world_id,
    speed,
    mult: 400,
  })
}

async function create_speed_character(page: Page, wallet: GoldWallet) {
  const created = await page.evaluate(async () => {
    const [{ get_sdk }, auth] = await Promise.all([import('/src/chain/sdk'), import('/src/auth')])
    const sdk = await get_sdk()
    const creation = await sdk.get_creation_state()
    if (!creation) return { ok: false, error: 'could not read character creation state' }
    const name = `speed_${Date.now() % 1_000_000}`
    try {
      const tx = sdk.create_character_paid_ptb({
        name,
        class: 'senshi',
        male: true,
        color_1: 0,
        color_2: 0,
        color_3: 0,
        price_mist: creation.price,
      })
      const { wallet_name, address } = auth.use_auth.getState()
      const { digest } = await auth.sign_and_execute_transaction(wallet_name, address, tx)
      return { ok: true, name, digest }
    } catch (error: any) {
      return { ok: false, name, error: String(error?.message ?? error) }
    }
  })
  expect(created.ok, `fresh speed character creation failed: ${created.error}`).toBe(true)
  expect(created.digest, 'fresh speed character creation must execute').toBeTruthy()
  let character_id = ''
  await expect
    .poll(
      async () => {
        const characters = (await v1(`/v1/characters?owner=${wallet.address}`)).characters ?? []
        character_id = characters.find((character: any) => character.name === created.name)?.id ?? ''
        return character_id
      },
      { timeout: 30_000, message: '/v1 did not project the fresh speed character' }
    )
    .toBeTruthy()
  const joined = await page.evaluate(
    async ({ character_id: id, world_id }) => {
      const [{ load_roster }, { join_world_action }] = await Promise.all([
        import('/src/roster/load_roster.js'),
        import('/src/world-shell/world_join.js'),
      ])
      await load_roster()
      ;(window as any).__ARES_ENGINE.dispatch('action/select_character', id)
      const outcome = await join_world_action({ character_id: id, world_id })
      return outcome?.timing?.digest
    },
    { character_id, world_id: manifest.world_id }
  )
  expect(joined, 'fresh speed character must join the gold world').toBeTruthy()
  return character_id
}

async function normal_run_target(page: Page, character_id: string, world_id: string) {
  return page.evaluate(
    async ({ character_id: id, world }) => {
      const [checkpoint, sdk_module, game_api, coords, rpc] = await Promise.all([
        import('/src/chain/read_checkpoint.js'),
        import('/src/chain/sdk'),
        // bare specifiers can't resolve in a browser-native import (page.evaluate) — Vite's /@id/ escape can.
        import('/@id/@aresrpg/sdk/game'),
        import('/@id/@aresrpg/sdk/coords'),
        import('/src/rpc/client'),
      ])
      const current = await checkpoint.read_checkpoint(id, world)
      if (!current) return null
      const sdk = await sdk_module.get_sdk()
      const world_doc = await game_api.get_world({ grpc_client: sdk.grpc_client })(world)
      const offsets = coords.world_offsets(world_doc)
      const zone_size = Number(world_doc?.zone_size ?? 32)
      const known = new Set((await rpc.get_zones(world, undefined, true)).zones.map((zone) => `${zone.zx}:${zone.zy}`))
      const candidates = [
        { x: current.x + 20, z: current.z },
        { x: current.x - 20, z: current.z },
        { x: current.x, z: current.z + 20 },
        { x: current.x, z: current.z - 20 },
        { x: current.x + 14, z: current.z + 14 },
        { x: current.x + 14, z: current.z - 14 },
        { x: current.x - 14, z: current.z + 14 },
        { x: current.x - 14, z: current.z - 14 },
      ]
      const target = candidates.find(({ x, z }) => {
        if (x < 0 || z < 0 || x >= world_doc.bounds_x || z >= world_doc.bounds_z) return false
        const key = `${Math.floor(x / zone_size)}:${Math.floor(z / zone_size)}`
        return !known.has(key)
      })
      if (!target) return null
      return {
        x: coords.chain_to_world(target.x, offsets.x),
        z: coords.chain_to_world(target.z, offsets.z),
        distance: Math.hypot(target.x - current.x, target.z - current.z),
      }
    },
    { character_id, world: world_id }
  )
}
async function search_from_checkpoint(
  page: Page,
  world_id: string,
  character_id: string,
  target: { x: number; z: number }
) {
  return page.evaluate(
    async ({ world, character_id: requested_character, destination }) => {
      const [auth, sdk_module, checkpoint, kiosk, discovery, join, toast] = await Promise.all([
        import('/src/auth'),
        import('/src/chain/sdk'),
        import('/src/chain/read_checkpoint.js'),
        import('/src/world-shell/kiosk_resolve.js'),
        import('/src/world-shell/discovery_actions.js'),
        import('/src/world-shell/world_join.js'),
        import('/src/game/core/toast.js'),
      ])
      const engine = (window as any).__ARES_ENGINE
      const state = engine.get_state()
      engine.dispatch('action/select_character', requested_character)
      const character_id = requested_character || state.selected_character_id
      const { address } = auth.use_auth.getState()
      if (!character_id || !address) return { ok: false, error: 'no selected character/address' }
      let current = await checkpoint.read_checkpoint(character_id, world)
      if (!current) {
        await join.join_world_action({ character_id, world_id: world })
        current = await checkpoint.read_checkpoint(character_id, world)
      }
      if (!current) return { ok: false, error: 'world join did not create a checkpoint' }
      const sdk = await sdk_module.get_sdk()
      const handle = await kiosk.kiosk_for_character(sdk, address, character_id)
      if (!handle) return { ok: false, error: 'character kiosk did not resolve' }
      const toast_id = toast.push_progress_toast({ title: 'gold speed gate' })
      try {
        const outcome = await discovery.search_zone({
          world_id: world,
          x: destination.x,
          z: destination.z,
          character_id,
          kiosk_id: handle.kiosk_id,
          personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
          toast_id,
        })
        return {
          ok: true,
          digest: outcome?.timing?.digest,
          errors: toast.event_toast_store.get().filter((entry) => entry.state === 'error'),
        }
      } catch (error: any) {
        return {
          ok: false,
          error: String(error?.message ?? error),
          errors: toast.event_toast_store.get().filter((entry) => entry.state === 'error'),
        }
      }
    },
    { world: world_id, character_id, destination: target }
  )
}

async function assert_visual(root: Locator, allow_placeholder: boolean) {
  await root.scrollIntoViewIfNeeded()
  await expect
    .poll(
      () =>
        root.evaluate((node) => {
          const images = [
            ...(node instanceof HTMLImageElement ? [node] : []),
            ...node.querySelectorAll<HTMLImageElement>('img'),
          ]
          return {
            pending: images.filter((image) => !image.complete).length,
            broken: images.filter((image) => image.complete && image.naturalWidth === 0).length,
            object_urls: images.filter((image) => /0x[0-9a-f]{64}/i.test(image.currentSrc || image.src)).length,
          }
        }),
      { timeout: 15_000, message: 'item art never reached a loaded image or semantic placeholder' }
    )
    .toEqual({ pending: 0, broken: 0, object_urls: 0 })
  const state = await root.evaluate((node) => {
    const images = [
      ...(node instanceof HTMLImageElement ? [node] : []),
      ...node.querySelectorAll<HTMLImageElement>('img'),
    ]
    return {
      loaded: images.filter((image) => image.complete && image.naturalWidth > 0).length,
      placeholder:
        node.matches(
          '.item-icon__glyph, span.inline-flex.items-center.justify-center.text-muted.opacity-60[aria-hidden="true"]'
        ) ||
        !!node.querySelector(
          '.item-icon__glyph, span.inline-flex.items-center.justify-center.text-muted.opacity-60[aria-hidden="true"]'
        ),
    }
  })
  expect(state.loaded + Number(state.placeholder), 'item visual must not be blank').toBeGreaterThan(0)
  if (state.placeholder)
    expect(allow_placeholder, 'placeholder is legal only for missing_item_icons.json fixtures').toBe(true)
}
test.describe('07-15 fixed-class regressions — gold localnet', () => {
  test.skip(!manifest, 'no .gold-deployment.json — run `node test/gold/up_gold.mjs` first')
  test('POOR-WALLET SPONSOR ROUTING · station gas joins a zero-SUI character to the world', async () => {
    const { sponsored_join_world } = await import('../sponsor_client.mjs')
    // @ts-expect-error The vendored gold ESM harness intentionally has no TypeScript declaration file.
    const { makeClient } = await import('../lib_gold.mjs')
    const client = await makeClient(manifest.rpc)
    const fixture = manifest.sponsor_fixture
    // GOLD_SPONSOR=0 boots no sponsor, so this manifest carries no fixture and every line below read
    // `undefined.wallet` — a TypeError that looks like a product break instead of a rig that was never
    // asked to stand the sponsored route up. This is the ONE row in the tree that drives station gas, and
    // #1726's scope limit is exactly that the sponsored path real players use goes unexercised: it must
    // refuse by name and never skip to green.
    if (!fixture?.wallet?.address)
      throw new Error(
        'sponsor fixture absent — this rig booted with GOLD_SPONSOR=0, so the sponsored gas route was never ' +
          'stood up. Boot with the sponsor (the local default) or this row proves nothing (#1726).'
      )
    const before = BigInt((await client.getBalance({ owner: fixture.wallet.address })).totalBalance)
    expect(before).toBeLessThanOrEqual(200_000_000n)
    const result = await sponsored_join_world(manifest)
    expect(result.digest).toBeTruthy()
    expect(result.gas_budget_mist).toBeLessThanOrEqual(100_000_000)
    expect(result.sponsor_address).not.toBe(fixture.wallet.address)
    const after = BigInt((await client.getBalance({ owner: fixture.wallet.address })).totalBalance)
    expect(after, 'the poor actor must not pay sponsored gas').toBe(before)
    await expect
      .poll(async () => {
        const characters = (await v1(`/v1/characters?owner=${fixture.wallet.address}`)).characters ?? []
        return characters.find((character: any) => character.id === fixture.character.character_id)?.world ?? null
      })
      .toBe(manifest.world_id)
  })
  test('MULTI-CHARACTER FIXTURE · two wallets own multiple independently kiosk-locked characters', async () => {
    const grouped = (manifest.characters as Array<any>).reduce((counts: Record<number, number>, character: any) => {
      counts[character.wallet] = (counts[character.wallet] ?? 0) + 1
      expect(character.kiosk_id).toBeTruthy()
      expect(character.personal_kiosk_cap_id).toBeTruthy()
      return counts
    }, {})
    expect(Object.values(grouped).filter((count) => count >= 2)).toHaveLength(2)
    await Promise.all(
      Object.entries(grouped).map(async ([wallet_index, expected]) => {
        const wallet = manifest.wallets[Number(wallet_index)] as GoldWallet
        const projected = (await v1(`/v1/characters?owner=${wallet.address}`)).characters ?? []
        expect(projected).toHaveLength(expected)
      })
    )
  })
  test('CHECKPOINT / SPEED GATE · normal-run displacement (20 blocks / 2.2s) is accepted', async ({ page }) => {
    test.slow()
    // Dedicated write-fixture wallet (B1 FIXTURE ISOLATION, 2026-07-20 — R16_TAXONOMY.md): this test mints its
    // own fresh character every run — pinning it off the shared wallets[] table means MULTI-CHARACTER FIXTURE's
    // grouped-count read (and any future spec touching wallet 3) can never be desynced by this write, regardless
    // of file/test ordering (formerly wallet 3 — see up_gold.mjs speed_gate_wallet).
    const wallet = manifest.speed_gate_wallet as GoldWallet
    expect(wallet, 'gold bootstrap did not publish speed_gate_wallet').toBeTruthy()
    const tuned = await set_speed_budget(1_150)
    expect(tuned.ok, `could not set normal-run speed budget: ${tuned.abort}`).toBe(true)
    try {
      await anchor_boot(page, wallet, '/characters?dev')
      await wait_ui_ready(page)
      const character_id = await create_speed_character(page, wallet)
      const target = await normal_run_target(page, character_id, manifest.world_id)
      expect(target, 'fresh checkpoint must expose an undiscovered target within 20 blocks').toBeTruthy()
      expect(target!.distance).toBeLessThanOrEqual(20)
      // 20 / 2.2 = 9.09 blocks/s: below the real 10.5 run gait, above the pre-fix 5.5 gate.
      await page.waitForTimeout(2_200)
      const travelled = await search_from_checkpoint(page, manifest.world_id, character_id, target!)
      expect(travelled.ok, `normal-speed travel tripped checkpoint refusal: ${travelled.error}`).toBe(true)
      expect(travelled.digest, 'normal-speed travel must execute successfully').toBeTruthy()
      expect(travelled.errors, 'normal-speed travel must emit no refusal toast').toEqual([])
    } finally {
      const restored = await set_speed_budget(100_000)
      expect(restored.ok, `could not restore gold speed fixture: ${restored.abort}`).toBe(true)
    }
  })
  test('DRAG EQUIP · authored art, pending toast, and confirmed equipment persist', async ({ page }) => {
    test.slow()
    const [wallet] = manifest.wallets as GoldWallet[]
    await anchor_boot(page, wallet, '/characters?dev')
    await wait_ui_ready(page)
    const target = await sibling_cosmetic(page)
    expect(target, 'full gold corpus must expose a live sibling Lorito cosmetic sale').toBeTruthy()
    expect(target!.template_id, 'fixture must differ from the legacy item_type map winner').not.toBe(
      target!.legacy_template_id
    )
    const bought = await buy_fixture(page, target!)
    expect(bought.created_item_ids).toHaveLength(1)
    const rows = await fresh_owner_rows(page, wallet.address, bought.created_item_ids)
    expect(rows[0].template_id, 'owner row must retain the bought variant template').toBe(target!.template_id)
    await hydrate_items(page, rows)

    await page.locator('.inv__tab').filter({ hasText: 'Cosmetics' }).click()
    const cell_index = await cosmetic_cell_index(page, rows[0].id)
    expect(cell_index, 'bought cosmetic must paint into the bag').toBeGreaterThanOrEqual(0)
    const cell = page.locator('.inv__cell--filled').nth(cell_index)
    const copies = await install_toast_recorder(page)
    const cloak_slot = page.locator('.inv__slot--cloak')
    await cell.dragTo(cloak_slot)
    await expect(cloak_slot).toHaveClass(/is-filled/)
    await assert_visual(cloak_slot, false)
    await page.getByRole('button', { name: 'Accept', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => (window as any).__GOLD_TOAST_MESSAGES as string[]), {
        timeout: 60_000,
        message: 'equip never reached its success toast',
      })
      .toContain(copies.success)
    const events = await page.evaluate(
      () => (window as any).__GOLD_TOAST_EVENTS as Array<{ message: string; type: string }>
    )
    const pending_index = events.findIndex((event) => event.message === copies.pending && event.type === 'pending')
    const success_index = events.findIndex((event) => event.message === copies.success && event.type === 'success')
    expect(pending_index, 'equip must expose the standard pending toast before confirmation').toBeGreaterThanOrEqual(0)
    expect(success_index, 'the pending toast must morph to success').toBeGreaterThan(pending_index)
    const messages = await page.evaluate(() => (window as any).__GOLD_TOAST_MESSAGES as string[])
    expect(messages, 'exact-template equip must not be classified as a prior generation').not.toContain(copies.mismatch)
    await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0)
    await expect(cloak_slot).toHaveClass(/is-filled/)
    await expect(cloak_slot.locator('img')).toHaveAttribute('alt', rows[0].name)
    await expect
      .poll(
        () =>
          page.evaluate((item_id) => {
            const state = (window as any).__ARES_ENGINE.get_state()
            const character = state.sui.characters.find((row: any) => row.id === state.selected_character_id)
            const equipped = (character?.equipment ?? []).some((row: any) => (row.item_id ?? row.id) === item_id)
            const in_bag = (state.sui.items ?? []).some((row: any) => row.id === item_id)
            return { equipped, in_bag }
          }, rows[0].id),
        { timeout: 30_000, message: 'confirmed equipment was clobbered by a stale roster projection' }
      )
      .toEqual({ equipped: true, in_bag: false })
  })

  test('ICON RENDER · inventory + encyclopedia + marketplace resolve item art', async ({ page }) => {
    test.slow()
    const [, wallet] = manifest.wallets as GoldWallet[]
    const object_image_urls: string[] = []
    page.on('request', (request) => {
      if (request.resourceType() === 'image' && /0x[0-9a-f]{64}/i.test(request.url()))
        object_image_urls.push(request.url())
    })
    await anchor_boot(page, wallet, '/characters?dev')
    await wait_ui_ready(page)
    const target = await sibling_cosmetic(page)
    expect(target, 'full gold corpus must expose a live icon/listing sale').toBeTruthy()
    const bought = await buy_fixture(page, target!)
    const rows = await fresh_owner_rows(page, wallet.address, bought.created_item_ids)
    await hydrate_items(page, rows)
    const allow_placeholder = missing_icons.has(target!.item_type) || missing_icons.has(target!.name)

    await page.locator('.inv__tab').filter({ hasText: 'Cosmetics' }).click()
    const cell_index = await cosmetic_cell_index(page, rows[0].id)
    expect(cell_index, 'bought cosmetic must paint into inventory').toBeGreaterThanOrEqual(0)
    await assert_visual(page.locator('.inv__cell--filled').nth(cell_index).locator('.item-icon'), allow_placeholder)

    let listed = false
    try {
      await page.evaluate(
        async ({ item_id, kiosk_id }) => {
          const { list_item } = await import('/src/chain/write/write_listings.js')
          await list_item({ item_id, kiosk_id, price_mist: 1_000_000_000n })
        },
        { item_id: rows[0].id, kiosk_id: rows[0].kiosk_id }
      )
      listed = true
      await expect
        .poll(
          async () =>
            ((await v1('/v1/listings?limit=200')).listings ?? []).some((row: any) => row.item_id === rows[0].id),
          { timeout: 30_000, message: '/v1 did not project the icon fixture listing' }
        )
        .toBe(true)

      await page.goto(`/encyclopedia/items/${target!.template_id}?dev`)
      const encyclopedia = page.locator('.max-w-2xl').filter({ hasText: target!.name }).first()
      await expect(encyclopedia).toBeVisible()
      await assert_visual(encyclopedia, allow_placeholder)

      await page.goto('/marketplace?dev')
      await page.locator('[data-marketplace-general-categories] button').filter({ hasText: 'Cosmetics' }).click()
      await page.locator(`[data-marketplace-item-type="${target!.item_type.toUpperCase()}"]`).click()
      await page.locator(`[data-marketplace-template-option="${target!.template_id}"]`).click()
      await assert_visual(page.locator('[data-marketplace-template-card]'), allow_placeholder)
      await assert_visual(page.locator('[data-marketplace-listing-row]').first(), allow_placeholder)
      expect(object_image_urls, 'no item surface may request an object-id image URL').toEqual([])
    } finally {
      if (listed) {
        await page.evaluate(
          async ({ item_id, kiosk_id }) => {
            const { delist_item } = await import('/src/chain/write/write_listings.js')
            await delist_item({ item_id, kiosk_id })
          },
          { item_id: rows[0].id, kiosk_id: rows[0].kiosk_id }
        )
      }
    }
  })

  test('REQUEST DIET · encyclopedia navigation stays within Lane K GET budgets', async ({ page }) => {
    test.slow()
    const cold_first_minute_max = 22
    const encyclopedia_cold_max = 3
    const [, , , wallet] = manifest.wallets as GoldWallet[]
    const requests: string[] = []
    const responses: Array<{ url: string; status: number }> = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (request.method() === 'GET' && url.pathname.startsWith('/v1/')) requests.push(`${url.pathname}${url.search}`)
    })
    page.on('response', (response) => {
      const url = new URL(response.url())
      if (response.request().method() === 'GET' && url.pathname.startsWith('/v1/'))
        responses.push({ url: `${url.pathname}${url.search}`, status: response.status() })
    })

    await anchor_boot(page, wallet, '/encyclopedia/items?dev')
    await expect(page.getByRole('button', { name: 'Mobs', exact: true }).first()).toBeVisible()
    await expect
      .poll(() => requests.filter((url) => /^\/v1\/(shop|encyclopedia|rare-links)(?:\?|$)/.test(url)).length, {
        timeout: 30_000,
        message: 'encyclopedia cold content requests never completed',
      })
      .toBeGreaterThan(0)
    await page.waitForTimeout(1_000)
    const content_before_navigation = requests.filter((url) =>
      /^\/v1\/(shop|encyclopedia|rare-links)(?:\?|$)/.test(url)
    ).length

    for (const [label, route] of [
      ['Mobs', 'bestiary'],
      ['Worlds', 'worlds'],
      ['Items', 'items'],
    ] as const) {
      await page.getByRole('button', { name: label, exact: true }).first().click()
      await expect(page).toHaveURL(new RegExp(`/encyclopedia/${route}`))
    }
    await page.waitForTimeout(61_000)

    const content_requests = requests.filter((url) => /^\/v1\/(shop|encyclopedia|rare-links)(?:\?|$)/.test(url))
    expect(requests.length, `Lane K all-/v1 GETs: ${requests.join(', ')}`).toBeLessThanOrEqual(cold_first_minute_max)
    expect(content_requests.length, `Lane K content GETs: ${content_requests.join(', ')}`).toBeLessThanOrEqual(
      encyclopedia_cold_max
    )
    expect(content_requests.length, 'warm bestiary/world/items navigation must add zero content GETs').toBe(
      content_before_navigation
    )
    expect(
      responses.filter(({ status }) => status === 429),
      'gold navigation must receive zero 429s'
    ).toEqual([])
  })
})
