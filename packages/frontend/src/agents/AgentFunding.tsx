// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Button } from '@aresrpg/ui'
import { ChevronDown, Plus } from 'lucide-react'
import { useState } from 'react'

import { FundingModal } from '../components/AddFundsModal.tsx'
import {
  agent_funding_authorization,
  funding_recipient_current,
  type FundingAuthorization,
} from '../funding/recipient.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'
import { external_wallet_view } from '../wallet/view.ts'

type Destination = Readonly<{ address: string; authorization?: FundingAuthorization }>
/** The normal checkout owns quotes and signing; this menu only selects a verified recipient. */
export const AgentFunding = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const session = useAppStore((state) => state.session)
  const external = useAppStore((state) => state.external_wallet)
  const [destination, set_destination] = useState<Destination | null>(null)
  const authorization = agent_funding_authorization(session)
  const select = (agent: boolean) => {
    if (!session.wallet) return
    if (agent && authorization) set_destination({ address: session.agent_view.request!.pairing.address, authorization })
    else if (!agent) set_destination({ address: session.wallet.address })
  }
  const current = destination && funding_recipient_current(session, destination.address, destination.authorization)
  return (
    <>
      <details className="agent-funding pointer-events-auto">
        <summary className="aui-button aui-button--primary">
          <Plus size={16} />
          {copy.wallet_add_funds}
          <ChevronDown size={14} />
        </summary>
        <div className="aui-panel agent-funding-menu">
          <Button disabled={!session.wallet} onClick={() => select(false)}>
            {copy.wallet_add_funds}
          </Button>
          <Button disabled={!authorization} onClick={() => select(true)}>
            {copy.ui.add_funds_agent}
          </Button>
        </div>
      </details>
      {current && (
        <FundingModal
          key={`${destination.address}:${destination.authorization?.serial ?? 'player'}`}
          address={destination.address}
          authorization={destination.authorization}
          recipient_label={destination.authorization ? copy.ui.add_funds_agent : undefined}
          copy={copy}
          on_close={() => set_destination(null)}
          funding={{
            wallet: external_wallet_view(external),
            source: external.session,
            balance: destination.authorization ? null : session.sui_balance_mist,
          }}
        />
      )}
    </>
  )
}
