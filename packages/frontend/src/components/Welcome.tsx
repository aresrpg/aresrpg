// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Button } from '@aresrpg/ui'
import { CHARACTER_PRICE_MIST } from '@aresrpg/sdk/character-price'
import { GAS_BUDGET_MIST } from '@aresrpg/sdk/gas-budget'
import { ArrowRight } from 'lucide-react'

import { character_creation_insufficient } from '../character_creation_funding.ts'
import { env, type Network } from '../env.ts'
import { useSuiUsd } from '../funding/useSuiUsd.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'
import type { SessionState } from '../modules/session.ts'
import { dispatch_app } from '../store.ts'

import { WalletCard } from './WalletCard.tsx'

export const Welcome = ({
  copy,
  create,
  session,
  network = env.network,
}: Readonly<{ copy: AppCopy; create: () => void; session: SessionState; network?: Network }>) => {
  const numbers = useNumbers()
  const price_usd = useSuiUsd(network === 'mainnet')
  const amount = (mist: bigint, decimals: number): string => {
    const sui = `${numbers.sui(mist, decimals)} SUI`
    if (price_usd === null) return sui
    const usd = numbers.number((Number(mist) / 1_000_000_000) * price_usd, {
      style: 'currency',
      currency: 'USD',
    })
    return `${sui} (≈${usd})`
  }
  const funded = session.sui_balance_mist !== null && !character_creation_insufficient(session.sui_balance_mist)
  return (
    <section className="absolute inset-0 z-[140] flex items-center justify-center bg-bg/50 p-3 backdrop-blur-sm sm:p-5">
      <div
        className="aui-panel welcome-card flex max-h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-t-gold p-5 shadow-2xl"
        data-welcome=""
      >
        <header>
          <p className="mb-2 text-[10px] tracking-[0.24em] text-gold uppercase">AresRPG</p>
          <h2 className="text-xl font-semibold text-text">{copy.welcome_title}</h2>
          <p className="mt-3 text-xs leading-relaxed text-muted">{copy.welcome_body}</p>
        </header>
        <p
          className="border-l-2 border-gold/60 bg-gold/5 px-3 py-2 text-xs leading-relaxed text-text"
          data-welcome-cost=""
        >
          {copy.welcome_need_sui
            .replaceAll('{{price}}', amount(CHARACTER_PRICE_MIST, 0))
            .replaceAll('{{fee}}', amount(GAS_BUDGET_MIST, 2))}
        </p>
        <WalletCard
          copy={copy}
          session={session}
          network={network}
          embedded
          disconnect={() => dispatch_app({ type: 'auth/disconnected' })}
        />
        <Button tone="primary" disabled={!funded} onClick={create}>
          {copy.create_character}
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </div>
    </section>
  )
}
