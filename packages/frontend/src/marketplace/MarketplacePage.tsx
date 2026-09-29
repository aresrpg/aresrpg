// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useState } from 'react'
import { SegmentedControl } from '@aresrpg/ui'

import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { BrowsePanel } from './BrowsePanel.tsx'
import { HistoryPanel } from './HistoryPanel.tsx'
import { MarketplaceDisclaimer } from './MarketplaceDisclaimer.tsx'
import { SellPanel } from './SellPanel.tsx'
import { MarketVolumeBadge } from './marketplace_model.tsx'

import './marketplace.css'

type Tab = 'BUY' | 'SELL' | 'HISTORY'
const tabs: readonly Tab[] = ['BUY', 'SELL', 'HISTORY']

export default function MarketplacePage({ copy, locale }: Readonly<{ copy: AppCopy; locale: Locale }>) {
  const text = copy_text(copy.marketplace_page)
  const settings = useAppStore((state) => state.settings)
  const volume = useAppStore(({ marketplace }) => marketplace.volume) ?? {
    day_mist: null,
    month_mist: null,
    history_days: 0,
  }
  useEffect(() => {
    dispatch_app({ type: 'market/opened' })
  }, [])
  if (settings.marketplace_disclaimer_acknowledged !== true)
    return (
      <MarketplaceDisclaimer
        acknowledge={() =>
          dispatch_app({
            type: 'settings/changed',
            settings: Object.freeze({ ...settings, marketplace_disclaimer_acknowledged: true }),
          })
        }
        text={text}
      />
    )
  return <MarketplacePageView copy={copy} locale={locale} volume={volume} />
}

export const MarketplacePageView = ({
  copy,
  locale,
  volume,
}: Readonly<{
  copy: AppCopy
  locale: Locale
  volume: Readonly<{ day_mist: string | null; month_mist: string | null; history_days: number }>
}>) => {
  const text = copy_text(copy.marketplace_page)
  const [tab, set_tab] = useState<Tab>('BUY')
  return (
    <section className="market-page pointer-events-auto relative flex min-h-full min-w-0 flex-1 flex-col overflow-hidden border border-border bg-surface/98 shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
      <i className="pointer-events-none absolute top-1 left-1 size-3 border-t border-l border-[#c8963c]/45" />
      <i className="pointer-events-none absolute top-1 right-1 size-3 border-t border-r border-[#c8963c]/45" />
      <i className="pointer-events-none absolute bottom-1 left-1 size-3 border-b border-l border-[#c8963c]/45" />
      <i className="pointer-events-none absolute right-1 bottom-1 size-3 border-r border-b border-[#c8963c]/45" />
      <header className="market-toolbar">
        <SegmentedControl
          label={text('title')}
          value={tab}
          on_change={set_tab}
          options={tabs.map((value) => ({ value, label: text(`tab_${value.toLowerCase()}`) }))}
        />
        <div className="market-volumes">
          <MarketVolumeBadge window="24h" partial={volume.history_days < 1} mist={volume.day_mist} text={text} />
          <MarketVolumeBadge window="30d" partial={volume.history_days < 30} mist={volume.month_mist} text={text} />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {tab === 'BUY' ? (
          <BrowsePanel text={text} />
        ) : tab === 'SELL' ? (
          <SellPanel text={text} />
        ) : (
          <HistoryPanel locale={locale} text={text} />
        )}
      </div>
    </section>
  )
}
