// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useReducer } from 'react'

import { useAppStore } from '../store.ts'
import { select_tournament_view } from '../modules/tournament_selectors.ts'

/** This repaint tick interpolates the existing chain clock; it authorizes no action. */
export const useTournamentView = (selected: string | null = null) => {
  const tournament = useAppStore((state) => state.tournament)
  const chain_clock = useAppStore((state) => state.chain_clock)
  const wallet = useAppStore((state) => state.session.wallet)
  const characters = useAppStore((state) => state.session.characters)
  const selected_character_id = useAppStore((state) => state.session.selected_character_id)
  const [, refresh] = useReducer((tick: number) => tick + 1, 0)
  const ticking = tournament.rows.some((row) => ['open', 'in_progress'].includes(row.status))
  useEffect(() => {
    if (!ticking) return undefined
    const timer = setInterval(refresh, 1000)
    return () => clearInterval(timer)
  }, [ticking])
  const view = select_tournament_view(
    { tournament, chain_clock, session: { wallet, characters, selected_character_id } },
    selected,
    performance.now()
  )
  return { ...view, tournament, wallet, characters }
}

export type TournamentView = Readonly<ReturnType<typeof useTournamentView>>
