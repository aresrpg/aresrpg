// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { test, expect } from '@playwright/test'

import { boot_world, expect_walk_session } from './world_rig'

// WORLD DUNGEON GATE — the surviving half of world_lobby_npc.spec.ts (#872). The lobby NPC PROXIMITY mechanic
// it drove is gone: roam.js's proximity dispatcher died with D139, and D162 made the gate an ALWAYS-LIVE
// affordance (embed_voxel.js dispatches `action/npc_prompt` on session boot, clears it on dispose) — there is
// no NPC cell to walk up to and no `__ARES_MOBS.teleport` to walk with, so those beats are deleted, not ported.
// What survives is the front door itself, and the exact regression D162 fixed (nothing set npc_prompt on
// voxel ⇒ NpcPrompt rendered null ⇒ its [E] handler never bound ⇒ dungeons were unreachable):
//   1. the [E] pill is registered in the prompt stack for a booted world session,
//   2. [E] opens the dungeons panel,
//   3. Escape closes it and the affordance is back (the gate survives the round trip).
// The retired spec's BROWSE/CREATE tab + `data-slot` empty-state assertions are dropped: that shell is gone —
// the panel is now a key-gated enter panel. Nothing else in e2e/ covers this door (golden_path drives [F]/[G]
// only). Run HEADED (WebGPU) — see world_rig.ts for the prerequisites.

// [E] ENTER THE DUNGEONS, in the six shipped locales — the pill label of an ENTERABLE character. A staked
// (exploring) or escrowed (in_dungeon) character legitimately swaps this CTA for the busy hint / RESUME, which
// is a different, separately-owned branch: this drive declares an idle QA character as its prerequisite.
const ENTER_LABEL =
  /ENTER THE DUNGEONS|ENTRER DANS LES DONJONS|VERLIESE BETRETEN|ENTRAR EN LAS MAZMORRAS|ダンジョンに入る|УВІЙТИ В ПІДЗЕМЕЛЛЯ/i
const TITLE = /Dungeons|Donjons|Verliese|Mazmorras|ダンジョン|Підземелля/i

test('world session: the [E] dungeon gate is live and opens the dungeons panel', async ({ page }) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e?.stack || e)))

  await boot_world(page)
  await expect_walk_session(page) // a resumed fight empties the prompt stack — fail on the prerequisite, not the pill

  // ── (1) the gate affordance is registered in the prompt stack (D162) ────────────────────────────────────
  const pill = page
    .locator('.gw-prompt-stack .gw-npc-prompt')
    .filter({ has: page.locator('kbd.gw-npc-prompt__key', { hasText: /^E$/ }) })
  await expect(pill, 'a booted world session must register the [E] dungeon gate prompt').toBeVisible({
    timeout: 60_000,
  })
  await expect(
    pill,
    'the QA character must be idle (an exploring/escrowed one swaps this CTA — a different branch)'
  ).toContainText(ENTER_LABEL)

  // ── (2) [E] opens the dungeons panel (the ONE keydown listener PromptStack owns) ────────────────────────
  await page.keyboard.press('KeyE')
  const panel = page.locator('.gw-dg')
  await expect(panel, '[E] must open the dungeons panel — never a dead key').toBeVisible({ timeout: 10_000 })
  await expect(panel).toContainText(TITLE)

  // ── (3) Escape closes it and the gate is back ──────────────────────────────────────────────────────────
  await page.keyboard.press('Escape')
  await expect(panel, 'Escape must close the panel').toBeHidden({ timeout: 10_000 })
  await expect(pill, 'the always-live gate affordance returns once the panel is closed').toBeVisible({
    timeout: 10_000,
  })

  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([])
})
