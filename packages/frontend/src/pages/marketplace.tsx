// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import { use_marketplace_chain } from '../stores/marketplace_chain'
import { has_collectible_profits } from '../chain/read_kiosk_profits'
import { use_auth } from '../auth'
import { BrowsePanel } from '../components/marketplace/browse_panel'
import { SellPanel } from '../components/marketplace/sell_panel'
import { HistoryPanel } from '../components/marketplace/history_panel'
import { InboxPanel } from '../components/marketplace/inbox_panel'
import { MarketplaceFrameCorners, MarketplaceFrameOrnament } from '../components/marketplace/ornamental_frame'
import { app_mobile_classes, use_mobile_mode } from '../game/screens/hud/mobile_layout.js'

// The player-to-player kiosk marketplace — D750's full-viewport ornamental frame around the four existing modes:
// BUY (category rail + template ledger + listing rows), SELL, HISTORY, and INBOX. The current full BUTTON switch
// remains the house control: animated per-mode fill, reduced-motion support, and keyboard-driven ARIA
// tabs. Shop (first-party TemplateSale) remains a separate page; marketplace writes ride the optimistic chain store.

const NETWORK = ((import.meta as unknown as { env: Record<string, string> }).env?.VITE_NETWORK || 'testnet').trim()

type Tab = 'BUY' | 'SELL' | 'HISTORY' | 'INBOX'
const TAB_ORDER: Tab[] = ['BUY', 'SELL', 'HISTORY', 'INBOX']
// Per-tab active fill (buttons only, house-fitting hues) + the tablist index the sliding thumb reads. Emerald
// (#34d399 = emerald-400, the house "connected" status tone) is third; INBOX (the escrow-gift surface) is
// a violet fourth — a distinct "incoming" tone, same idiom. The thumb width is driven off --tab-count.
const TAB_META: Record<Tab, { i: number; color: string; key: string }> = {
  BUY: { i: 0, color: 'var(--color-gold)', key: 'marketplace.tab_buy' },
  SELL: { i: 1, color: 'var(--color-cyan)', key: 'marketplace.tab_sell' },
  HISTORY: { i: 2, color: '#34d399', key: 'marketplace.tab_history' },
  INBOX: { i: 3, color: '#a78bfa', key: 'gift.inbox.tab' },
}

// Full BUTTON switch as a proper ARIA tablist: roving tabindex + Left/Right/Home/End move selection AND
// focus. The sliding colour thumb is CSS (.mkt-switch in index.css) driven by two custom props the active
// tab sets — transform slides it, background-color cross-fades to the tab's hue; both stop under
// prefers-reduced-motion.
function ModeSwitch({ tab, on_change }: { tab: Tab; on_change: (t: Tab) => void }) {
  const { t } = useTranslation()
  const active = TAB_META[tab]
  // BUILD #180 — HISTORY tab red dot: unclaimed kiosk proceeds are worth surfacing before the player ever
  // opens the tab. House danger-red (index.css .btn-outline--danger's #f87171), decorative only (the
  // COLLECT box inside HISTORY carries the same fact as real text once opened).
  const has_kiosk_profits = use_marketplace_chain((s) => has_collectible_profits(s.kiosk_profits_mist))

  function on_key(e: React.KeyboardEvent) {
    const i = TAB_ORDER.indexOf(tab)
    let next = i
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % TAB_ORDER.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + TAB_ORDER.length) % TAB_ORDER.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TAB_ORDER.length - 1
    else return
    e.preventDefault()
    const to = TAB_ORDER[next]
    on_change(to)
    document.getElementById(`mkt-tab-${to}`)?.focus() // move focus with selection (roving)
  }

  return (
    <div
      role="tablist"
      aria-label={t('marketplace.title')}
      onKeyDown={on_key}
      className="mkt-switch"
      style={
        { '--active': active.i, '--tab-color': active.color, '--tab-count': TAB_ORDER.length } as React.CSSProperties
      }
    >
      <span className="mkt-switch-thumb" aria-hidden="true" />
      {TAB_ORDER.map((tb) => {
        const is_active = tab === tb
        return (
          <button
            key={tb}
            role="tab"
            type="button"
            id={`mkt-tab-${tb}`}
            aria-selected={is_active}
            aria-controls="mkt-tabpanel"
            tabIndex={is_active ? 0 : -1}
            onClick={() => on_change(tb)}
            className="mkt-switch-btn"
          >
            {t(TAB_META[tb].key)}
            {tb === 'HISTORY' && has_kiosk_profits && (
              <span
                aria-hidden="true"
                className="absolute w-1.5 h-1.5 rounded-full"
                style={{ top: 6, right: 12, background: '#f87171', boxShadow: '0 0 6px rgba(248,113,113,0.75)' }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

export function MarketplacePage() {
  const { t } = useTranslation()
  const mobile = use_mobile_mode()
  const classes = app_mobile_classes(mobile)
  const { loading, loaded_once, load, load_kiosk_profits } = use_marketplace_chain()
  const address = use_auth((s) => s.address)
  const [tab, set_tab] = useState<Tab>('BUY')

  // Re-run on address resolve: zkLogin sets the wallet address ASYNC after mount. Depending on `address` re-loads
  // the BUY listings the moment auth is ready. The SELL sweep (own-kiosk read) is NOT fired here — it's lazy,
  // triggered by SellPanel on first SELL-tab view (S-86), so the BUY-path load stays a pure keyless `/v1` read.
  // load_kiosk_profits (BUILD #180) rides the SAME effect — the HISTORY tab's red dot must be visible from
  // ANY tab, so it can't wait for that tab to mount.
  useEffect(() => {
    load()
    load_kiosk_profits()
  }, [address, load, load_kiosk_profits])

  // D121: gate the full-screen spinner on the FIRST load ever (loaded_once), NOT on emptiness. See the store
  // note — with loaded_once the shell paints instantly on revisit and the background load() reconciles (SWR).
  if (loading && !loaded_once) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-gold opacity-40" />
          <span className="text-muted text-[10px] tracking-[0.2em] uppercase animate-pulse">
            {t('marketplace.loading')}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className={`${classes.page} flex flex-1 min-h-0 overflow-hidden p-2 lg:p-3`}>
      <div
        className="relative flex flex-col flex-1 min-h-0 overflow-hidden border border-border"
        style={{
          background: 'rgba(18,18,26,0.95)',
          backdropFilter: 'blur(24px)',
          boxShadow: '0 0 60px rgba(0,0,0,0.5), 0 0 1px rgba(200,150,60,0.15)',
        }}
      >
        <MarketplaceFrameCorners />

        {/* Master's ornamental title shell, kept SUI-only and stretched to the page's full available viewport. */}
        <div
          data-mobile-page-header
          className={`${classes.page_header} flex flex-col items-center px-4 pt-3 pb-1 border-b border-border shrink-0`}
        >
          <div className="relative flex items-center justify-center w-full min-h-5">
            <div className="flex items-baseline justify-center gap-3.5 min-w-0 px-28">
              <span
                className={`${classes.page_title} text-[12px] tracking-[0.4em] uppercase font-semibold text-gradient`}
              >
                {t('marketplace.title')}
              </span>
              <span
                data-page-subtitle
                className={`${classes.page_subtitle} hidden sm:inline text-[9px] tracking-[0.14em] uppercase text-muted/85 truncate`}
              >
                {t('marketplace.subtitle')}
              </span>
            </div>
            <span
              className={`${classes.page_status} absolute right-0 flex items-center gap-2 text-[8px] tracking-[0.18em] uppercase text-muted shrink-0`}
            >
              <i
                className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                style={{ boxShadow: '0 0 6px rgba(52,211,153,0.55)' }}
              />
              Sui &middot; {NETWORK}
            </span>
          </div>
          <MarketplaceFrameOrnament />
        </div>

        {/* Primary mode switch — full BUTTON switch, distinct colour per tab, animated */}
        <div
          data-mobile-page-tabs
          className={`${classes.page_tabs} px-6 py-3 border-b border-border shrink-0 overflow-x-auto overscroll-x-contain`}
        >
          <ModeSwitch tab={tab} on_change={set_tab} />
        </div>

        {/* Content — BUY: browse+purchase · SELL: listings|set-price|inventory · HISTORY: realised sales ledger */}
        <div
          id="mkt-tabpanel"
          role="tabpanel"
          aria-labelledby={`mkt-tab-${tab}`}
          className={`${classes.stack} overflow-y-auto lg:overflow-hidden`}
        >
          {tab === 'BUY' ? (
            <div className="flex flex-col flex-1 lg:min-h-0">
              <BrowsePanel />
            </div>
          ) : tab === 'SELL' ? (
            <SellPanel />
          ) : tab === 'HISTORY' ? (
            <HistoryPanel />
          ) : (
            <InboxPanel />
          )}
        </div>
      </div>
    </div>
  )
}
