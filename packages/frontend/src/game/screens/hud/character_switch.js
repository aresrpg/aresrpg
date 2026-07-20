// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SWITCH-PARITY LEG ① — the character-switch seam consumed by CharactersDrawer's `switch_to`. Split out of
// CharactersDrawer.jsx (not inlined) because that file's import graph pulls in Vite-only virtual modules
// (Inventory.jsx → `virtual:item_catalog`) that bun:test cannot resolve — this leaf stays node-clean so the
// wiring is directly behavior-tested (mirrors character_selection.test.js), rather than presumed correct by
// inspection like CharacterSwitcher.tsx's own inline closure.
//
// Routes through the EXACT seam CharacterSwitcher.tsx uses (character_selection.js's handle_character_click):
// selection + persistence + the world-session rebind AND the fight-board rebind (the FIGHT half) all
// fire together, so a switch fired from EITHER surface tears down the outgoing character's local fight board
// (reset_local — no chain tx, its Fight persists) and resumes the incoming character's own live fight. Before
// this leaf existed, CharactersDrawer's switch_to only dispatched selection — the world/fight stayed bound to
// the outgoing character (the exact bug session-binding (37cd67a0) fixed for CharacterSwitcher, unfixed here).

import { handle_character_click } from '@aresrpg/world'

import { context } from '../../store.js'
import { use_follow } from '../../../follow'
import { use_dungeon } from '../../../world-shell/dungeon_store.js'
import { rebind_world_character } from '../../../world-shell/session_gate.js'
import { rebind_fight_session } from '../../../world-shell/character_fight_rebind.js'
import { resume_world_fight } from '../../../world-shell/world_fight.js'
import { set_last_character } from '../../core/draft.js'

/**
 * @param {{ id?: string, world_id?: string | null }} character
 * @param {(error: unknown) => void} on_failure
 * @returns {Promise<boolean>}
 */
export function switch_active_character(character, on_failure) {
  return handle_character_click(
    character,
    {
      select_character: (id) => context.dispatch('action/select_character', id),
      persist_character: set_last_character,
      stop_follow: () => {
        if (use_follow.getState().active) use_follow.getState().unfollow()
      },
      rebind_session: rebind_world_character,
      // FIGHT half: drop the OUTGOING character's local board (no chain tx — its Fight persists,
      // re-enterable on switch-back) and resume the INCOMING character's own live fight, so the board tracks
      // the ACTIVE character instead of whoever started it (the "forced to remain on the first char fight").
      rebind_fight: (id) =>
        rebind_fight_session(id, {
          dungeon: use_dungeon.getState(),
          reset_local: () => use_dungeon.getState().reset_local(),
          resume: resume_world_fight,
        }),
    },
    on_failure
  )
}
