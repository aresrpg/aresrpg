// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Check, Copy, Wallet } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@aresrpg/ui'

import { capture_analytics } from '../analytics.ts'
import type { FundingMethod } from '../funding/analytics.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'

import { useCopy } from './useCopy.ts'

/** The game account's SUI address with copy: shared by Add Funds and the gift page's fund step. */
export const WalletAddressBlock = ({
  address,
  compact,
  copy,
  method,
  recipient_label,
}: Readonly<{
  address: string
  compact?: boolean
  copy: AppCopy
  method: FundingMethod
  recipient_label?: string
}>) => {
  const text = copy_text(copy.wallet_legacy)
  const [copied, copy_value] = useCopy()
  useEffect(() => {
    if (copied) capture_analytics('funding_address_copied', { method })
  }, [copied, method])
  const copy_address = (): void => {
    if (address) copy_value(address)
  }
  return (
    <section>
      {!compact && (
        <>
          <h3 className="mb-2 text-[11px] font-semibold tracking-[0.2em] text-gold uppercase">
            {recipient_label ?? text('your_address')}
          </h3>
          <p className="mb-3 text-[10px] tracking-wide text-muted">{text('send_sui')}</p>
        </>
      )}
      <Button className="aui-funding-address" disabled={!address} onClick={copy_address} type="button">
        <Wallet className="shrink-0 text-gold opacity-60" size={14} />
        <span className="flex-1 select-all break-all text-left font-mono text-[11px] tracking-wide text-gold">
          {address || copy.sign_in_to_play}
        </span>
        {copied ? (
          <Check className="shrink-0 text-emerald-400 opacity-80" size={14} />
        ) : (
          <Copy className="shrink-0 opacity-40 transition-opacity group-hover:opacity-80" size={14} />
        )}
      </Button>
    </section>
  )
}
