// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { lazy, memo, Suspense, type ReactNode } from 'react'
import { CarvedIcon, GameWindow, NativeModal } from '@aresrpg/ui'

import type { AppCopy } from '../i18n/copy.ts'
import type { Page } from '../modules/navigation.ts'
import type { GameSettings } from '../game/core/settings.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { HUD_PAGE_META } from '../game/hud/hud_pages.ts'
import './game_page_window.css'

const AdminControls = lazy(() => import('../admin/AdminControls.tsx'))
const AdminPage = lazy(() => import('../admin/AdminPage.tsx'))
const MasteryPage = lazy(() => import('../mastery/MasteryPage.tsx'))
const SettingsPage = lazy(() => import('../settings/SettingsPage.tsx'))
const KolizeumPage = lazy(() => import('../kolizeum/KolizeumPage.tsx'))

const PageFallback = ({ label }: Readonly<{ label: string }>) => (
  <section className="pointer-events-auto z-[12] grid min-h-full flex-1 place-items-center border border-white/8 bg-surface-low/96 text-[9px] tracking-[0.18em] text-gold uppercase">
    {label}
  </section>
)

/** URLs select feature-modal content; they never replace the world host. */
export const RoutedPage = memo(
  ({
    copy,
    page,
    settings,
    fight_mounted,
  }: Readonly<{
    copy: AppCopy
    page: Page
    settings: GameSettings
    fight_mounted: boolean
  }>) => {
    const views: Record<Page, ReactNode> = {
      world: <></>,
      admin: <AdminPage copy={copy.admin_page} />,
      mastery: <MasteryPage copy={copy} />,
      settings: <SettingsPage copy={copy} settings={settings} />,
      kolizeum: <KolizeumPage copy={copy} fight_mounted={fight_mounted} />,
    }
    return <Suspense fallback={<PageFallback label={copy.loading_universe} />}>{views[page]}</Suspense>
  }
)

export const GamePageWindow = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const page = useAppStore((state) => state.navigation.page)
  const settings = useAppStore((state) => state.settings)
  const fight_mounted = useAppStore((state) => state.fight.mounted)
  if (page === 'world') return null
  const close = () => dispatch_app({ type: 'page/open', page: 'world' })
  const content = <RoutedPage copy={copy} settings={settings} page={page} fight_mounted={fight_mounted} />
  if (page === 'settings') return content
  const meta = HUD_PAGE_META[page]
  return (
    <NativeModal close={close} label={copy[meta.label]} className="aui-modal-scrim">
      <GameWindow
        title={copy[meta.label]}
        meta={
          page === 'admin' ? (
            <Suspense fallback={null}>
              <AdminControls />
            </Suspense>
          ) : undefined
        }
        icon={<CarvedIcon name={meta.icon} />}
        close={close}
        close_label={copy.wallet_close}
        className={`game-page-window aui-live-page ${meta.class_name}`}
      >
        <div className="aui-live-page-content aui-workspace-main">{content}</div>
      </GameWindow>
    </NativeModal>
  )
}
