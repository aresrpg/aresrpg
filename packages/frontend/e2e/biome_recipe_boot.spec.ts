// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { test, expect, type Page } from '@playwright/test'

// Frontend wiring lane (DECISIONS 2026-07-12) — the "headless recipe-identity proof": the existing engine-side
// `?biome=<name>` dev/QA switch (packages/engine/src/config/worlds/index.js `world_config_for_biome`, READ-ONLY
// this ticket) must still resolve end-to-end through the NEW boot-seam precedence
// (expedition/deployment.ts `resolve_engine_recipe`, wired in game/embed_voxel.js `create_session`) to the exact
// PARADISE_WORLD recipe identity. Runs on the LOGGED-OUT spectate landing (GameWorldHost.tsx:
// `show_world = active || !in_app` mounts the decorative voxel scene with no wallet/chain calls), so this is
// cheap and fully isolated — no sponsor, no roster, no world binding, own throwaway webServer port (5174, never
// the app's already-running dev ports — see playwright.config.ts).

test.use({ viewport: { width: 1280, height: 720 } })

const active_recipe = (page: Page) =>
  page.evaluate(async () => {
    const { get_active_world_config } = await import('/src/game/embed_voxel.js')
    const cfg = get_active_world_config()
    return cfg ? { name: cfg.name ?? null, biome_pin: cfg.biome_pin ?? null, seed: cfg.seed ?? null } : null
  })

test('biome recipe wiring: ?biome=paradise boots the PARADISE_WORLD engine recipe identity', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(String(e?.stack || e)))

  await page.goto('/?biome=paradise', { waitUntil: 'domcontentloaded' })

  // the dynamic import()+create_session chain resolves within a couple of ticks; poll for the accessor to
  // report a booted recipe rather than assuming a fixed delay.
  await expect.poll(async () => (await active_recipe(page))?.name ?? null, { timeout: 30_000 }).toBe('paradise')

  const cfg = await active_recipe(page)
  console.log('[biome-recipe] active world_config identity', JSON.stringify(cfg))

  expect(cfg?.name, 'the ?biome=paradise URL override booted the PARADISE_WORLD recipe').toBe('paradise')
  expect(cfg?.seed, 'paradise carries its own distinct gen seed (never DEFAULT/rainforest)').toBe('ares-paradise-atoll')

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([])
})
