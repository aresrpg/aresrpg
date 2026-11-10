// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { complete_agent_handover } from '@aresrpg/sdk/agent-handover'

import type { AppCopy } from '../i18n/copy.ts'
import { read_app_state, dispatch_app } from '../store.ts'
import { run_direct_transaction } from '../transaction_guard.ts'
import { toast } from '../toast.ts'
import { send_text } from '../components/SuiTransferResult.tsx'

import { agent_transfer_error } from './transfer_error.ts'
import { character_send_current, character_send_equipment, character_send_target_current } from './character_send.ts'

/** The menu gesture owns the complete handover; the existing SDK owns both signed transactions. */
export const send_character_to_agent = (character_id: string, copy: AppCopy): void => {
  const { session } = read_app_state()
  const { wallet, inventory_pairing: pairing } = session
  const character = session.characters.find(({ id }) => id === character_id)
  if (!wallet || !pairing || !character || !character_send_current(session, wallet, pairing, character))
    return toast.add(copy.ui.agent_transfer_unavailable, 'info')
  const before_sign = () => {
    if (!character_send_target_current(read_app_state().session, wallet, pairing))
      throw new Error('The confirmed wallet or agent changed.')
  }
  const pending = run_direct_transaction(async () => {
    before_sign()
    const recall = await wallet.read_agent_recall(pairing)
    return complete_agent_handover({
      offer: wallet.agent_deposit(pairing),
      claim: recall.transfer,
      intent: {
        kind: 'offer',
        character_id,
        kiosk: character.kiosk,
        recipient: pairing.address,
        unequip: character_send_equipment(character),
      },
      read: { characters: recall.read_pending_characters, items: recall.read_deposit_items },
      before_sign,
      on_offer: () => {
        if (read_app_state().session.wallet !== wallet) return
        dispatch_app({
          type: 'character/equip_folded',
          character_id,
          equipped: [],
          unequipped: character_send_equipment(character),
        })
        dispatch_app({ type: 'agent/inventory_refresh' })
      },
    })
  })
  if (!pending) return
  const notification = toast.loading(copy.ui.agent_sending)
  void pending.then(
    () => {
      notification.success(send_text(copy, 'success_title'))
      dispatch_app({ type: 'wallet/refresh' })
      dispatch_app({ type: 'agent/inventory_refresh' })
    },
    (error) => {
      notification.error(agent_transfer_error(copy, error))
      if (read_app_state().session.wallet === wallet) dispatch_app({ type: 'agent/inventory_refresh' })
    }
  )
}
