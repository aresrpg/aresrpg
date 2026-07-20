// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { writeFileSync, mkdirSync } from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

// WS-B — lobby NPC affordance + dungeon modal shell. Proves against the REAL app:
//   1. a Dungeon Master NPC exists in the lobby (dev readout exposes its cell),
//   2. walking within range raises the "press E" prompt (action/npc_prompt → NpcPrompt renders),
//   3. pressing E opens the dungeon browser/create modal shell (house-styled, BROWSE/CREATE tabs),
//   4. the modal's browse tab shows the honest empty state (no fake rows — WS-C fills it),
//   5. Escape closes it, and walking away clears the prompt.

const SNAP_DIR = '/tmp/world_npc_snaps'
mkdirSync(SNAP_DIR, { recursive: true })
const snap = (name: string, buf: Buffer) => writeFileSync(`${SNAP_DIR}/${name}.png`, buf)

const DEV_KEY = process.env.VITE_DEV_KEY ?? ''

const npc_cell = (page: Page) => page.evaluate(() => (window as any).__ARES_PLAYER?.npc_cell())
const prompt_state = (page: Page) =>
  page.evaluate(async () => (await import('/src/game/core/game.js')).context.get_state().npc_prompt)

test('World tab: lobby NPC prompt opens the dungeon modal shell', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(String(e?.stack || e)))
  await page.addInitScript((k: string) => {
    ;(window as any).__ARES_DEV_KEY = k
  }, DEV_KEY)
  await page.goto('/game-world?dev', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-nav="game-world"]')).toContainText('World', { timeout: 30_000 })

  // land in the scene (mint if the roster is empty; full reload after).
  const createAndPlay = page.locator('button:has-text("PLAY")')
  let needsCreate = false
  for (let i = 0; i < 15 && !needsCreate; i++) {
    needsCreate = await createAndPlay.isVisible().catch(() => false)
    if (!needsCreate) await page.waitForTimeout(3000)
  }
  if (needsCreate) {
    await page.getByPlaceholder('Enter name...').fill(`WSBNpc${Date.now() % 100000}`)
    await createAndPlay.click()
    await expect(createAndPlay).not.toBeVisible({ timeout: 40_000 })
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(3000)
      const sel = await page
        .evaluate(async () => (await import('/src/game/core/game.js')).context.get_state().selected_character_id)
        .catch(() => null)
      if (sel) break
    }
  }

  const canvas = page.locator('canvas.roam-canvas')
  await expect(canvas).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(6000)

  // dismiss the first-session tutorial so the modal + prompt are interactive.
  const skip = page.locator('.tut__skip')
  if (await skip.isVisible({ timeout: 5000 }).catch(() => false)) await skip.click()
  await expect(page.locator('.tut__backdrop')).toHaveCount(0, { timeout: 5000 })

  // (1) the NPC exists — dev readout gives its cell.
  const cell = await npc_cell(page)
  expect(cell, 'the lobby should spawn a Dungeon Master NPC with a cell').not.toBeNull()

  // (2) teleport adjacent to the NPC so the proximity prompt raises deterministically (spawn distance
  // varies with terrain), then confirm the store flag + the rendered prompt.
  await page.evaluate((c) => (window as any).__ARES_MOBS.teleport(c.x + 1, c.y), cell)
  // Poll for the proximity flag — the tick that raises it can be throttled under load.
  let prompt = await prompt_state(page)
  for (let i = 0; i < 20 && !prompt; i++) {
    await page.waitForTimeout(300)
    prompt = await prompt_state(page)
  }
  expect(prompt, 'walking next to the NPC should set npc_prompt').not.toBeNull()
  const promptBtn = page.locator('.gw-npc-prompt')
  await expect(promptBtn, 'the press-E prompt should render').toBeVisible({ timeout: 5000 })
  snap('1_prompt', await page.screenshot())

  // (3) press E → the dungeon modal shell opens.
  await page.keyboard.press('KeyE')
  const modal = page.locator('.gw-dg')
  await expect(modal, 'E should open the dungeon modal shell').toBeVisible({ timeout: 3000 })
  await expect(modal).toContainText(/Dungeons|Donjons|Verliese|Mazmorras|ダンジョン|Підземелля/)
  snap('2_modal_browse', await page.screenshot())

  // (4) BROWSE shows the honest empty state (no fabricated dungeon rows — WS-C wires the real list).
  await expect(page.locator('.gw-dg__empty[data-slot="dungeon-list"]')).toBeVisible()
  // CREATE tab renders its own slot.
  await page.locator('.gw-dg__tab', { hasText: /Create|Créer|Erstellen|Crear|作成|Створити/ }).click()
  await expect(page.locator('.gw-dg__empty[data-slot="dungeon-create"]')).toBeVisible()
  snap('3_modal_create', await page.screenshot())

  // (5) Escape closes; the prompt is back (still adjacent), then walking away clears it.
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden({ timeout: 3000 })
  await page.evaluate((c) => (window as any).__ARES_MOBS.teleport(c.x + 40, c.y + 40), cell)
  let cleared = await prompt_state(page)
  for (let i = 0; i < 20 && cleared !== null; i++) {
    await page.waitForTimeout(300)
    cleared = await prompt_state(page)
  }
  expect(cleared, 'walking far from the NPC should clear the prompt').toBeNull()

  expect(pageErrors, `unexpected page errors:\n${pageErrors.join('\n')}`).toEqual([])
})
