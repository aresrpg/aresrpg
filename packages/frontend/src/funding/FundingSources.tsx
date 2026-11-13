// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button } from '@aresrpg/ui'

import type { AppCopy } from '../i18n/copy.ts'
import type { AuthSession } from '../auth.ts'
import { format_sui } from '../wallet_amount.ts'
import { WalletSources } from '../wallet/WalletSources.tsx'
import type { WalletView } from '../wallet/model.ts'

export const FundingSources = ({
  owner,
  balance,
  external,
  select_external,
  wallet,
  copy,
  locked,
}: Readonly<{
  owner: AuthSession | null
  balance: bigint | null
  external: boolean
  select_external: (external: boolean) => void
  wallet: WalletView
  copy: AppCopy
  locked: boolean
}>) => (
  <>
    {owner && (
      <div className="flex flex-wrap gap-2" data-funding-owner-source="">
        <Button
          tone={external ? undefined : 'primary'}
          aria-pressed={!external}
          disabled={locked}
          onClick={() => select_external(false)}
        >
          {copy.ui.funding_game_wallet} · {balance === null ? '—' : format_sui(balance, 2)} SUI
        </Button>
        <Button aria-pressed={external} disabled={locked} onClick={() => select_external(true)}>
          {copy.ui.funding_external_wallet}
        </Button>
      </div>
    )}
    {(!owner || external) && <WalletSources wallet={wallet} copy={copy} locked={locked} />}
  </>
)
