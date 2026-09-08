// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CharacterRow } from '@aresrpg/protocol'

import type { AppInput } from '../store.ts'

import type { SessionState } from './session.ts'

export const with_character_roster = (session: SessionState, rows: readonly CharacterRow[]): SessionState => {
  const characters = rows.filter(({ id }) => !session.deleted_character_ids.includes(id))
  const selected_character_id = characters.some(({ id }) => id === session.selected_character_id)
    ? session.selected_character_id
    : (characters[0]?.id ?? null)
  return Object.freeze({ ...session, characters, selected_character_id })
}

export const fold_character_deletion = (session: SessionState, input: AppInput): SessionState => {
  if (input.type !== 'character/deleted' || input.wallet !== session.wallet) return session
  if (session.deleted_character_ids.includes(input.character_id)) return session
  return with_character_roster(
    { ...session, deleted_character_ids: [...session.deleted_character_ids, input.character_id] },
    session.characters
  )
}
