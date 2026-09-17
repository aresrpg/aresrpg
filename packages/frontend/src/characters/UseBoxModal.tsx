// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useLayoutEffect, useRef, useState } from 'react'
import { LOOT_BOX_BATCH_LIMIT } from '@aresrpg/sdk/character'
import type { ItemRow } from '@aresrpg/protocol'

import { ModalFrame } from '../components/ModalFrame.tsx'
import { item_detail_icon } from '../content/item_detail_assets.ts'
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
  const amount_input = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    amount_input.current?.focus()
  }, [opening])
  const amount = Number(count)
  const valid = Number.isInteger(amount) && amount >= 1 && amount <= maximum
  const text = copy_text(copy.characters_page)
  if (opening !== null) return <BoxReveal box={box} count={opening} copy={copy} close={close} />
  return (
    <ModalFrame close={close} close_label={copy.wallet_close} label={text('use_amount')} max_width="max-w-sm">
      <form
        className="flex w-full flex-col gap-5 p-5 font-mono"
        onSubmit={(event) => {
          event.preventDefault()
          if (valid) set_opening(amount)
        }}
      >
        <div className="flex items-center gap-4 pr-7">
          <div className="grid size-16 shrink-0 place-items-center border border-gold/20 bg-gold/5 p-2">
            <img alt="" className="size-full object-contain" src={item_detail_icon(box.item_type) ?? undefined} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[9px] tracking-[0.2em] text-gold uppercase">{text('use_amount')}</h3>
            <p className="mt-2 text-xs font-semibold text-text uppercase">{box.name}</p>
          </div>
        </div>
        <label className="flex items-center border border-border bg-bg focus-within:border-gold/50">
          <span className="sr-only">{text('use_amount')}</span>
          <input
            className="h-12 min-w-0 flex-1 bg-transparent px-4 text-lg text-text tabular-nums outline-none"
            type="number"
            min={1}
            max={maximum}
            step={1}
            value={count}
            ref={amount_input}
            onChange={(event) => set_count(event.target.value)}
            autoFocus
          />
          <button
            type="button"
            className="mr-3 cursor-pointer border border-gold/25 bg-gold/5 px-3 py-1.5 text-[9px] tracking-widest text-gold hover:bg-gold/15"
            onClick={() => set_count(String(maximum))}
          >
            {text('common.max')}
          </button>
        </label>
        <p className="-mt-3 text-[10px] text-muted">{text('box_batch_limit', { count: maximum })}</p>
        <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
          <button
            type="button"
            className="h-10 cursor-pointer border border-border text-[10px] tracking-widest text-muted uppercase hover:border-gold/40 hover:text-text"
            onClick={close}
          >
            {text('cancel')}
          </button>
          <button
            type="submit"
            className="h-10 cursor-pointer border border-gold/60 bg-gold/15 text-[10px] font-semibold tracking-widest text-gold uppercase hover:bg-gold/25 disabled:cursor-default disabled:opacity-35"
            disabled={!valid}
          >
            {text('menu_consume')}
          </button>
        </div>
      </form>
    </ModalFrame>
  )
}
