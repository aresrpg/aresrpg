// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Suspense, useEffect, type ComponentType } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { AdventurePage } from './AdventurePage.tsx'

/** Keep the ending scene through authentication; the entry owns the player observer lifetime. */
export const AdventureRuntime = ({
  copy,
  Player,
  activate_player,
}: Readonly<{
  copy: AppCopy
  Player: ComponentType
  activate_player: () => () => void
}>) => {
  const phase = useAppStore((state) => state.adventure.phase)
  const wallet = useAppStore((state) => state.session.wallet)
  const login_available = phase === 'complete' || phase === 'entered'
  useEffect(() => {
    if (login_available) return activate_player()
  }, [activate_player, login_available])
  useEffect(() => {
    if (phase !== 'complete' || !wallet) return
    dispatch_app({ type: 'adventure/game_entered' })
    dispatch_app({ type: 'path/open', pathname: '/' })
  }, [phase, wallet])
  if (phase !== 'entered') return <AdventurePage copy={copy} />
  return (
    <Suspense
      fallback={<main className="fixed inset-0 grid place-items-center bg-bg text-white">{copy.loading_universe}</main>}
    >
      <Player />
    </Suspense>
  )
}
