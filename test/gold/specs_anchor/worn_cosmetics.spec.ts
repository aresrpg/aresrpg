// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test, type Page } from '@playwright/test'

import { gold_manifest, type GoldWallet } from './fight_mouse_helpers'

type CosmeticSale = {
  sale_id: string
  template_id: string
  item_type: string
  name: string
  price_mist: string
}
type OwnerItem = {
  id: string
  kiosk_id: string
  template_id: string
  item_type: string
  item_category: string
  name: string
}

async function boot(page: Page, wallet: GoldWallet) {
  await page.addInitScript(
    (payload: { key: string; ids: any }) => {
      ;(window as any).__ARES_DEV_KEY = payload.key
      ;(window as any).__ARES_LOCALNET_IDS = payload.ids
    },
    { key: wallet.privkey, ids: gold_manifest.ids.aresrpg }
  )
  await page.goto('/characters?dev')
  await expect
    .poll(() => page.evaluate(() => !!(window as any).__ARES_ENGINE?.get_state().sui?.loaded), {
      timeout: 45_000,
      message: 'gold roster did not resolve',
    })
    .toBe(true)
}

async function select_manifest_character(page: Page, wallet_index: number) {
  const character_id = gold_manifest.characters?.find((row: any) => row.wallet === wallet_index)?.character_id
  expect(character_id, `gold manifest has no wallet-${wallet_index} character`).toBeTruthy()
  await page.evaluate((id) => (window as any).__ARES_ENGINE.dispatch('action/select_character', id), character_id)
  await expect
    .poll(() =>
      page.evaluate((id) => (window as any).__ARES_ENGINE.get_state().selected_character_id === id, character_id)
    )
    .toBe(true)
  return String(character_id)
}

async function living_cloak_sale(page: Page): Promise<CosmeticSale | null> {
  return page.evaluate(async () => {
    const { get_shop_sales } = await import('/src/chain/read_shop_sales.js')
    const sales = (await get_shop_sales()).filter((sale: any) => !sale.paused && (sale.infinite || sale.supply > 0))
    const name_of = (sale: any) => sale.template?.display?.name || sale.template?.name || ''
    const sale = sales.find((row: any) => /^Lorito Cloak \(/.test(name_of(row)))
    if (!sale) return null
    return {
      sale_id: sale.id,
      template_id: sale.template_id,
      item_type: sale.template.item_type,
      name: name_of(sale),
      price_mist: sale.price_mist,
    }
  })
}

async function buy_cloak(page: Page, fixture: CosmeticSale) {
  return page.evaluate(async (sale) => {
    const { buy_items_sale } = await import('/src/world-shell/items_sale_actions.js')
    const result = await buy_items_sale({
      sale_id: sale.sale_id,
      template_id: sale.template_id,
      price_mist: sale.price_mist,
      quantity: 1,
    })
    return { item_ids: result.created_item_ids as string[], kiosk_id: result.kiosk_id as string }
  }, fixture)
}

async function wait_owner_item(page: Page, address: string, item_id: string): Promise<OwnerItem> {
  let item: OwnerItem | null = null
  await expect
    .poll(
      async () => {
        item = await page.evaluate(
          async ({ owner, requested_item }) => {
            const { rpc_get } = await import('/src/rpc/client')
            const result = await rpc_get('/v1/owner-items', { address: owner }, undefined, true)
            return (result.items ?? []).find((row: any) => row.id === requested_item) ?? null
          },
          { owner: address, requested_item: item_id }
        )
        return item?.id ?? null
      },
      { timeout: 30_000, message: '/v1 owner-items did not project the bought cloak' }
    )
    .toBe(item_id)
  return item!
}

async function equip_cloak(page: Page, character_id: string, item: OwnerItem) {
  return page.evaluate(
    async ({ requested_character, cloak }) => {
      const [{ equip_items }, { reconcile_equip_state }] = await Promise.all([
        import('/src/world-shell/equip_actions.js'),
        import('/src/world-shell/equip_state_refresh.js'),
      ])
      const state = (window as any).__ARES_ENGINE.get_state()
      const character = state.sui.characters.find((row: any) => row.id === requested_character)
      const current = character?.worn?.cloak ?? character?.cloak ?? null
      const current_id = current?.item_id ?? current?.id ?? null
      const outcome = await equip_items({
        character_id: requested_character,
        to_equip: [
          {
            item_id: cloak.id,
            slot: 'cloak',
            item_type: cloak.item_type,
            item_template_id: cloak.template_id,
          },
        ],
        to_unequip: current_id && current_id !== cloak.id ? [{ item_id: current_id, slot: 'cloak' }] : [],
      })
      await reconcile_equip_state({
        address: state.sui.address ?? (await import('/src/auth')).use_auth.getState().address,
        character_id: requested_character,
        expected_change: {
          equipped_ids: [cloak.id],
          unequipped_ids: current_id && current_id !== cloak.id ? [current_id] : [],
        },
      })
      return outcome?.timing?.digest ?? null
    },
    { requested_character: character_id, cloak: item }
  )
}

async function wait_for_world_binding(page: Page, character_id: string, world_id: string) {
  await expect
    .poll(
      () =>
        page.evaluate(
          async ({ id, expected_world }) => {
            const [rpc, { use_world_binding }] = await Promise.all([
              import('/src/rpc/client'),
              import('/src/world-shell/session_gate.js'),
            ])
            const [character] = await rpc.get_characters({ id }, undefined, true)
            return {
              indexed: character?.world === expected_world,
              resident: use_world_binding.getState().world === expected_world,
            }
          },
          { id: character_id, expected_world: world_id }
        ),
      { timeout: 45_000, message: 'equipped character did not converge on the requested resident world' }
    )
    .toEqual({ indexed: true, resident: true })
}

async function enter_world(page: Page, character_id: string) {
  const world_id = gold_manifest.world_id as string
  const digest = await page.evaluate(
    async ({ requested_character, world_id }) => {
      const [{ join_world_action }, { set_last_character }] = await Promise.all([
        import('/src/world-shell/world_join.js'),
        import('/src/game/core/draft.js'),
      ])
      ;(window as any).__ARES_ENGINE.dispatch('action/select_character', requested_character)
      const result = await join_world_action({ character_id: requested_character, world_id })
      await set_last_character(requested_character)
      return result?.timing?.digest ?? null
    },
    { requested_character: character_id, world_id }
  )
  expect(digest, 'world join produced no certified digest').toBeTruthy()
  await wait_for_world_binding(page, character_id, world_id)
  await page.goto('/?dev')
  await expect
    .poll(
      () =>
        page.evaluate(
          (id) =>
            (window as any).__ARES_ENGINE?.get_state().selected_character_id === id &&
            !!(window as any).__voxel_engine?.get_scene?.() &&
            !!(window as any).__voxel_ctl,
          character_id
        ),
      { timeout: 90_000, message: 'headed world did not mount the equipped character' }
    )
    .toBe(true)
  await wait_for_world_binding(page, character_id, world_id)
}

async function expected_back_model(page: Page, character_id: string) {
  return page.evaluate(async (id) => {
    const { read_worn_templates, resolve_worn_cosmetics } = await import('/src/game/cosmetic_glb.js')
    const character = (window as any).__ARES_ENGINE.get_state().sui.characters.find((row: any) => row.id === id)
    const templates = await read_worn_templates()
    return resolve_worn_cosmetics(character, templates, '').back
  }, character_id)
}

async function rendered_back(page: Page) {
  return page.evaluate(() => {
    const engine = (window as any).__voxel_engine
    const player = (window as any).__voxel_ctl?.get_transform?.().position
    const roots: any[] = []
    engine?.get_scene?.()?.traverse((node: any) => {
      if (node.name === 'player_avatar' && node.visible) roots.push(node)
    })
    roots.sort((a, b) => {
      a.updateWorldMatrix(true, false)
      b.updateWorldMatrix(true, false)
      const am = a.matrixWorld.elements
      const bm = b.matrixWorld.elements
      return Math.hypot(am[12] - player[0], am[14] - player[2]) - Math.hypot(bm[12] - player[0], bm[14] - player[2])
    })
    const [root] = roots
    if (!root) return null
    let cape: any = null
    root.traverse((node: any) => {
      if (!cape && node.isBone && String(node.name).toLowerCase().includes('cape')) cape = node
    })
    if (!cape) return { bone: null, children: 0, meshes: 0, visible_meshes: 0, worn_materials: 0 }
    let meshes = 0
    let visible_meshes = 0
    let worn_materials = 0
    for (const child of cape.children)
      child.traverse((node: any) => {
        if (!node.isMesh && !node.isSkinnedMesh) return
        meshes += 1
        if (node.visible) visible_meshes += 1
        for (const material of Array.isArray(node.material) ? node.material : [node.material])
          if (
            Math.abs(Number(material?.roughness) - 0.4) < 0.001 &&
            Math.abs(Number(material?.metalness) - 0.35) < 0.001
          )
            worn_materials += 1
      })
    return { bone: cape.name, children: cape.children.length, meshes, visible_meshes, worn_materials }
  })
}

test.describe('gold localnet — equipped cosmetic world render', () => {
  test.skip(!gold_manifest, 'no .gold-deployment.json — run `node test/gold/up_gold.mjs` first')

  test('@headed WORN COSMETICS · a bought and equipped cloak mounts on the live avatar cape bone', async ({ page }) => {
    test.setTimeout(300_000)
    const wallet_index = 2
    const wallet = (gold_manifest.wallets as GoldWallet[])[wallet_index]
    expect(wallet, 'gold bootstrap did not publish wallet 2').toBeTruthy()
    await boot(page, wallet)
    const character_id = await select_manifest_character(page, wallet_index)
    const sale = await living_cloak_sale(page)
    expect(sale, 'full gold corpus has no live Lorito cloak sale').toBeTruthy()
    const bought = await buy_cloak(page, sale!)
    expect(bought.item_ids).toHaveLength(1)
    const item = await wait_owner_item(page, wallet.address, bought.item_ids[0])
    expect(item.template_id, 'bought row lost its exact living template identity').toBe(sale!.template_id)
    const equip_digest = await equip_cloak(page, character_id, item)
    expect(equip_digest, 'cloak equip produced no certified digest').toBeTruthy()

    await enter_world(page, character_id)
    await expect
      .poll(
        () =>
          page.evaluate(
            ({ id, item_id }) => {
              const character = (window as any).__ARES_ENGINE
                .get_state()
                .sui.characters.find((row: any) => row.id === id)
              return character?.worn?.cloak?.item_id === item_id || character?.cloak?.item_id === item_id
            },
            { id: character_id, item_id: item.id }
          ),
        { timeout: 30_000, message: 'equipped cloak did not survive into the resident world roster' }
      )
      .toBe(true)
    const model = await expected_back_model(page, character_id)
    expect(model?.url, 'equipped cloak did not resolve to an authored worn GLB').toBeTruthy()
    await expect
      .poll(
        async () => {
          const rendered = await rendered_back(page)
          return !!rendered?.bone && rendered.meshes > 0 && rendered.visible_meshes > 0 && rendered.worn_materials > 0
        },
        {
          timeout: 60_000,
          message: `cloak GLB never mounted on the live cape bone (${model!.url})`,
        }
      )
      .toBe(true)
    const rendered = await rendered_back(page)
    expect(rendered!.meshes, 'cape-bone child contains no renderable mesh').toBeGreaterThan(0)
    expect(rendered!.visible_meshes, 'cape-bone cosmetic meshes are all hidden').toBeGreaterThan(0)
    await expect(page.locator('.gw-selfplate')).toBeVisible()
  })
})
