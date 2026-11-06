// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button } from '@aresrpg/ui'
import { useState } from 'react'
import type { AgentReturnOffer } from '@aresrpg/sdk/agent-returns'

import type { AuthSession } from '../auth.ts'
import type { AppCopy } from '../i18n/copy.ts'

import { AgentTransferReview } from './AgentTransferReview.tsx'

/** Host supplies a verified incoming offer from the custody projection/receipt.
 * No capability is guessed; claim targets the active human wallet, not the agent address. */
export const AgentReturnReview = ({
  wallet,
  offer,
  copy,
}: Readonly<{
  wallet: AuthSession
  offer: AgentReturnOffer
  copy: AppCopy
}>) => {
  const [confirmed_offer, confirm_offer] = useState<string | null>(null)
  const [cancel, set_cancel] = useState(false)
  const identity = JSON.stringify(offer)
  if (offer.recipient !== wallet.address) return null
  return (
    <section className="space-y-2 break-all" data-agent-return-review="">
      <h3>{copy.ui.agent_return_character}</h3>
      <output>{offer.character_id}</output>
      <p>
        {copy.ui.agent_return_from}: {offer.agent_address}
      </p>
      <p>
        {copy.ui.agent_transfer_recipient}: {offer.recipient}
      </p>
      <label className="block">
        <input
          type="checkbox"
          checked={confirmed_offer === identity}
          onChange={(event) => confirm_offer(event.target.checked ? identity : null)}
        />
        {copy.ui.agent_verify_address}
      </label>
      <Button onClick={() => set_cancel(!cancel)}>
        {cancel ? copy.ui.agent_return_character : copy.ui.agent_return_cancel}
      </Button>
      {confirmed_offer === identity && (
        <AgentTransferReview
          key={JSON.stringify([identity, cancel])}
          wallet={wallet}
          copy={copy}
          allow_submit
          intent={
            cancel
              ? {
                  kind: 'cancel',
                  seller_kiosk: offer.seller_kiosk,
                  purchase_cap: offer.purchase_cap,
                  agent_address: offer.agent_address,
                  equipment: offer.equipment,
                }
              : {
                  kind: 'claim',
                  character_id: offer.character_id,
                  seller_kiosk: offer.seller_kiosk,
                  purchase_cap: offer.purchase_cap,
                  agent_address: offer.agent_address,
                  equipment: offer.equipment,
                }
          }
        />
      )}
    </section>
  )
}
