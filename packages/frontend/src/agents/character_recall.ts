// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentPairingIdentity, CharacterRow } from '@aresrpg/protocol'

import type { AuthSession } from '../auth.ts'

import { character_send_equipment } from './character_send.ts'

/** The tab's Recall action uses the same verified caps and handover as the former inventory controls. */
export const read_character_recall = async (
  wallet: AuthSession,
  pairing: AgentPairingIdentity,
  character: Readonly<CharacterRow>
) => {
  const [recall, offers] = await Promise.all([
    wallet.read_agent_recall(pairing),
    wallet.read_agent_returns(pairing.address),
  ])
  const pending = offers.filter(({ character_id }) => character_id === character.id)
  if (pending.length > 1) throw new Error('Character return capabilities are ambiguous.')
  const [offer] = pending
  if (offer)
    return { actions: wallet.agent_transfer, intent: { kind: 'claim' as const, ...offer }, handover: undefined }
  return {
    actions: recall.transfer,
    intent: {
      kind: 'offer' as const,
      character_id: character.id,
      kiosk: character.kiosk,
      unequip: character_send_equipment(character),
      recipient: wallet.address,
    },
    handover: {
      claim: wallet.agent_transfer,
      read: {
        characters: () => wallet.read_agent_returns(pairing.address),
        items: recall.read_incoming_items,
      },
    },
  }
}
