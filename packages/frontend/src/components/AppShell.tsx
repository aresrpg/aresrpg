// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { lazy, memo, Suspense, useSyncExternalStore } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import type { Network } from '../env.ts'
import type { Page } from '../modules/navigation.ts'
import type { SessionState } from '../modules/session.ts'
import type { GameSettings } from '../game/core/settings.ts'
import { FightLayer } from '../game/fight/FightLayer.tsx'
import { read_scene, subscribe_scene } from '../game/core/scene_feed.ts'
import { useAppStore } from '../store.ts'
import { mastery_reminder_visible } from '../mastery/model.ts'

import { fight_surface_visible } from './app_layout.ts'
import { CharacterTabs, character_tabs_visible } from './CharacterTabs.tsx'
import { SessionReplacedModal } from './SessionReplacedModal.tsx'
import { Sidebar } from './Sidebar.tsx'
import { ConnectionCard, DiscordCard, LanguageCard } from './SidebarCards.tsx'
import { MaintenanceModal } from './MaintenanceModal.tsx'
import { WalletCard } from './WalletCard.tsx'
import { TradeInbox } from './TradeInbox.tsx'

const EncyclopediaPage = lazy(() => import('../encyclopedia/EncyclopediaPage.tsx'))
const AdminPage = lazy(() => import('../admin/AdminPage.tsx'))
const MasteryPage = lazy(() => import('../mastery/MasteryPage.tsx'))
const AirdropPage = lazy(() => import('../airdrop/AirdropPage.tsx'))
const SettingsPage = lazy(() => import('../settings/SettingsPage.tsx'))
const CharactersPage = lazy(() => import('../characters/CharactersPage.tsx'))
const MarketplacePage = lazy(() => import('../marketplace/MarketplacePage.tsx'))
const KolizeumPage = lazy(() => import('../kolizeum/KolizeumPage.tsx'))

const PageFallback = ({ label }: Readonly<{ label: string }>) => (
  <section className="pointer-events-auto z-[12] grid min-h-full flex-1 place-items-center border border-white/8 bg-surface-low/96 text-[9px] tracking-[0.18em] text-[#c8963c] uppercase">
    {label}
  </section>
)

const ROUTED_PAGES: readonly Page[] = [
  'world',
  'encyclopedia',
  'admin',
  'mastery',
  'airdrop',
  'settings',
  'characters',
  'marketplace',
  'kolizeum',
]

const RoutedPage = memo(
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
      {page === 'mastery' && (
        <Suspense fallback={<PageFallback label={copy.loading_universe} />}>
          <MasteryPage copy={copy} />
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
      {page === 'characters' && (
        <Suspense fallback={<PageFallback label={copy.loading_universe} />}>
          <CharactersPage copy={copy} />
        </Suspense>
      )}
      {page === 'marketplace' && (
        <Suspense fallback={<PageFallback label={copy.loading_universe} />}>
          <MarketplacePage copy={copy} locale={locale} />
        </Suspense>
      )}
      {page === 'kolizeum' && !fight_mounted && (
        <Suspense fallback={<PageFallback label={copy.loading_universe} />}>
          <KolizeumPage copy={copy} />
        </Suspense>
      )}
      {!ROUTED_PAGES.includes(page) && (
        <section className="pointer-events-auto z-[12] grid min-h-full min-w-0 flex-1 place-items-center border border-white/8 bg-surface-low/96 text-center shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl">
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

/** The GAME's fight surface, mounted in the world the engine module owns. This is the ONE place
 *  that reads the game's scene lane — everything downstream receives the handle as an argument,
 *  so no component can wander into a world that is not its own. */
const GameFightLayer = ({ copy, page }: Readonly<{ copy: AppCopy; page: Page }>) => {
  const scene = useSyncExternalStore(subscribe_scene, read_scene, () => null)
  const mounted = useAppStore((state) => state.fight.mounted)
  const environment_key = useAppStore((state) => state.fight.checkpoint?.contract.id ?? 'loading')
  // a previewing modal hydrates the session without mounting the board — mounting is the COMMIT
  return scene && fight_surface_visible(page, mounted) ? (
    <FightLayer key={environment_key} copy={copy} scene={scene} />
  ) : null
}

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
}>) => {
  const fight_mounted = useAppStore((state) => state.fight.mounted)
  const mastery_notification = useAppStore((state) =>
    mastery_reminder_visible(state.session.characters.length, state.mastery.row, state.session.current_epoch)
  )
  return (
    <div className="pointer-events-none fixed inset-0 z-[10] flex h-dvh flex-col gap-3 overflow-hidden p-3">
      {session.link_status === 'replaced' && <SessionReplacedModal copy={copy} />}
      {session.game_frozen === true && page !== 'admin' && <MaintenanceModal copy={copy} />}
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
        <div className="pointer-events-auto flex min-h-0 shrink-0 flex-col gap-3 overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            <Sidebar
              address={session.wallet?.address ?? null}
              copy={copy}
              open_page={open_page}
              page={page}
              network={network}
              mastery_notification={mastery_notification}
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
            <TradeInbox copy={copy} />
            <RoutedPage
              copy={copy}
              locale={locale}
              open_path={open_path}
              page={page}
              pathname={pathname}
              session={session}
              settings={settings}
              fight_mounted={fight_mounted}
            />
            <GameFightLayer copy={copy} page={page} />
          </div>
        </div>
      </div>
    </div>
  )
}
