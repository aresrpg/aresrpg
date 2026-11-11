// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { execute_agent_transfer } from '@aresrpg/sdk/agent-transfer-actions'
import { complete_agent_handover, AgentHandoverIncomplete } from '@aresrpg/sdk/agent-handover'

import { localized_error } from '../i18n/error_text.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { read_app_state, dispatch_app } from '../store.ts'
import { run_direct_transaction } from '../transaction_guard.ts'
import { toast } from '../toast.ts'
import { send_text } from '../components/SuiTransferResult.tsx'
import { recall_funding_authorization } from '../funding/recipient.ts'

import { agent_transfer_error, agent_transfer_needs_gas } from './transfer_error.ts'
import {
  character_send_current,
  character_send_equipment,
  character_send_target_current,
  read_character_send_intent,
} from './character_send.ts'

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
    const offer = wallet.agent_deposit(pairing)
    await Promise.all([offer.synchronize(), recall.transfer.synchronize()])
    before_sign()
    const intent = await read_character_send_intent(
      wallet.address,
      pairing.address,
      character,
      recall.read_pending_characters
    )
    if (intent.kind === 'claim') {
      try {
        return await execute_agent_transfer({
          actions: recall.transfer,
          intent,
          is_current: () => {
            before_sign()
            return true
          },
        })
      } catch (error) {
        throw new AgentHandoverIncomplete(error, null)
      }
    }
    return complete_agent_handover({
      offer,
      claim: recall.transfer,
      intent,
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
      const needs_agent_funding = error instanceof AgentHandoverIncomplete && agent_transfer_needs_gas(error)
      notification.error(
        needs_agent_funding ? localized_error(copy.ui.agent_needs_sui, error) : agent_transfer_error(copy, error)
      )
      if (needs_agent_funding && character_send_target_current(read_app_state().session, wallet, pairing)) {
        const authorization = recall_funding_authorization(read_app_state().session, pairing)
        if (authorization)
          dispatch_app({
            type: 'funding/open',
            cost_mist: 0n,
            authorization: { ...authorization, require_inventory_pairing: true },
          })
      }
      if (read_app_state().session.wallet === wallet) dispatch_app({ type: 'agent/inventory_refresh' })
    }
  )
}
