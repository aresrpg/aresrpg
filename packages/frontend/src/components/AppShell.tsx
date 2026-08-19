// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { lazy, memo, Suspense } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import type { Network } from '../env.ts'
import type { Page } from '../modules/navigation.ts'
import type { SessionState } from '../modules/session.ts'
import type { GameSettings } from '../game/core/settings.ts'
import { FightLayer } from '../game/fight/FightLayer.tsx'

import { CharacterTabs, character_tabs_visible } from './CharacterTabs.tsx'
import { Sidebar } from './Sidebar.tsx'
import { ConnectionCard, DiscordCard, LanguageCard } from './SidebarCards.tsx'
import { WalletCard } from './WalletCard.tsx'

const EncyclopediaPage = lazy(() => import('../encyclopedia/EncyclopediaPage.tsx'))
const AdminPage = lazy(() => import('../admin/AdminPage.tsx'))
const ShopPage = lazy(() => import('../shop/ShopPage.tsx'))
const AirdropPage = lazy(() => import('../airdrop/AirdropPage.tsx'))
const SettingsPage = lazy(() => import('../settings/SettingsPage.tsx'))

const PageFallback = ({ label }: Readonly<{ label: string }>) => (
  <section className="pointer-events-auto z-[12] grid min-h-full flex-1 place-items-center border border-white/8 bg-[#111119]/96 text-[9px] tracking-[0.18em] text-[#c8963c] uppercase">
    {label}
  </section>
)

const RoutedPage = memo(
  ({
    copy,
    page,
    pathname,
    session,
    settings,
    open_path,
  }: Readonly<{
    copy: AppCopy
    page: Page
    pathname: string
    session: SessionState
    settings: GameSettings
    open_path: (pathname: string) => void
  }>) => (
    <>
      {page === 'encyclopedia' && (
        <Suspense fallback={<PageFallback label={copy.loading_universe} />}>
          <EncyclopediaPage copy={copy} navigate={open_path} pathname={pathname} />
        </Suspense>
      )}
      {page === 'admin' && (
        <Suspense fallback={<PageFallback label={copy.loading_universe} />}>
          <AdminPage copy={copy.admin_page} />
        </Suspense>
      )}
      {page === 'shop' && (
        <Suspense fallback={<PageFallback label={copy.loading_universe} />}>
          <ShopPage copy={copy} navigate={open_path} session={session} />
        </Suspense>
      )}
      {page === 'airdrop' && (
        <Suspense fallback={<PageFallback label={copy.loading_universe} />}>
          <AirdropPage copy={copy} session={session} />
        </Suspense>
      )}
      {page === 'settings' && (
        <Suspense fallback={<PageFallback label={copy.loading_universe} />}>
          <SettingsPage copy={copy} settings={settings} />
        </Suspense>
      )}
      {page !== 'world' &&
        page !== 'encyclopedia' &&
        page !== 'admin' &&
        page !== 'shop' &&
        page !== 'airdrop' &&
        page !== 'settings' && (
          <section className="pointer-events-auto z-[12] grid min-h-full min-w-0 flex-1 place-items-center border border-white/8 bg-[#111119]/96 text-center shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl">
            <div>
              <p className="text-[8px] tracking-[0.26em] text-[#c8963c] uppercase">{copy[page]}</p>
              <h2 className="mt-3 text-base font-semibold">{copy.page_pending_title}</h2>
              <p className="mt-2 text-[10px] text-[#777b86]">{copy.page_pending_body}</p>
            </div>
          </section>
        )}
    </>
  )
)

export const AppShell = ({
  copy,
  locale,
  network,
  page,
  pathname,
  session,
  settings,
  change_locale,
  create_character,
  disconnect,
  open_page,
  open_path,
  select_character,
}: Readonly<{
  copy: AppCopy
  locale: Locale
  network: Network
  page: Page
  pathname: string
  session: SessionState
  settings: GameSettings
  change_locale: (locale: Locale) => void
  create_character: () => void
  disconnect: () => void
  open_page: (page: Page) => void
  open_path: (pathname: string) => void
  select_character: (character_id: string) => void
}>) => (
  <div className="pointer-events-none fixed inset-0 z-[10] flex h-dvh flex-col gap-3 overflow-hidden p-3">
    {session.game_frozen === true && (
      <aside
        className="pointer-events-auto border border-[#ff496c]/80 bg-[#8f1028] px-4 py-3 text-center text-[11px] font-bold tracking-[0.12em] text-white uppercase shadow-[0_0_30px_rgba(255,35,78,0.38)]"
        data-game-frozen
        role="alert"
      >
        {copy.game_frozen}
      </aside>
    )}
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
      <div className="pointer-events-auto flex min-h-0 shrink-0 flex-col gap-3 overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <Sidebar
            address={session.wallet?.address ?? null}
            copy={copy}
            open_page={open_page}
            page={page}
            network={network}
          />
          <WalletCard copy={copy} disconnect={disconnect} session={session} />
          <LanguageCard change_locale={change_locale} locale={locale} />
          <DiscordCard copy={copy} />
        </div>
        <ConnectionCard
          copy={copy}
          error={session.link_error}
          indexing_lag={session.indexing_lag}
          violation={session.link_violation}
          latency_ms={session.latency_ms}
          online={session.online}
          status={session.link_status}
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        {character_tabs_visible(page) && (
          <CharacterTabs
            characters={session.characters}
            copy={copy}
            create_character={create_character}
            select_character={select_character}
            selected_character_id={session.selected_character_id}
          />
        )}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <RoutedPage
            copy={copy}
            open_path={open_path}
            page={page}
            pathname={pathname}
            session={session}
            settings={settings}
          />
          <FightLayer copy={copy} />
        </div>
      </div>
    </div>
  </div>
)
