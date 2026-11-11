// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import type { AgentPairingIdentity } from '@aresrpg/protocol'

import type { AuthSession } from '../auth.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'
import { funding_recipient_current, recall_funding_authorization } from '../funding/recipient.ts'
import { FundingModal } from '../components/AddFundsModal.tsx'
import { external_wallet_view } from '../wallet/view.ts'

/** The existing funding flow must fund the actual failed transaction sender. */
const FundingForSender = ({
  wallet,
  sender,
  pairing,
  copy,
  close,
}: Readonly<{
  wallet: AuthSession
  sender: string
  pairing?: AgentPairingIdentity
  copy: AppCopy
  close: () => void
}>) => {
  const external = useAppStore((app) => app.external_wallet)
  const session = useAppStore((app) => app.session)
  const [authorization] = useState(() =>
    sender !== wallet.address && pairing ? recall_funding_authorization(session, pairing) : null
  )
  const current =
    sender === wallet.address
      ? funding_recipient_current(session, sender)
      : !!authorization && funding_recipient_current(session, sender, authorization)
  if (!current) return <p role="alert">{copy.ui.agent_funding_unverified}</p>
  return (
    <FundingModal
      address={sender}
      warning={authorization ? copy.ui.agent_needs_sui : undefined}
      copy={copy}
      on_close={close}
      authorization={authorization ?? undefined}
      recipient_label={authorization ? copy.ui.add_funds_agent : undefined}
      funding={{
        wallet: external_wallet_view(external),
        source: external.session,
        balance: sender === wallet.address ? session.sui_balance_mist : null,
      }}
    />
  )
}

export const AgentTransferFunding = (
  props: Readonly<{
    wallet: AuthSession | null
    sender: string | null
    pairing?: AgentPairingIdentity | null
    copy: AppCopy
    close: () => void
  }>
) => {
  const { wallet, sender, pairing } = props
  if (!wallet || !sender) return null
  return <FundingForSender {...props} wallet={wallet} sender={sender} pairing={pairing ?? undefined} />
}
