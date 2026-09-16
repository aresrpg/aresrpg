// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { LOOT_BOX_BATCH_LIMIT } from '@aresrpg/sdk/character'
import type { ItemRow } from '@aresrpg/protocol'

import { ModalFrame } from '../components/ModalFrame.tsx'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { encumbered_asset_ids, stack_merge_sources } from '../inventory_stacks.ts'
import { useAppStore } from '../store.ts'

import { BoxReveal } from './BoxReveal.tsx'

export const UseBoxModal = ({ box, copy, close }: Readonly<{ box: ItemRow; copy: AppCopy; close: () => void }>) => {
  const [count, set_count] = useState('1')
  const inventory = useAppStore(({ session }) => session.inventory)
  const listings = useAppStore(({ marketplace }) => marketplace.own_listings)
  const trades = useAppStore(({ trade }) => trade.rows)
  const blocked = encumbered_asset_ids(listings, trades)
  const live = inventory.find(({ id }) => id === box.id && !blocked.has(id))
  const sources = live ? stack_merge_sources(inventory, blocked, live) : []
  const available = live
    ? live.amount + inventory.filter(({ id }) => sources.includes(id)).reduce((sum, row) => sum + row.amount, 0)
    : 0
  const maximum = Math.min(available, LOOT_BOX_BATCH_LIMIT)
  const [opening, set_opening] = useState<number | null>(available === 1 ? 1 : null)
  const amount = Number(count)
  const valid = Number.isInteger(amount) && amount >= 1 && amount <= maximum
  const text = copy_text(copy.characters_page)
  if (opening !== null) return <BoxReveal box={box} count={opening} copy={copy} close={close} />
  return (
    <ModalFrame close={close} close_label={copy.wallet_close} label={text('use_amount')}>
      <form
        className="flex w-80 max-w-full flex-col gap-4 p-6"
        onSubmit={(event) => {
          event.preventDefault()
          if (valid) set_opening(amount)
        }}
      >
        <h3 className="text-sm text-gold">{text('use_amount')}</h3>
        <p className="text-xs text-muted">{box.name}</p>
        <label className="flex flex-col gap-2 text-xs">
          {text('use_amount')}
          <input
            className="border border-border bg-surface p-2 text-text"
            type="number"
            min={1}
            max={maximum}
            step={1}
            value={count}
            onChange={(event) => set_count(event.target.value)}
            autoFocus
          />
        </label>
        <p className="text-xs text-muted">{text('box_batch_limit', { count: maximum })}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={close}>
            {text('cancel')}
          </button>
          <button type="submit" className="btn-gold" disabled={!valid}>
            {text('menu_consume')}
          </button>
        </div>
      </form>
    </ModalFrame>
  )
}
