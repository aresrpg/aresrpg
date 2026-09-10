// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CharacterRow } from '@aresrpg/protocol'

import type { AppState } from '../store.ts'

/** Use the displayed character's current activity, never the selected tab or a captured roster. */
export const editable_character = (
  state: Readonly<AppState>,
  character_id: string,
  now_ms: number
): Readonly<CharacterRow> | null => {
  const character = state.session.characters.find(({ id }) => id === character_id)
  if (!character || character.custody !== 'kiosk') return null
  const busy = [
    character.active_fight,
    character.ambush,
    (character.at_ms ?? 0) > now_ms && !character.dungeon_run,
    state.world.gathering[character_id],
    state.dungeon.pending_by_character[character_id],
    state.kolizeum.pending_by_character[character_id],
  ].some(Boolean)
  return busy ? null : character
}
