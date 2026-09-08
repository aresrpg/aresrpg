// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { indexing_blocked } from '../components/IndexingCatchupModal.tsx'
import type { AppState } from '../store.ts'

/** Presentation preflight only; the protected Move door checks current chain truth again. */
export const character_deletion_blockers = (state: AppState, character_id: string): readonly string[] => {
  const character = state.session.characters.find(({ id }) => id === character_id)
  if (!character) return ['delete_unavailable']
  const checks = [
    [character.equipment.length > 0, 'delete_equipment'],
    [character.custody === 'fight' || !!character.active_fight, 'delete_fight'],
    [!!state.party.party_by_character[character_id], 'delete_party'],
    [!!character.dungeon_run, 'delete_dungeon'],
    [!!character.ambush, 'delete_ambush'],
    [state.marketplace.own_listings.some(({ id }) => id === character_id), 'delete_listing'],
    [
      !character.kiosk ||
        !state.session.wallet ||
        state.session.link_status !== 'ready' ||
        state.session.game_frozen !== false ||
        indexing_blocked(state.session.link_status, state.session.indexing_lag),
      'delete_unavailable',
    ],
  ] satisfies readonly (readonly [boolean, string])[]
  return checks.flatMap(([blocked, key]) => (blocked ? [key] : []))
}
