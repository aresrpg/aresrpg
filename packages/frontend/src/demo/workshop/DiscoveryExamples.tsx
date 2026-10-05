// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import type { LeaderboardMetric, LeaderboardEntry } from '@aresrpg/protocol'
import { Workspace } from '@aresrpg/ui'
import { Trophy } from 'lucide-react'

import {
  initial_inspection,
  reduce_inspection,
  fold_inspection,
  type InspectionInput,
} from '../../leaderboards/inspection.ts'
import LeaderboardPage from '../../leaderboards/LeaderboardPage.tsx'
import { LeaderboardSourceContext } from '../../leaderboards/LeaderboardSource.tsx'
import type { AppCopy } from '../../i18n/copy.ts'

import { WorkshopSurface, preview_people } from './shared.tsx'
export const LeaderboardExample = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [metric, set_metric] = useState<LeaderboardMetric>('xp')
  const [inspection, set_inspection] = useState(initial_inspection)
  const observation = { metric, id: 0 }
  const entries: readonly LeaderboardEntry[] = preview_people.map((person, index) => ({
    address: `0x${String(index + 1).repeat(64)}`,
    name: person.name,
    rank: index + 1,
    score: String((6 - index) * 91234),
    characters: [
      {
        name: person.name,
        classe: person.detail.split(' · ')[0]!.toLowerCase(),
        level: Number(person.detail.split(' · ')[1]),
      },
    ],
    character_count: 1,
    jobs: [
      { job: 'MINER', level: 100 - index * 8 },
      { job: 'TAILOR', level: 80 - index * 4 },
    ],
  }))
  return (
    <LeaderboardSourceContext.Provider
      value={{
        state: {
          observation,
          inspection,
          error: false,
          snapshot: {
            observation,
            entries,
            self: null,
            checkpoint: 123456789,
            timestamp_ms: Date.UTC(2026, 8, 27),
            reset_at_ms: Date.UTC(2026, 9, 1),
          },
        },
        dispatch: (input) => {
          if (input.type === 'leaderboards/select') set_metric(input.metric)
          if (!input.type.startsWith('leaderboards/inspect')) return
          set_inspection((state) => {
            const next = reduce_inspection(state, input as InspectionInput)
            const entry = entries.find(({ address }) => address === next.target?.address)
            if (!entry) return next
            return fold_inspection(next, {
              type: 'packet/inspection_result',
              id: next.id,
              result: next.selected
                ? { kind: 'equipment', equipment: [] }
                : {
                    kind: 'profile',
                    profile: {
                      characters: entry.characters.map((character, index) => ({
                        ...character,
                        id: `0x${String(index + 1).padStart(64, '0')}`,
                      })),
                      character_count: entry.character_count,
                      jobs: entry.jobs,
                      next: null,
                    },
                  },
            })
          })
        },
      }}
    >
      <WorkshopSurface copy={copy} title={copy.leaderboard} icon={<Trophy />}>
        {(header) => (
          <Workspace {...header} className="aui-feature-port aui-rankings-port">
            <LeaderboardPage />
          </Workspace>
        )}
      </WorkshopSurface>
    </LeaderboardSourceContext.Provider>
  )
}
