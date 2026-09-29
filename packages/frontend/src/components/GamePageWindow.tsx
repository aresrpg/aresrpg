// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { lazy, memo, Suspense, type ReactNode } from 'react'
import { CarvedIcon, GameWindow, NativeModal } from '@aresrpg/ui'

import { AdminWalletControl } from '../admin/AdminWalletControl.tsx'
import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import type { Page } from '../modules/navigation.ts'
import type { SessionState } from '../modules/session.ts'
import type { GameSettings } from '../game/core/settings.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { HUD_PAGE_META } from '../game/hud/hud_pages.ts'
const EncyclopediaPage = lazy(() => import('../encyclopedia/EncyclopediaPage.tsx'))
const AdminPage = lazy(() => import('../admin/AdminPage.tsx'))
const KaresPage = lazy(() => import('../kares/KaresPage.tsx'))
const MasteryPage = lazy(() => import('../mastery/MasteryPage.tsx'))
const AirdropPage = lazy(() => import('../airdrop/AirdropPage.tsx'))
const SettingsPage = lazy(() => import('../settings/SettingsPage.tsx'))
const CharactersPage = lazy(() => import('../characters/CharactersPage.tsx'))
const MarketplacePage = lazy(() => import('../marketplace/MarketplacePage.tsx'))
const LeaderboardPage = lazy(() => import('../leaderboards/LeaderboardPage.tsx'))
const KolizeumPage = lazy(() => import('../kolizeum/KolizeumPage.tsx'))

const PageFallback = ({ label }: Readonly<{ label: string }>) => (
  <section className="pointer-events-auto z-[12] grid min-h-full flex-1 place-items-center border border-white/8 bg-surface-low/96 text-[9px] tracking-[0.18em] text-[#c8963c] uppercase">
    {label}
  </section>
)

/** URLs select feature-modal content; they never replace the world host. */
export const RoutedPage = memo(
  ({
    copy,
    locale,
    page,
    pathname,
    session,
    settings,
    fight_mounted,
    open_path,
  }: Readonly<{
    copy: AppCopy
    locale: Locale
    page: Page
    pathname: string
    session: SessionState
    settings: GameSettings
    fight_mounted: boolean
    open_path: (pathname: string) => void
  }>) => {
    const views: Record<Page, ReactNode> = {
      world: <></>,
      leaderboard: <LeaderboardPage />,
      encyclopedia: <EncyclopediaPage copy={copy} navigate={open_path} pathname={pathname} />,
      admin: <AdminPage copy={copy.admin_page} />,
      mastery: <MasteryPage copy={copy} />,
      kares: <KaresPage copy={copy} initial_session={session.wallet} />,
      airdrop: <AirdropPage copy={copy} session={session} />,
      settings: <SettingsPage copy={copy} settings={settings} />,
      characters: <CharactersPage copy={copy} />,
      marketplace: <MarketplacePage copy={copy} locale={locale} />,
      kolizeum: fight_mounted ? <></> : <KolizeumPage copy={copy} />,
    }
    return <Suspense fallback={<PageFallback label={copy.loading_universe} />}>{views[page]}</Suspense>
  }
)

export const GamePageWindow = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const { page, pathname } = useAppStore((state) => state.navigation)
  const locale = useAppStore((state) => state.locale)
  const session = useAppStore((state) => state.session)
  const settings = useAppStore((state) => state.settings)
  const fight_mounted = useAppStore((state) => state.fight.mounted)
  if (page === 'world' || (page === 'kolizeum' && fight_mounted)) return null
  const close = () => dispatch_app({ type: 'page/open', page: 'world' })
  const content = (
    <RoutedPage
      copy={copy}
      locale={locale}
      session={session}
      settings={settings}
      page={page}
      pathname={pathname}
      fight_mounted={fight_mounted}
      open_path={(pathname) => dispatch_app({ type: 'path/open', pathname })}
    />
  )
  if (page === 'settings') return content
  const meta = HUD_PAGE_META[page]
  return (
    <NativeModal close={close} label={copy[meta.label]} className="aui-modal-scrim">
      <GameWindow
        title={copy[meta.label]}
        meta={page === 'admin' ? <AdminWalletControl /> : undefined}
        icon={<CarvedIcon name={meta.icon} />}
        close={close}
        close_label={copy.wallet_close}
        className={`aui-feature-port aui-live-page ${meta.class_name}`}
      >
        <div className="aui-live-page-content aui-workspace-main">{content}</div>
      </GameWindow>
    </NativeModal>
  )
}
