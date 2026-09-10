// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import type { LeaderboardEntry, LeaderboardObservation, LeaderboardSnapshot } from '@aresrpg/protocol'

import type { AuthSession } from '../../src/auth.ts'
import LeaderboardPage from '../../src/leaderboards/LeaderboardPage.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'
import { dispatch_app, useAppStore } from '../../src/store.ts'
import '../../src/tailwind.css'

// The real reducer and page receive simulated server packets. No observers, wallets or RPCs start.
const parameters = new URLSearchParams(location.search)
const address = (id: number): string => `0x${id.toString(16).padStart(64, '0')}`
const entry = (rank: number): LeaderboardEntry => ({
  address: address(rank),
  name:
    parameters.get('state') !== 'single' && rank < 4 ? ['ares.sui', 'farmer.ares.sui', 'miner.sui'][rank - 1]! : null,
  rank,
  score: String(9_007_199_254_740_993n - BigInt(rank)),
  characters: Array.from({ length: 6 }, (_, index) => ({
    name: `Hero ${rank}-${index}`,
    classe: 'senshi',
    level: 200,
  })),
  character_count: 500,
  jobs: [
    { job: 'FARMER', level: 100 },
    { job: 'MINER', level: 89 },
  ],
})
const snapshot = (observation: LeaderboardObservation): LeaderboardSnapshot => ({
  observation,
  reset_at_ms: Date.UTC(2026, 9, 1),
  timestamp_ms: Date.UTC(2026, 8, 9),
  checkpoint: observation.id + 100,
  entries:
    parameters.get('state') === 'empty'
      ? []
      : Array.from({ length: parameters.get('state') === 'single' ? 1 : 100 }, (_, index) => entry(index + 1)),
  self: parameters.get('state') === 'empty' ? null : entry(501),
})
const Probe = () => {
  const observation = useAppStore(({ leaderboards }) => leaderboards.observation)
  useEffect(() => {
    if (parameters.get('state') === 'error') {
      dispatch_app({
        type: 'server/packet',
        packet: { type: 'packet/leaderboard_error', observation, reason: 'unavailable' },
      })
      return
    }
    dispatch_app({ type: 'server/packet', packet: { type: 'packet/leaderboard', snapshot: snapshot(observation) } })
  }, [observation])
  return (
    <main className="flex h-dvh min-w-0 bg-bg font-mono text-text">
      <LeaderboardPage />
    </main>
  )
}
const locale = LOCALES.find(({ code }) => code === parameters.get('locale'))?.code ?? 'en'
void load_app_copy(locale)
  .then((copy) => {
    dispatch_app({ type: 'locale/changed', locale })
    dispatch_app({ type: 'locale/loaded', locale, copy })
    dispatch_app({ type: 'auth/connecting' })
    dispatch_app({ type: 'auth/connected', session: { address: address(501) } as AuthSession })
    dispatch_app({ type: 'page/open', page: 'leaderboard' })
    createRoot(document.getElementById('root')!).render(<Probe />)
  })
  .catch((error: unknown) => console.error('Leaderboard fixture failed', error))
