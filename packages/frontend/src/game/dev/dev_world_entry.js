// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DEV-ONLY WORLD-ENTRY SEAM (#1100 coop) — the second seat's door, and the reason it is its OWN module.
//
// WHY NOT IN dev_bot_seam.js. That module is registered by BOTH surfaces (the simulator's dev_seams.js and the
// world HUD), which is exactly what makes one bot drive both. Putting a JOIN door there imported the world's
// chain entry — `world_fight.js`, `dungeon_actions.js`, `fight_engage.js` — into the SIMULATOR's module
// closure, and scripts/zero-drift-gate.mjs reds that on sight: its world-only ratchet is one row, the chain
// entry, and "it must stay one". The gate is right. The simulator is the fight engine on mocked receipts and
// must not be able to reach a transaction composer at all, not even through a door it never calls.
//
// So this file is WORLD-ONLY BY CONSTRUCTION: nothing the simulator loads may ever import it.
//
// REGISTRATION. The world registers its DEV seams from GameWorldHud's mount effect, beside dev_cast /
// dev_probe / dev_synth_fight / dev_bot_seam:
//
//     import('../../../dev/dev_world_entry.js').then((m) => {
//       if (!cleared) m.register_dev_world_entry()
//     })
//
// Same DEV gate, same dynamic import, same tree-shake, and the `__ARES_DEV_` name keeps it fenced out of every
// production bundle by scripts/assert_clean_bundle.mjs.

import { use_dungeon } from '../../world-shell/dungeon_store.js'
import { context } from '../store.js'

/**
 * window.__ARES_DEV_WORLD_JOIN(fight_id) — seat MY selected character in an OPEN PUBLIC world fight and mount
 * it. Every leg is the production one, in the production order (FightsModal's `on_join`, world branch): the
 * entry reducer wraps the join tx, one settlement recovery is allowed for the first refusal, and the join
 * receipt itself is what authorises the mount. `party_id` is null on purpose — a public fight discards it.
 *
 * This is what makes a COOP bot possible at all: the creator's door (`__dev_start_world_fight`,
 * embed_voxel_dev.js) seats exactly one character, and a second seat has no headless door anywhere else.
 * @param {string} fight_id the Fight object id the creator's engage published
 * @returns {Promise<{ ok: boolean, error?: string, fight_id?: string, status?: number|null }>}
 */
async function dev_world_join(fight_id) {
  if (!fight_id) return { ok: false, error: 'join needs the fight object id' }
  const character_id = context.get_state().selected_character_id
  if (!character_id) return { ok: false, error: 'no selected character' }
  const [
    { join_world_fight },
    { enter_world_fight },
    { enter_after_world_join_receipt },
    { run_fight_entry },
    { recover_fight_entry_refusal },
  ] = await Promise.all([
    import('../../world-shell/dungeon_actions.js'),
    import('../../world-shell/world_fight.js'),
    import('../../world-shell/world_fight_receipt.js'),
    import('../fight_engage.js'),
    import('../../world-shell/dungeon_settlement.js'),
  ])
  // A stale session owns the shared store until it is dropped, and `enter_world_fight` refuses to stomp one.
  if (use_dungeon.getState().fight_id || use_dungeon.getState().run_pass_id) use_dungeon.getState().reset_local()
  try {
    await enter_after_world_join_receipt({
      execute: () =>
        run_fight_entry({
          submit: () => join_world_fight({ fight_id, character_id, party_id: null }),
          // The first refusal may be an unopened FightResult from a previous fight; the recovery opens it and
          // the reducer releases exactly ONE more entry. A second refusal surfaces untouched — never a loop.
          recover_refusal: (error) => recover_fight_entry_refusal(use_dungeon, character_id, error),
        }),
      enter: enter_world_fight,
      fight_id,
      character_id,
    })
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
  await use_dungeon.getState().refresh()
  return { ok: true, fight_id, status: use_dungeon.getState().dungeon?.status ?? null }
}

/** Register the world-entry door (idempotent; dev builds only — the caller gates on import.meta.env.DEV). */
export function register_dev_world_entry() {
  if (typeof window === 'undefined') return
  ;(/** @type {any} */ (window)).__ARES_DEV_WORLD_JOIN = dev_world_join
}
