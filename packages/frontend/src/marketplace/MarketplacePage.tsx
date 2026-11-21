// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useState } from 'react'
import { MarketPage } from '@aresrpg/ui'

import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { BrowsePanel } from './BrowsePanel.tsx'
import { HistoryPanel } from './HistoryPanel.tsx'
import { MarketplaceDisclaimer } from './MarketplaceDisclaimer.tsx'
import { useMarketCapabilities, useMarketPanel, type MarketPanel } from './MarketSource.tsx'
import { SellPanel } from './SellPanel.tsx'
import { MarketVolumeBadge } from './marketplace_model.tsx'

const tabs: readonly MarketPanel[] = ['BUY', 'SELL', 'HISTORY']

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
  const { history } = useMarketCapabilities()
  const offered = tabs.filter((value) => history || value !== 'HISTORY')
  // The source names the panel the page opens on, among those it offers; the player's own choice then stays here.
  const opening = useMarketPanel()
  const [tab, set_tab] = useState<MarketPanel>(offered.includes(opening) ? opening : 'BUY')
  return (
    <MarketPage
      tabs={{
        label: text('title'),
        value: tab,
        on_change: set_tab,
        options: offered.map((value) => ({ value, label: text(`tab_${value.toLowerCase()}`) })),
      }}
      volumes={
        <>
          <MarketVolumeBadge window="24h" partial={volume.history_days < 1} mist={volume.day_mist} text={text} />
          <MarketVolumeBadge window="30d" partial={volume.history_days < 30} mist={volume.month_mist} text={text} />
        </>
      }
    >
      {tab === 'BUY' ? (
        <BrowsePanel text={text} />
      ) : tab === 'SELL' ? (
        <SellPanel text={text} />
      ) : (
        <HistoryPanel locale={locale} text={text} />
      )}
    </MarketPage>
  )
}
