// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AppCopy } from '../i18n/copy.ts'
import { SendModalShell } from '../components/SendModalShell.tsx'

import { AgentCoinTransfer } from './AgentCoinTransfer.tsx'
import type { TransferDirection } from './inventory_transfer.ts'
import { useAgentKiosk } from './useAgentKiosk.ts'
import '../funding/funding.css'

/**
 * The wallet's Transfer step. It is the game's one coin transfer between the owner's two wallets:
 * the kiosk controller discovers what each side may sign, and the same form moves SUI or KARES.
 * The controller lives only while this step is open.
 */
export const WalletTransferModal = ({
  copy,
  direction,
  close,
}: Readonly<{ copy: AppCopy; direction: TransferDirection; close: () => void }>) => {
  const kiosk = useAgentKiosk(copy, false)
  if (kiosk.snapshot && kiosk.routes)
    return <AgentCoinTransfer token="sui" direction={direction} kiosk={kiosk} copy={copy} close={close} />
  return (
    <SendModalShell close={close} close_label={copy.wallet_close} locked={false} title={copy.ui.wallet_transfer}>
      <p className="aui-wallet-note" role={kiosk.state.error ? 'alert' : 'status'}>
        {kiosk.state.error ?? copy.kares_page.loading}
      </p>
    </SendModalShell>
  )
}
