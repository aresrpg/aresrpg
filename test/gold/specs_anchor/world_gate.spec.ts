// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type Locator, type Page } from '@playwright/test'

const gold = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest_path = path.join(gold, '.gold-deployment.json')
const manifest = fs.existsSync(manifest_path) ? JSON.parse(fs.readFileSync(manifest_path, 'utf8')) : null
const api: string = manifest?.api ?? 'http://127.0.0.1:3100'

type GoldWallet = { address: string; privkey: string }
type RuntimeWorld = { id: string; label: string; required_level: number }
type ApiWorld = { world_id: string; required_level: number }
type ApiCharacter = { id: string; level: number; world: string | null }

async function api_json(pathname: string) {
  const response = await fetch(`${api}${pathname}`)
  if (!response.ok) throw new Error(`gold API ${pathname} returned ${response.status}`)
  return response.json()
}

async function character_doc(character_id: string): Promise<ApiCharacter | null> {
  const payload = await api_json(`/v1/characters?ids=${encodeURIComponent(character_id)}`)
  return payload.characters?.[0] ?? null
}

async function boot_bound_world(page: Page, wallet: GoldWallet, character_id: string, world_id: string) {
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
      message: 'gold roster did not resolve for the world-gate wallet',
    })
    .toBe(true)

  const joined = await page.evaluate(
    async ({ character_id: id, world_id: world }) => {
      const [{ load_roster }, { join_world_action }, { set_last_character }] = await Promise.all([
        import('/src/roster/load_roster.js'),
        import('/src/world-shell/world_join.js'),
        import('/src/game/core/draft.js'),
      ])
      await load_roster()
      ;(window as any).__ARES_ENGINE.dispatch('action/select_character', id)
      const outcome = await join_world_action({ character_id: id, world_id: world })
      await set_last_character(id)
      return outcome?.timing?.digest ?? null
    },
    { character_id, world_id }
  )
  expect(joined, 'initial eligible localnet-world join must return a certified digest').toBeTruthy()
  await expect
    .poll(async () => (await character_doc(character_id))?.world, {
      timeout: 30_000,
      message: '/v1 did not project the initial localnet world binding',
    })
    .toBe(world_id)

  await page.goto('/?dev')
  await expect(page.locator('.gw-worlds')).toBeVisible({ timeout: 120_000 })
}

const world_card = (modal: Locator, label: string) =>
  modal.locator('.gw-travel__card').filter({ hasText: label }).first()

async function open_travel_modal(page: Page): Promise<Locator> {
  const modal = page.locator('.gw-travel')
  if (!(await modal.isVisible())) await page.locator('.gw-worlds__travel').click()
  await expect(modal).toBeVisible()
  return modal
}

test.describe('WORLD GATE · gold-localnet runtime world catalog', () => {
  test.skip(!manifest, 'no .gold-deployment.json — run `node test/gold/up_gold.mjs` first')

  test('@headed localnet worlds render live level gates and eligible travel commits through the UI', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const wallet_index = 2
    const wallet = (manifest.wallets as GoldWallet[])[wallet_index]
    const character_id = manifest.characters.find((row: any) => row.wallet === wallet_index)?.character_id
    const initial_world_id = manifest.world_id as string
    expect(wallet, 'gold boot must provide wallet 2').toBeTruthy()
    expect(character_id, 'gold boot must provide wallet 2 an isolated character').toBeTruthy()
    expect(initial_world_id, 'gold boot must provide its primary localnet world').toBeTruthy()

    await boot_bound_world(page, wallet, character_id!, initial_world_id)

    // These imports execute in the real Vite app. If the gold-only deployment alias regresses, this table carries
    // checked-in testnet ids and the exact localnet-id comparison below fails before any travel is attempted.
    const catalog = await page.evaluate(async (id) => {
      const [world_catalog, rpc] = await Promise.all([
        import('/src/world-shell/world_catalog.js'),
        import('/src/rpc/client'),
      ])
      const [runtime_worlds, characters, encyclopedia] = await Promise.all([
        world_catalog.load_world_catalog(),
        rpc.get_characters({ id }, undefined, true),
        rpc.get_encyclopedia('worlds'),
      ])
      return { runtime_worlds, worlds: encyclopedia.worlds, character: characters[0] ?? null }
    }, character_id)
    const runtime_worlds = catalog.runtime_worlds as RuntimeWorld[]
    const api_worlds = catalog.worlds as ApiWorld[]
    const character = catalog.character as ApiCharacter
    const seeded_ids = (manifest.seed.worlds as Array<{ id: string }>).map((world) => world.id)
    expect(character, 'the real app must read the selected localnet character from /v1').toBeTruthy()
    const character_level = Number(character.level ?? 1)
    expect(runtime_worlds[0]?.id, "runtime auto-join world must be this boot's primary object").toBe(initial_world_id)
    expect(
      seeded_ids.every((id) => runtime_worlds.some((world) => world.id === id)),
      'the real app runtime table must contain every world minted by this localnet boot'
    ).toBe(true)
    expect(character.id).toBe(character_id)
    expect(character.world).toBe(initial_world_id)

    const by_id = new Map(api_worlds.map((world) => [world.world_id, world]))
    const locked = runtime_worlds.find(
      (world) => seeded_ids.includes(world.id) && Number(by_id.get(world.id)?.required_level) > character_level
    )
    const eligible = runtime_worlds.find(
      (world) =>
        world.id !== initial_world_id &&
        seeded_ids.includes(world.id) &&
        Number(by_id.get(world.id)?.required_level) <= character_level
    )
    expect(locked, 'full gold corpus must expose a world above the fresh character level').toBeTruthy()
    expect(eligible, 'full gold corpus must expose a second level-eligible world').toBeTruthy()

    // Double-check the locked gate: the localnet runtime enumeration and the localnet /v1 snapshot agree before
    // the real switcher is asked to render it. The former third leg was a chain-direct World read
    // (read_worlds.js's get_worlds) — DELETED by #304, which rerouted the browser off the fullnode getObjects
    // fan-out onto this same /v1 worlds view; no browser chain-direct world reader survives to cross-check with.
    const chain_locked = await page.evaluate(async (world: RuntimeWorld) => {
      const { load_world_catalog } = await import('/src/world-shell/world_catalog.js')
      return (await load_world_catalog()).find((entry) => entry.id === world.id) ?? null
    }, locked!)
    const locked_level = Number(by_id.get(locked!.id)?.required_level)
    expect(chain_locked?.id).toBe(locked!.id)
    expect(chain_locked?.required_level).toBe(locked_level)
    expect(locked_level).toBeGreaterThan(character_level)

    // The collapsed panel binds the CURRENT world to the SELECTED character's live /v1 doc (identity-guarded
    // derivation — the 07-17 lying-HERE regression). data-world is asserted over copy so locale rollout
    // cannot flake the anchor.
    await expect(page.locator('.gw-worlds__now')).toHaveAttribute('data-world', initial_world_id, {
      timeout: 30_000,
    })

    // The travel modal renders EVERY runtime world as a card, with the LIVE level gates.
    const modal = await open_travel_modal(page)
    await expect(modal.locator('.gw-travel__card')).toHaveCount(runtime_worlds.length)
    const initial_card = world_card(modal, runtime_worlds[0].label)
    await expect(initial_card).toHaveClass(/\bhere\b/)
    await expect(initial_card.locator('.gw-travel__go')).toBeDisabled()

    const locked_card = world_card(modal, locked!.label)
    await expect(locked_card).toHaveClass(/\blocked\b/)
    await expect(locked_card.locator('.gw-travel__go')).toBeDisabled()
    await expect(locked_card.locator('.gw-travel__gate')).toHaveText(`Lv ${locked_level}+`)
    await expect(locked_card.locator('.gw-travel__go')).toHaveText(`Lv ${locked_level}+`)

    // The accessibility filter hides the locked card (HERE never filters out), then restores.
    await modal.locator('.gw-travel__ftab').nth(1).click()
    await expect(modal.locator('.gw-travel__card.locked')).toHaveCount(0)
    await expect(world_card(modal, runtime_worlds[0].label)).toBeVisible()
    await modal.locator('.gw-travel__ftab').nth(0).click()
    await expect(world_card(modal, locked!.label)).toBeVisible()

    // The level-eligible card opens the house confirmation dialog and executes the real self-pay join.
    // Observing the target on /v1 closes the loop through transaction → chain → indexer, not a local state fake.
    const eligible_card = world_card(modal, eligible!.label)
    await expect(eligible_card.locator('.gw-travel__go')).toBeEnabled()
    await eligible_card.locator('.gw-travel__go').click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText(`Travel to ${eligible!.label}?`)
    await dialog.getByRole('button', { name: 'Travel', exact: true }).click()
    await expect(page.locator('.gw-travel')).toBeHidden() // confirm closes the picker — you are travelling
    await expect
      .poll(async () => (await character_doc(character_id!))?.world, {
        timeout: 45_000,
        message: 'eligible world-switcher travel did not project through /v1',
      })
      .toBe(eligible!.id)

    // The panel line follows the chain (poll refetch), and re-opening the modal marks the new HERE.
    await expect(page.locator('.gw-worlds')).toBeVisible({ timeout: 120_000 })
    await expect(page.locator('.gw-worlds__now')).toHaveAttribute('data-world', eligible!.id, { timeout: 30_000 })
    const reopened = await open_travel_modal(page)
    await expect(world_card(reopened, eligible!.label)).toHaveClass(/\bhere\b/, { timeout: 30_000 })
  })
})
