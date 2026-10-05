// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useMemo, useState } from 'react'
import { Button } from '@aresrpg/ui'
import { job_slugs, character_equipment_slots, equipment_slot_accepts } from '@aresrpg/immutable'

import { copy_text, type AppCopy } from '../../i18n/copy.ts'
import { content_catalog } from '../../content/catalog.ts'
import { adventure_inventory } from '../../adventure/projection.ts'
import { PlayerProfileWindow } from '../../leaderboards/PlayerProfileModal.tsx'
import { LeaderboardSourceContext } from '../../leaderboards/LeaderboardSource.tsx'
import { initial_leaderboards_state, reduce_leaderboards, type LeaderboardsState } from '../../modules/leaderboards.ts'
import { initial_inspection, fold_inspection } from '../../leaderboards/inspection.ts'

import { preview_people } from './shared.tsx'

const TARGET = { address: `0x${'1'.repeat(64)}`, name: 'ares.sui' }
const PEOPLE = preview_people.slice(1, 4).map((person) => ({
  id: person.id,
  name: person.name,
  classe: person.detail.split(' · ')[0]!,
  level: Number(person.detail.split(' · ')[1]),
}))
const PROFILE = {
  characters: PEOPLE,
  character_count: PEOPLE.length,
  next: null,
  jobs: job_slugs.map((job, index) => ({ job, level: 100 - index * 7 })),
}

/** Real presentation and reducer, with seed-derived equipment and no network observer. */
export const PlayerProfileExample = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const gear = useMemo(
    () =>
      character_equipment_slots.flatMap((slot) =>
        adventure_inventory(
          content_catalog.items.filter((item) => equipment_slot_accepts(slot, item.category)).slice(0, 1)
        ).map((item) => ({ ...item, id: `profile-${slot}`, slot }))
      ),
    []
  )
  const [state, set_state] = useState<LeaderboardsState>(() => ({
    ...initial_leaderboards_state(),
    inspection: {
      ...initial_inspection(),
      target: TARGET,
      profile: PROFILE,
      selected: PEOPLE[0]!.id,
      equipment: gear.slice(0, 1),
      status: 'ready' as const,
    },
  }))
  const equipment = [gear.slice(0, 1), gear, []]
  const open = () =>
    set_state((state) => ({
      ...state,
      inspection: { ...initial_inspection(state.inspection.id + 1), target: TARGET, profile: PROFILE, status: 'ready' },
    }))
  return (
    <LeaderboardSourceContext.Provider
      value={{
        state,
        dispatch: (input) => {
          set_state((state) => {
            const next = reduce_leaderboards(state, input)
            const { inspection } = next
            if (!inspection.target) return next
            const result = inspection.selected
              ? {
                  kind: 'equipment' as const,
                  equipment: equipment[PEOPLE.findIndex(({ id }) => id === inspection.selected)]!,
                }
              : { kind: 'profile' as const, profile: PROFILE }
            return {
              ...next,
              inspection: fold_inspection(inspection, { type: 'packet/inspection_result', id: inspection.id, result }),
            }
          })
        },
      }}
    >
      {state.inspection.target ? (
        <PlayerProfileWindow />
      ) : (
        <Button onClick={open}>{copy_text(copy.leaderboard_page)('profile_title')}</Button>
      )}
    </LeaderboardSourceContext.Provider>
  )
}
