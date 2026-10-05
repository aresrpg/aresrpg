// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { job_slugs } from '@aresrpg/immutable'
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import type { LeaderboardEntry, LeaderboardObservation, LeaderboardSnapshot, InspectionResult } from '@aresrpg/protocol'

import { inspection_request } from '../../src/leaderboards/inspection.ts'
import type { AuthSession } from '../../src/auth.ts'
import { GamePageWindow } from '../../src/components/GamePageWindow.tsx'
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
  characters: Array.from({ length: 12 }, (_, index) => ({
    name: `Hero ${rank}-${index}`,
    classe: 'senshi',
    level: 200,
  })),
  character_count: 500,
  jobs: job_slugs.map((job, index) => ({ job, level: 100 - index })),
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
const InspectionProbe = () => {
  const inspection = useAppStore(({ leaderboards }) => leaderboards.inspection)
  useEffect(() => {
    const { id, query } = inspection_request(inspection)
    if (!query || inspection.status !== 'loading') return
    const profile = query.kind === 'profile'
    const page =
      profile && query.after ? { start: 21, count: 1, next: null } : { start: 1, count: 20, next: address(20) }
    const result: InspectionResult = profile
      ? {
          kind: 'profile',
          profile: {
            character_count: 21,
            characters: Array.from({ length: page.count }, (_, index) => ({
              id: address(page.start + index),
              name: `Profile Hero ${page.start + index}`,
              classe: 'senshi',
              level: 40 + index,
            })),
            next: page.next,
            jobs: job_slugs.map((job) => ({ job, level: 100 })),
          },
        }
      : {
          kind: 'equipment',
          equipment:
            parameters.get('inspection') === 'missing'
              ? null
              : [
                  {
                    id: address(90),
                    slot: 'weapon',
                    name: 'Equipped blade',
                    item_type: 'theban_scrapblade',
                    category: 'sword',
                    level: 40,
                    amount: 1,
                    stats: { vitality: 32793, strength: 32783 },
                    damages: [{ element: 'earth', from: 5, to: 10, damage_type: 'damage' }],
                  },
                ],
        }
    const timer = setTimeout(
      () =>
        dispatch_app({
          type: 'server/packet',
          packet:
            parameters.get('inspection') === 'error'
              ? { type: 'packet/inspection_error', id }
              : { type: 'packet/inspection_result', id, result },
        }),
      50
    )
    return () => clearTimeout(timer)
  }, [inspection])
  return null
}

const Probe = () => {
  const copy = useAppStore((state) => state.copy)
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
      <InspectionProbe />
      {copy && <GamePageWindow copy={copy} />}
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
