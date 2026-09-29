// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createContext, useContext } from 'react'

import type { LeaderboardsInput, LeaderboardsState } from '../modules/leaderboards.ts'
import { dispatch_app, useAppStore } from '../store.ts'
export const LeaderboardSourceContext = createContext<Readonly<{
  state: LeaderboardsState
  dispatch: (input: LeaderboardsInput) => void
}> | null>(null)
export const useLeaderboardState = () => {
  const source = useContext(LeaderboardSourceContext)
  const live = useAppStore((state) => state.leaderboards)
  return source?.state ?? live
}
export const useLeaderboardDispatch = () => useContext(LeaderboardSourceContext)?.dispatch ?? dispatch_app
