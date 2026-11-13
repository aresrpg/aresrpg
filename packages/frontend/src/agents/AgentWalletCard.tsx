// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useRef, useState } from 'react'
import { Bot } from 'lucide-react'

import { WalletMenu } from '../components/WalletCard.tsx'
import { SendSuiModal } from '../components/SendSuiModal.tsx'
import type { AppCopy } from '../i18n/copy.ts'
import type { SessionState } from '../modules/session.ts'
import { dispatch_app, read_app_state } from '../store.ts'
import { run_direct_transaction } from '../transaction_guard.ts'

import { same_inventory_pairing } from './inventory_state.ts'
import { AgentTransferFunding } from './AgentTransferFunding.tsx'
import { agent_wallet_current } from './agent_wallet.ts'

export const AgentWalletBalance = ({ copy, session }: Readonly<{ copy: AppCopy; session: SessionState }>) => {
  const pairing = session.agent_view.request?.pairing
  if (!pairing) return null
  return (
    <AgentWalletCard
      key={`${session.wallet?.address}:${session.agent_view.serial}:${session.selected_character_id}`}
      copy={copy}
      session={session}
    />
  )
}

const AgentWalletCard = ({ copy, session }: Readonly<{ copy: AppCopy; session: SessionState }>) => {
  const [opened] = useState(session)
  const [modal, set_modal] = useState<'funds' | 'send' | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    // eslint-disable-next-line functional/immutable-data -- Lifecycle revokes unsigned transfers after dismissal.
    mounted.current = true
    return () => {
      // eslint-disable-next-line functional/immutable-data -- Pending SDK preparation must not sign after unmount.
      mounted.current = false
    }
  }, [])
  const { pairing } = session.agent_view.request!
  const { wallet } = session
  const current = agent_wallet_current(opened, session)
  const assert_current = () => {
    if (!mounted.current || !agent_wallet_current(opened, read_app_state().session))
      throw new Error('The confirmed wallet or agent changed.')
  }
  const transfer = async () => {
    assert_current()
    const recall = await wallet!.read_agent_recall(pairing)
    assert_current()
    return recall.sui_transfer(assert_current)
  }
  const sender = {
    address: pairing.address,
    resolve_suins_address: (name: string) => wallet!.resolve_suins_address(name),
    estimate_sui_transfer: async (recipient: string, amount: bigint, drain: boolean) =>
      (await transfer()).estimate_sui_transfer(recipient, amount, drain),
    send_sui: (recipient: string, amount: bigint, drain: boolean) => {
      const pending = run_direct_transaction(async () => (await transfer()).send_sui(recipient, amount, drain))
      return pending ?? Promise.reject(new Error('A wallet transaction is already pending.'))
    },
  }
  const balance =
    same_inventory_pairing(pairing, session.inventory_pairing) && session.link_status === 'ready'
      ? session.agent_inventory.sui_balance_mist
      : null
  const active_modal = current ? modal : null
  return (
    <>
      <WalletMenu
        copy={copy}
        label={copy.ui.agent_wallet}
        address={pairing.address}
        sui_balance_mist={balance}
        icon={<Bot size={14} aria-hidden="true" />}
        send={current ? () => set_modal('send') : null}
        funds={current ? () => set_modal('funds') : null}
      />
      {active_modal === 'send' && (
        <SendSuiModal
          balance_mist={balance}
          copy={copy}
          wallet={sender}
          close={() => set_modal(null)}
          open_funds={() => set_modal('funds')}
          on_sent={() => dispatch_app({ type: 'agent/inventory_refresh' })}
          resolve_character={(name) =>
            new Promise((resolve, reject) => dispatch_app({ type: 'wallet/resolve_character', name, resolve, reject }))
          }
        />
      )}
      {active_modal === 'funds' && (
        <AgentTransferFunding
          copy={copy}
          wallet={wallet}
          sender={pairing.address}
          pairing={pairing}
          close={() => set_modal(null)}
        />
      )}
    </>
  )
}
