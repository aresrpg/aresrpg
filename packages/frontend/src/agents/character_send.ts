// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentPairingIdentity, CharacterRow } from '@aresrpg/protocol'
import { owner_agent_identity } from '@aresrpg/sdk/agent-recall'

import type { AuthSession } from '../auth.ts'
import type { SessionState } from '../modules/session.ts'

export const character_send_eligible = (character: CharacterRow | undefined): character is CharacterRow =>
  !!character && character.custody === 'kiosk'

export const character_send_equipment = (character: Readonly<CharacterRow>) =>
  character.equipment.map(({ slot, id }) => ({ slot, item_id: id }))

/** The clicked character, verified inventory target and current canonical owner must survive preparation. */
export const character_send_current = (
  session: SessionState,
  wallet: AuthSession,
  pairing: AgentPairingIdentity,
  character: Readonly<CharacterRow>
): boolean => {
  const current = session.characters.find(({ id }) => id === character.id)
  if (!character_send_eligible(current) || current.kiosk !== character.kiosk) return false
  if (JSON.stringify(character_send_equipment(current)) !== JSON.stringify(character_send_equipment(character)))
    return false
  return character_send_target_current(session, wallet, pairing)
}

export const character_send_target_current = (
  session: SessionState,
  wallet: AuthSession,
  pairing: AgentPairingIdentity
): boolean => {
  if (session.wallet !== wallet || pairing.signer_mode !== 'host-persistent') return false
  if (JSON.stringify(session.inventory_pairing) !== JSON.stringify(pairing)) return false
  try {
    owner_agent_identity(pairing, wallet.read_agent_pairing_request?.(crypto.randomUUID()))
    return true
  } catch (error) {
    console.error('Agent recipient does not match the current wallet.', error)
    return false
  }
}
