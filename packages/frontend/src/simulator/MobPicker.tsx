// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/MobPicker.tsx — "which mob stands on this red cell?"
//
// The roster is EVERY mob the published world corpus knows (spec §5): the same authored knowledge the
// encyclopedia's bestiary lists, minus the resource protectors, which are not roster mobs. Rows a fight
// cannot fully describe — the S2 seam, a mob whose combat block was never published — are shown WITH the gap
// named on the row, never quietly filled with invented stats: the simulator would otherwise present a
// fabricated hp pool as chain truth.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { SearchPickerModal, type PickerItem } from '../components/search_picker_modal'
import { is_listed_mob_role, WORLD_CORPUS, type CorpusMob } from '../pages/encyclopedia/world_corpus'

import { build_mob } from './content.js'

/** Every corpus mob, deduped by template id and sorted by level band — the picker's whole population. */
export const simulator_mob_roster = (): CorpusMob[] =>
  [...new Map(WORLD_CORPUS.worlds.flatMap(({ mobs }) => mobs).map((mob) => [mob.id, mob])).values()]
    .filter(({ role }) => is_listed_mob_role(role))
    .sort((left, right) => left.minLevel - right.minLevel || left.name.localeCompare(right.name))

export function MobPicker({
  on_pick,
  on_close,
  value,
}: Readonly<{ on_pick: (mob: CorpusMob) => void; on_close: () => void; value?: string }>) {
  const { t } = useTranslation()
  const roster = useMemo(simulator_mob_roster, [])

  const items: PickerItem[] = useMemo(
    () =>
      roster.map((mob) => {
        const built = build_mob(mob, mob.minLevel)
        const band = t('simulator.mob_band', { min: mob.minLevel, max: mob.maxLevel })
        return {
          id: mob.id,
          label: mob.name,
          category: mob.role ?? undefined,
          sublabel: built.combat_block_published ? band : `${band} · ${t('simulator.combat_block_unpublished')}`,
          tags: mob.element ? [mob.element] : undefined,
        }
      }),
    [roster, t]
  )

  return (
    <SearchPickerModal
      title={t('simulator.pick_mob')}
      items={items}
      value={value}
      on_close={on_close}
      on_select={(id) => {
        const mob = roster.find((row) => row.id === id)
        if (mob) on_pick(mob)
      }}
    />
  )
}
