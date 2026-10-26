// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export type TournamentTab = 'main' | 'podium'

export const tournament_path = (id: string, tab?: TournamentTab): string =>
  `/kolizeum/tournament/${encodeURIComponent(id)}${tab ? `/${tab}` : ''}`

export const tournament_route = (pathname: string): Readonly<{ id: string | null; tab: TournamentTab | null }> => {
  const parts = pathname.split('/')
  if (parts[2] !== 'tournament') return { id: null, tab: null }
  return {
    id: parts[3] ?? null,
    tab: parts[4] === 'main' || parts[4] === 'podium' ? parts[4] : null,
  }
}
