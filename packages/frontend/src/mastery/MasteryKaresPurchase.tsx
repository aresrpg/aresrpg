// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { Button } from '@aresrpg/ui'
import {
  KARES_PER_MASTERY_POINT,
  mastery_purchase_maximum,
  valid_mastery_purchase_quantity,
} from '@aresrpg/sdk/kares-economics'

import { ModalFrame } from '../components/ModalFrame.tsx'
import { KaresLogo } from '../components/KaresLogo.tsx'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'

import { useMasterySource } from './MasterySource.tsx'

export const MasteryKaresPurchase = ({
  item_type,
  name,
  copy,
}: Readonly<{ item_type: string; name: string; copy: AppCopy }>) => {
  const { balance, mastery, connected, dispatch } = useMasterySource()
  const offer = mastery.offers.find((row) => row.item_type === item_type) ?? { cost: '0', enabled: false }
  const cost = BigInt(offer.cost)
  const maximum = mastery_purchase_maximum(balance ?? 0n, cost)
  const disabled = !connected || !offer.enabled || mastery.pending !== null || maximum === 0
  const [open, set_open] = useState(false)
  const [quantity, set_quantity] = useState('1')
  const count = Number(quantity)
  const valid = valid_mastery_purchase_quantity(count, maximum)
  const numbers = useNumbers()
  const text = copy_text(copy.mastery_page)
  const label = (count: number) =>
    copy.kares_page.buy_kares.replace(
      '{{cost}}',
      cost > 0n ? numbers.number(cost * KARES_PER_MASTERY_POINT * BigInt(count)) : '—'
    )
  const purchase = (count: number) => {
    dispatch({ type: 'mastery/redeem', item_type, payment: 'kares', count })
    set_open(false)
  }
  return (
    <>
      <Button
        tone="neutral"
        data-mastery-payment="kares"
        disabled={disabled}
        title={maximum === 0 ? copy.kares_page.kares_missing : undefined}
        onClick={() => {
          if (maximum > 1) {
            set_quantity('1')
            set_open(true)
          } else purchase(1)
        }}
        type="button"
      >
        <KaresLogo size={16} />
        {label(1)}
      </Button>
      {open && (
        <ModalFrame
          close={() => set_open(false)}
          close_label={copy.wallet_close}
          label={text('buy_quantity')}
          max_width="max-w-sm"
        >
          <form
            className="flex flex-col gap-5 p-5"
            onSubmit={(event) => {
              event.preventDefault()
              if (!disabled && valid) purchase(count)
            }}
          >
            <div className="flex items-center gap-4">
              <img alt="" src={item_detail_icon(item_type) ?? undefined} className="size-20 object-contain" />
              <span className="font-semibold text-gold">{name}</span>
            </div>
            <label className="flex items-center gap-3">
              <span className="text-xs text-muted">{text('buy_quantity')}</span>
              <input
                type="number"
                min={1}
                max={maximum}
                step={1}
                autoFocus
                value={quantity}
                aria-invalid={!valid}
                onChange={(event) => set_quantity(event.target.value)}
                className="h-12 min-w-0 flex-1 border border-border bg-bg px-3 text-lg text-text tabular-nums outline-none focus:border-gold"
              />
              <Button type="button" onClick={() => set_quantity(String(maximum))}>
                {copy.kares_page.max}
              </Button>
            </label>
            <p className="text-xs text-muted">{text('purchase_limit', { count: maximum })}</p>
            <div className="flex justify-end gap-3">
              <Button type="button" onClick={() => set_open(false)}>
                {copy.cancel}
              </Button>
              <Button type="submit" tone="primary" disabled={disabled || !valid}>
                <KaresLogo size={16} />
                {valid ? label(count) : '—'}
              </Button>
            </div>
          </form>
        </ModalFrame>
      )}
    </>
  )
}
