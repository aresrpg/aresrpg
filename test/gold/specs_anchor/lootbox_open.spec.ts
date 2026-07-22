// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

const GOLD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_PATH = path.join(GOLD, '.gold-deployment.json')
const manifest = fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) : null
const API: string = manifest?.api ?? 'http://127.0.0.1:3100'

type GoldWallet = { address: string; privkey: string }
type LootboxFixture = {
  sale_id: string
  template_id: string
  item_type: string
  category: string
  name: string
  level: number
  price_mist: string
  stale_template_id: string
}

async function v1(pathname: string): Promise<any> {
  const response = await fetch(`${API}${pathname}`)
  return response.json()
}

async function anchor_boot(page: Page, wallet: GoldWallet) {
  await page.addInitScript(
    (payload: { key: string; ids: any }) => {
      ;(window as any).__ARES_DEV_KEY = payload.key
      ;(window as any).__ARES_LOCALNET_IDS = payload.ids
    },
    { key: wallet.privkey, ids: manifest.ids.aresrpg }
  )
  await page.goto('/characters?dev')
  await expect
    .poll(() => page.evaluate(() => !!(window as any).__ARES_ENGINE?.get_state().sui?.loaded), {
      timeout: 45_000,
      message: 'gold UI roster store did not resolve',
    })
    .toBe(true)
}

async function lootbox_fixture(): Promise<LootboxFixture | null> {
  const [shop, encyclopedia] = await Promise.all([v1('/v1/shop?active=true'), v1('/v1/encyclopedia?kind=items')])
  const templates = encyclopedia.items ?? []
  const box = templates.find((row: any) => String(row.item_type ?? '').endsWith('_lootbox'))
  const stale = templates.find(
    (row: any) =>
      row.template_id !== box?.template_id &&
      String(row.category ?? '').toLowerCase() === 'consumable' &&
      !String(row.item_type ?? '').endsWith('_lootbox')
  )
  const sale = (shop.sales ?? []).find((row: any) => row.template_id === box?.template_id)
  if (!box || !stale || !sale) return null
  return {
    sale_id: sale.sale_id,
    template_id: box.template_id,
    item_type: box.item_type,
    category: box.category,
    name: box.name,
    level: Number(box.level ?? 1),
    price_mist: sale.price_mist,
    stale_template_id: stale.template_id,
  }
}

async function buy_and_hydrate(page: Page, fixture: LootboxFixture) {
  return page.evaluate(async (target) => {
    const [{ buy_items_sale }, { hydrate_bought_items, remove_bag_items }] = await Promise.all([
      import('/src/world-shell/items_sale_actions.js'),
      import('/src/world-shell/store_patch.js'),
    ])
    const bought = await buy_items_sale({
      sale_id: target.sale_id,
      template_id: target.template_id,
      price_mist: target.price_mist,
      quantity: 1,
    })
    const row = {
      id: bought.created_item_ids[0],
      name: target.name,
      item_type: target.item_type,
      template_id: target.template_id,
      level: target.level,
      item_category: target.category.toLowerCase(),
      item_set: '',
      amount: 1,
      kiosk_id: bought.kiosk_id,
      kiosk_cap_id: bought.kiosk_cap_id,
    }
    const existing_ids = ((window as any).__ARES_ENGINE.get_state().sui?.items ?? [])
      .filter((item: any) => item.item_type === target.item_type)
      .map((item: any) => item.id)
    remove_bag_items(existing_ids)
    hydrate_bought_items([row])
    return row
  }, fixture)
}

async function install_stale_slug_collision(page: Page, fixture: LootboxFixture) {
  return page.evaluate(async (target) => {
    const { get_template_map, get_template_by_item_type_map } = await import('/src/chain/read_findables.js')
    const templates = await get_template_map()
    const stale = templates.get(target.stale_template_id)
    if (!stale || !templates.has(target.template_id)) return null
    // Model an event-replayed stale/re-authored template sharing the live box slug. The derived slug map is
    // last-wins, while the exact-id map remains truthful; the stale id is a real non-gacha template on-chain.
    templates.delete(target.stale_template_id)
    templates.set(target.stale_template_id, { ...stale, item_type: target.item_type })
    return (await get_template_by_item_type_map()).get(target.item_type)?.id ?? null
  }, fixture)
}

async function consumable_cell_index(page: Page, item_id: string) {
  return page.evaluate(async (id) => {
    const [{ ITEM_CATEGORY }, { group_stackable, is_consumable }] = await Promise.all([
      import('@aresrpg/sdk/items'),
      import('/src/game/screens/hud/inventory-equip.js'),
    ])
    const items = (window as any).__ARES_ENGINE.get_state().sui?.items ?? []
    const rows = items.filter((item: any) => is_consumable(item) || item.item_category === ITEM_CATEGORY.KEY)
    return group_stackable(rows).findIndex((item: any) => item.id === id)
  }, item_id)
}

async function install_toast_recorder(page: Page) {
  return page.evaluate(async () => {
    const [{ use_toast }, i18n] = await Promise.all([import('/src/toast'), import('/src/i18n')])
    const target = window as any
    target.__GOLD_LOOTBOX_TOAST_UNSUB?.()
    target.__GOLD_LOOTBOX_TOAST_MESSAGES = []
    target.__GOLD_LOOTBOX_TOAST_UNSUB = use_toast.subscribe((state) => {
      target.__GOLD_LOOTBOX_TOAST_MESSAGES.push(...state.toasts.map((toast) => toast.message))
    })
    return i18n.default.t('errors.lootbox_not_box')
  })
}

test.describe.serial('JUST-BOUGHT LOOTBOX · gold localnet', () => {
  test.skip(!manifest, 'no .gold-deployment.json — run `node test/gold/up_gold.mjs` first')

  test('optimistic inventory double-click opens with its exact template identity', async ({ page }) => {
    test.slow()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const wallet_index = 1
    const wallet = manifest.wallets[wallet_index] as GoldWallet
    expect(wallet, 'gold boot must provide wallet 1 for the inventory fixture').toBeTruthy()
    expect(
      (manifest.characters ?? []).some((row: any) => row.wallet === wallet_index),
      'gold boot must provide wallet 1 an inventory character'
    ).toBe(true)
    await anchor_boot(page, wallet)
    const fixture = await lootbox_fixture()
    expect(fixture, 'full gold corpus must provide a live lootbox sale plus non-gacha consumable template').toBeTruthy()

    const row = await buy_and_hydrate(page, fixture!)
    expect(row.id, 'buy must return the real optimistic item id').toBeTruthy()
    const lossy_winner = await install_stale_slug_collision(page, fixture!)
    expect(lossy_winner, 'fixture must make the non-gacha same-slug row win the lossy map').toBe(
      fixture!.stale_template_id
    )

    await page.locator('.inv__tab').filter({ hasText: 'Consumables' }).click()
    const cell_index = await consumable_cell_index(page, row.id)
    expect(cell_index, 'just-bought box must paint immediately into Consumables').toBeGreaterThanOrEqual(0)
    const not_box_copy = await install_toast_recorder(page)
    await page.locator('.inv__cell--filled').nth(cell_index).dblclick()

    await expect
      .poll(
        async () => ({
          phase: await page
            .locator('.boxreveal')
            .getAttribute('data-phase')
            .catch(() => null),
          not_box: await page.evaluate(
            (copy) => ((window as any).__GOLD_LOOTBOX_TOAST_MESSAGES as string[]).includes(copy),
            not_box_copy
          ),
        }),
        { timeout: 90_000, message: 'just-bought lootbox did not reach its truthful reveal' }
      )
      .toEqual({ phase: 'reveal', not_box: false })
  })
})
