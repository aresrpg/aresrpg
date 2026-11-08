// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentPairingIdentity, CharacterRow } from '@aresrpg/protocol'
import { owner_agent_identity } from '@aresrpg/sdk/agent-recall'

import type { AuthSession } from '../auth.ts'
import type { SessionState } from '../modules/session.ts'

export const character_send_eligible = (character: CharacterRow | undefined): character is CharacterRow =>
  !!character && character.custody === 'kiosk' && character.equipment.length === 0

/** The clicked character, confirmed recipient and current canonical owner must survive preparation. */
export const character_send_current = (
  session: SessionState,
  wallet: AuthSession,
  pairing: AgentPairingIdentity,
  character: Readonly<CharacterRow>
): boolean => {
  if (session.wallet !== wallet || pairing.signer_mode !== 'host-persistent') return false
  if (JSON.stringify(session.inventory_pairing) !== JSON.stringify(pairing)) return false
  const current = session.characters.find(({ id }) => id === character.id)
  if (!character_send_eligible(current) || current.kiosk !== character.kiosk) return false
  try {
    owner_agent_identity(pairing, wallet.read_agent_pairing_request?.(crypto.randomUUID()))
    return true
  } catch (error) {
    console.error('Agent recipient does not match the current wallet.', error)
    return false
  }
}
