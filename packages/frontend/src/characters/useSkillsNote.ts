// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CharacterRow } from '@aresrpg/protocol'

import { useAppStore } from '../store.ts'

import type { CharacterSession } from './character_session.ts'
import { crafter_note } from './skill_rows.ts'

/** The craft-lock note for the viewed character, from the live roster and settings unless a local
 *  session adapter (the demo workshop) supplies them. */
export const useSkillsNote = (character: Readonly<CharacterRow>, session?: CharacterSession) => {
  const live_roster = useAppStore(({ session: live }) => live.characters)
  const locked_crafter = useAppStore(({ settings }) => settings.always_craft_from_character_id)
  return crafter_note(character.id, session?.crafter_id ?? locked_crafter, session?.roster ?? live_roster)
}
