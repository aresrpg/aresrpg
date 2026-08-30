// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useState } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { BrowsePanel } from './BrowsePanel.tsx'
import { HistoryPanel } from './HistoryPanel.tsx'
import { MarketplaceDisclaimer } from './MarketplaceDisclaimer.tsx'
import { SellPanel } from './SellPanel.tsx'

type Tab = 'BUY' | 'SELL' | 'HISTORY'
const tabs: readonly Tab[] = ['BUY', 'SELL', 'HISTORY']
const colors: Readonly<Record<Tab, string>> = Object.freeze({ BUY: '#c8963c', SELL: '#4a9eff', HISTORY: '#34d399' })

export default function MarketplacePage({ copy, locale }: Readonly<{ copy: AppCopy; locale: Locale }>) {
  const text = copy_text(copy.marketplace_page)
  const group = useAppStore(({ marketplace }) => marketplace.group)
  const settings = useAppStore((state) => state.settings)
  const [tab, set_tab] = useState<Tab>('BUY')
  useEffect(() => {
    dispatch_app({ type: 'market/group_selected', group })
  }, [group])
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
  return (
    <section className="pointer-events-auto relative flex min-h-full min-w-0 flex-1 flex-col overflow-hidden border border-border bg-surface/98 shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
      <i className="pointer-events-none absolute top-1 left-1 size-3 border-t border-l border-[#c8963c]/45" />
      <i className="pointer-events-none absolute top-1 right-1 size-3 border-t border-r border-[#c8963c]/45" />
      <i className="pointer-events-none absolute bottom-1 left-1 size-3 border-b border-l border-[#c8963c]/45" />
      <i className="pointer-events-none absolute right-1 bottom-1 size-3 border-r border-b border-[#c8963c]/45" />
      <header className="shrink-0 border-b border-border bg-surface-high px-5 pt-4 pb-2 text-center">
        <div className="flex items-baseline justify-center gap-4">
          <h2 className="text-[12px] font-semibold tracking-[0.4em] text-[#c8963c] uppercase">{text('title')}</h2>
          <span className="text-[9px] tracking-[0.14em] text-[#777b86] uppercase">{text('subtitle')}</span>
        </div>
        <div className="mx-auto mt-2 h-px w-52 bg-[linear-gradient(90deg,transparent,rgba(200,150,60,.5),transparent)]" />
      </header>
      <div className="shrink-0 overflow-x-auto border-b border-border bg-surface px-6 py-3">
        <div className="relative mx-auto grid max-w-xl grid-cols-3 border border-border bg-surface-low">
          {tabs.map((name) => (
            <button
              aria-selected={tab === name}
              className="relative h-9 cursor-pointer text-[9px] font-semibold tracking-[0.2em] uppercase"
              key={name}
              onClick={() => set_tab(name)}
              role="tab"
              style={{
                color: tab === name ? colors[name] : '#6b7280',
                background: tab === name ? `${colors[name]}12` : 'transparent',
                borderBottom: tab === name ? `1px solid ${colors[name]}` : '1px solid transparent',
              }}
              type="button"
            >
              {text(`tab_${name.toLowerCase()}`)}
            </button>
          ))}
        </div>
      </div>
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
