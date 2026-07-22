// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import { LIVE_BIND_BUDGET_MS, mount_bound } from './dom_convergence.ts'

// FIGHT TURN CARD — the other gap-class-2 surface named alongside the HP number (CLI_TEST_AUDIT.md): oracles
// today assert the STORE (`state.active===state.me.id`) or a raw class snapshot, never that the `active`
// highlight itself moves card-to-card in the live DOM as the turn hands off. FightTimeline.jsx is a pure
// `s.fight` reader (GameWorldHud.jsx's own description), so it mounts standalone exactly like SelfPlate.

const ME = '0xturn-live-me'
// fight_store's mob entity id is always `mob-<index in the seeded mobs[] array>` (packages/fight/src/project.js
// `map.set('mob-${i}', …)`); fight_core_harness's default single-mob seed lands at index 0.
const MOB_ID = 'mob-0'

/** Seed a live two-fighter turn through the REAL fight-core seeding door. S2 MIRROR KILL:
 * fight truth's ONE home is fight_store — `context.dispatch('action/fight/spawn'|'started', …)` is DEAD
 * (modules/fight.js's reducer no-ops on the whole legacy `action/fight/*` vocabulary now: "no `state.fight`
 * copy exists to write" — confirmed the actual break here, not an auth/harness-mount problem: the component
 * never received a fight, so it rendered null). `fight_core_harness.seed_fight_core` (init → snapshot) is the
 * sanctioned TEST door onto fight_store, imported live through Vite's module graph so this drives the REAL
 * reducer — the exact seeding FightTimeline.effective-deadline.test.jsx already proves for a static render. */
async function seed_turn_order(page: import('@playwright/test').Page) {
  await page.evaluate(async (my) => {
    const { seed_fight_core } = await import('/src/test_helpers/fight_core_harness.js')
    seed_fight_core({ fight_id: 'turn-live-fight', my })
  }, ME)
}

/** The hand-off: re-seed the SAME fight_id with a new `active` entity + a bumped `version` — the exact
 * turn-advance shape FightControls.turn-phase.test.jsx's `seed({ active: MOB, version: 2 })` already proves. */
async function hand_off_turn(page: import('@playwright/test').Page, active: string) {
  await page.evaluate(
    async ({ my, active }) => {
      const { seed_fight_core } = await import('/src/test_helpers/fight_core_harness.js')
      seed_fight_core({ fight_id: 'turn-live-fight', my, active, version: 2 })
    },
    { my: ME, active }
  )
}

test('FIGHT TURN CARD · the active highlight converges from the acting fighter to the next turn', async ({ page }) => {
  await page.goto('/')
  await mount_bound(page, '/src/game/screens/hud/FightTimeline.jsx', 'FightTimeline')
  const ally_card = page.locator('.hud-turn.ally')
  const enemy_card = page.locator('.hud-turn.enemy')

  await seed_turn_order(page)
  await expect(ally_card, 'turn_order[0] never lit the active highlight').toHaveClass(/\bactive\b/, {
    timeout: LIVE_BIND_BUDGET_MS,
  })
  await expect(enemy_card, 'the non-acting card lit active on spawn').not.toHaveClass(/\bactive\b/)

  await hand_off_turn(page, MOB_ID)
  await expect(enemy_card, 'the hand-off never moved the active highlight to the new actor').toHaveClass(/\bactive\b/, {
    timeout: LIVE_BIND_BUDGET_MS,
  })
  await expect(ally_card, 'the previous actor kept the active highlight after the hand-off').not.toHaveClass(
    /\bactive\b/
  )
})
