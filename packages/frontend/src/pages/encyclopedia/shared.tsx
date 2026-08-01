// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

export const ENCYCLOPEDIA_LAYOUT = {
  center: 'flex-1 flex items-center justify-center',
  detail: 'flex-[3] min-w-[380px] overflow-y-auto border-l border-border',
  empty: 'flex flex-col items-center justify-center gap-3 py-16 text-muted',
  failed: 'flex-1 flex flex-col items-center justify-center gap-3 text-muted',
  filterLabel: 'text-[8px] tracking-[0.15em] uppercase text-muted shrink-0',
  filters: 'flex flex-col gap-2 p-3 border-b border-border shrink-0',
  listRow: 'flex flex-col gap-0.5 px-3 py-2 cursor-pointer',
  rowMeta: 'text-[9px] shrink-0 text-muted',
  scroll: 'flex-1 overflow-y-auto min-h-0',
  searchIcon: 'absolute left-3 top-1/2 -translate-y-1/2 opacity-30 pointer-events-none',
} as const

export function DetailLoading() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-center gap-2 py-8">
      <Loader2 size={14} className="animate-spin text-gold opacity-40" />
      <span className="text-[9px] tracking-[0.2em] uppercase text-muted animate-pulse">
        {t('encyclopedia.loading_details')}
      </span>
    </div>
  )
}
