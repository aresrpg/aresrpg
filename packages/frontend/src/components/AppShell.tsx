// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { lazy, memo, Suspense } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import type { Page } from '../modules/navigation.ts'
import type { SessionState } from '../modules/session.ts'
import { FightLayer } from '../game/fight/FightLayer.tsx'

import { Sidebar } from './Sidebar.tsx'
import { DiscordCard, LanguageCard } from './SidebarCards.tsx'
import { WalletCard } from './WalletCard.tsx'

const EncyclopediaPage = lazy(() => import('../encyclopedia/EncyclopediaPage.tsx'))
const SimulatorPage = lazy(() => import('../simulator/SimulatorPage.tsx'))
const AdminPage = lazy(() => import('../admin/AdminPage.tsx'))

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
    open_path,
  }: Readonly<{
    copy: AppCopy
    page: Page
    pathname: string
    open_path: (pathname: string) => void
  }>) => (
    <>
      {page === 'encyclopedia' && (
        <Suspense fallback={<PageFallback label={copy.loading_universe} />}>
          <EncyclopediaPage copy={copy} navigate={open_path} pathname={pathname} />
        </Suspense>
      )}
      {page === 'simulator' && (
        <Suspense fallback={<PageFallback label={copy.loading_universe} />}>
          <SimulatorPage copy={copy} />
        </Suspense>
      )}
      {page === 'admin' && (
        <Suspense fallback={<PageFallback label={copy.loading_universe} />}>
          <AdminPage copy={copy.admin_page} />
        </Suspense>
      )}
      {page !== 'world' && page !== 'encyclopedia' && page !== 'simulator' && page !== 'admin' && (
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
  page,
  pathname,
  session,
  change_locale,
  disconnect,
  open_page,
  open_path,
  select_character,
}: Readonly<{
  copy: AppCopy
  locale: Locale
  page: Page
  pathname: string
  session: SessionState
  change_locale: (locale: Locale) => void
  disconnect: () => void
  open_page: (page: Page) => void
  open_path: (pathname: string) => void
  select_character: (character_id: string) => void
}>) => (
  <div className="pointer-events-none fixed inset-0 z-[10] flex h-dvh gap-3 overflow-hidden p-3">
    <div className="pointer-events-auto flex min-h-0 shrink-0 flex-col gap-3 overflow-y-auto">
      <Sidebar
        address={session.wallet?.address ?? null}
        characters={session.characters}
        copy={copy}
        open_page={open_page}
        page={page}
        select_character={select_character}
        selected_character_id={session.selected_character_id}
      />
      <WalletCard copy={copy} disconnect={disconnect} session={session} />
      <LanguageCard change_locale={change_locale} locale={locale} />
      <DiscordCard copy={copy} />
    </div>
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <RoutedPage copy={copy} open_path={open_path} page={page} pathname={pathname} />
      <FightLayer copy={copy} />
    </div>
  </div>
)
