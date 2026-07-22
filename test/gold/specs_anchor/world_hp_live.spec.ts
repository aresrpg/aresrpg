// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import { LIVE_BIND_BUDGET_MS, dispatch, mount_bound } from './dom_convergence.ts'

const CHARACTER_ID = '0xhp-live'

/** Seed the roster + select — mirrors action/sui_data's real load_roster shape closely enough for SelfPlate's
 * selector, which is all this surface reads (character_max_hp needs `vitality`/`gear_vitality`, both 0 here so
 * the SDK curve's floor — 70 — is the expected max throughout). */
async function seed_character(page: import('@playwright/test').Page) {
  await dispatch(page, 'action/sui_data', {
    characters: [
      {
        id: CHARACTER_ID,
        _type: '0xcharacter::Character',
        name: 'Hero',
        classe: 'senshi',
        experience: 0,
        vitality: 0,
        gear_vitality: 0,
        current_hp: 60,
        hp_updated_ms: Date.now() + 60_000,
      },
    ],
  })
  await dispatch(page, 'action/select_character', CHARACTER_ID)
}

/** Fight settlement replaces the canonical row wholesale (a fresh object — Object.is identity changes). */
async function replace_hp(page: import('@playwright/test').Page, current_hp: number) {
  await page.evaluate(
    async ({ character_id, current_hp }) => {
      const { context } = await import('/src/game/store.js')
      const current = context.get_state().sui.characters.find((row: any) => row.id === character_id)
      context.dispatch('action/sui_data', {
        characters: [{ ...current, current_hp, hp_updated_ms: Date.now() + 60_000 }],
      })
    },
    { character_id: CHARACTER_ID, current_hp }
  )
}

/** A live damage/heal source may instead PRESERVE the hydrated row's identity (mutate in place) — the exact
 * shape that skipped SelfPlate's repaint before FM3's `character_hp_revision` subscription (this oracle proves
 * that fix, not just the wholesale-replace path replace_hp above already covered). */
async function mutate_hp(page: import('@playwright/test').Page, current_hp: number) {
  await page.evaluate(
    async ({ character_id, current_hp }) => {
      const { context } = await import('/src/game/store.js')
      const { characters } = context.get_state().sui
      const current = characters.find((row: any) => row.id === character_id)
      current.current_hp = current_hp
      current.hp_updated_ms = Date.now() + 60_000
      context.dispatch('action/sui_data', { characters })
    },
    { character_id: CHARACTER_ID, current_hp }
  )
}

test('WORLD HUD HP · settle, damage, and heal repaint the mounted integer', async ({ page }) => {
  await page.goto('/')
  await mount_bound(page, '/src/game/screens/hud/world/SelfPlate.jsx', 'SelfPlate')
  const hp_text = page.locator('.gw-selfplate__hp-t')

  await seed_character(page)
  await expect(hp_text, 'initial roster load never reached the mounted plate').toHaveText('60/70', {
    timeout: LIVE_BIND_BUDGET_MS,
  })

  await replace_hp(page, 20) // fight settlement replaces the canonical row
  await expect(hp_text, 'a wholesale row replace never repainted').toHaveText('20/70', { timeout: LIVE_BIND_BUDGET_MS })

  await mutate_hp(page, 5) // a live damage source may preserve the hydrated row identity
  await expect(hp_text, 'an identity-preserving mutation never repainted (the FM3 regression class)').toHaveText(
    '5/70',
    { timeout: LIVE_BIND_BUDGET_MS }
  )

  await mutate_hp(page, 35) // healing must repaint through the same mounted subscription
  await expect(hp_text, 'a heal through the same identity-preserving path never repainted').toHaveText('35/70', {
    timeout: LIVE_BIND_BUDGET_MS,
  })
})
