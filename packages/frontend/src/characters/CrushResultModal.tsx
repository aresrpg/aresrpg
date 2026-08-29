// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Gem, Hammer, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import type { ItemRow } from '@aresrpg/protocol'

import { ModalFrame } from '../components/ModalFrame.tsx'
import { ItemSnapshotTooltip, type ItemSnapshotHover } from '../components/ItemSnapshotTooltip.tsx'
import { crush_results, type CrushPresentation, type CrushResult } from '../crush_result.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'

import { InventoryItemCell } from './InventoryItemCell.tsx'

const CrushRuneCell = ({ copy, item }: Readonly<{ copy: AppCopy; item: Readonly<ItemRow> }>) => {
  const [style, set_style] = useState<CSSProperties | null>(null)
  const hover: ItemSnapshotHover | null = style ? Object.freeze({ style, status: 'ready', item }) : null
  return (
    <>
      <InventoryItemCell
        item={item}
        onPointerEnter={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          set_style(Object.freeze({ left: bounds.left + bounds.width / 2, top: bounds.top - 8 }))
        }}
        onPointerLeave={() => set_style(null)}
      />
      <ItemSnapshotTooltip copy={copy} hover={hover} />
    </>
  )
}

export const CrushProgressDialog = ({ copy, item }: Readonly<{ copy: AppCopy; item: Readonly<ItemRow> }>) => {
  const t = copy_text(copy.characters_page)
  return (
    <ModalFrame close={null} close_label={copy.wallet_close} label={t('crush_title')} max_width="max-w-lg" soft>
      <div className="grid min-h-72 place-items-center p-8" data-crush-progress="">
        <div className="flex flex-col items-center gap-5 text-center">
          <div className="relative grid size-24 place-items-center border border-gold/30 bg-black/20 shadow-[0_0_45px_rgba(200,150,60,0.12)]">
            <InventoryItemCell class_name="!size-20 animate-pulse [animation-duration:650ms]" disabled item={item} />
            <Hammer className="absolute -top-2 -right-2 animate-bounce text-gold" size={24} />
          </div>
          <div>
            <Loader2 className="mx-auto mb-3 animate-spin text-gold" size={18} />
            <p className="text-[10px] tracking-[0.18em] text-gold uppercase">{t('crush_pending')}</p>
          </div>
        </div>
      </div>
    </ModalFrame>
  )
}

const CrushFailureDialog = ({ close, copy, error }: Readonly<{ close: () => void; copy: AppCopy; error: string }>) => {
  const t = copy_text(copy.characters_page)
  return (
    <ModalFrame close={close} close_label={copy.wallet_close} label={t('crush_title')} max_width="max-w-lg" soft>
      <div className="p-6 sm:p-8">
        <p className="text-[10px] tracking-[0.18em] text-[#ff7d94] uppercase">{t('crush_title')}</p>
        <p className="mt-4 text-[10px] leading-6 text-text">{error}</p>
        <button className="btn-outline chr-btn mt-6 w-full" onClick={close} type="button">
          {copy.wallet_close}
        </button>
      </div>
    </ModalFrame>
  )
}

export const CrushResultDialog = ({
  close,
  copy,
  result,
}: Readonly<{ close: () => void; copy: AppCopy; result: Readonly<CrushResult> }>) => {
  const t = copy_text(copy.characters_page)
  return (
    <ModalFrame close={close} close_label={copy.wallet_close} label={t('crush_result_title')} max_width="max-w-lg" soft>
      <div className="relative overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_50%_0%,rgba(200,150,60,0.2),transparent_68%)]" />
        <header className="relative mb-6 flex items-center gap-4 border-b border-gold/20 pb-5">
          <div className="grid size-12 shrink-0 place-items-center border border-gold/40 bg-gold/10 shadow-[0_0_24px_rgba(200,150,60,0.14)]">
            <Hammer className="text-gold" size={22} />
          </div>
          <h2 className="text-sm font-semibold tracking-[0.16em] text-white uppercase">{t('crush_result_title')}</h2>
        </header>

        {result.items.length === 0 ? (
          <div className="relative grid min-h-36 place-items-center border border-white/8 bg-black/20 px-6 text-center">
            <div>
              <Gem className="mx-auto mb-4 text-muted/40" size={28} />
              <p className="text-xs tracking-[0.12em] text-muted uppercase">{t('crush_result_empty')}</p>
            </div>
          </div>
        ) : (
          <div
            className="relative grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1.5"
            data-crush-result-inventory=""
          >
            {result.items.map((item) => (
              <CrushRuneCell copy={copy} item={item} key={item.id} />
            ))}
          </div>
        )}

        <button
          className="mt-6 h-11 w-full cursor-pointer border border-gold/45 bg-gold/10 text-[10px] font-semibold tracking-[0.2em] text-gold uppercase transition-colors hover:bg-gold/18"
          onClick={close}
          type="button"
        >
          {copy.wallet_close}
        </button>
      </div>
    </ModalFrame>
  )
}

export const CrushResultModal = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [presentation, set_presentation] = useState<CrushPresentation | null>(null)
  const close = useCallback(() => set_presentation(null), [])

  useEffect(() => crush_results.subscribe(set_presentation), [])

  if (!presentation) return null
  if (presentation.type === 'crushing') return <CrushProgressDialog copy={copy} item={presentation.item} />
  if (presentation.type === 'failed') return <CrushFailureDialog close={close} copy={copy} error={presentation.error} />
  return <CrushResultDialog close={close} copy={copy} result={presentation.result} />
}
