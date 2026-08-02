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
import {
  is_listed_mob_role,
  use_world_corpus,
  type CorpusMob,
  type CorpusWorld,
} from '../pages/encyclopedia/world_corpus'

import { build_mob } from './content.js'

/** Every corpus mob, deduped by template id and sorted by level band — the picker's whole population. PURE
 *  over the worlds it is given: the corpus arrives asynchronously (main.tsx `load_world_corpus`), so callers
 *  read `worlds` off the store and re-derive when it lands — never a `useMemo(..., [])` over module state. */
export const simulator_mob_roster = (worlds: readonly CorpusWorld[]): CorpusMob[] =>
  [...new Map(worlds.flatMap(({ mobs }) => mobs).map((mob) => [mob.id, mob])).values()]
    .filter(({ role }) => is_listed_mob_role(role))
    .sort((left, right) => left.minLevel - right.minLevel || left.name.localeCompare(right.name))

/** The subscribed roster hook — one home for "how a component gets the simulator's mob population". */
export const useMobRoster = (): CorpusMob[] => {
  const worlds = use_world_corpus((state) => state.worlds)
  return useMemo(() => simulator_mob_roster(worlds), [worlds])
}

/** The roster indexed by template id — "which corpus row is this stored pick?". Re-derived when the corpus
 *  lands, never cached in module state: a `??=` index built before the blob arrives would answer "this mob
 *  no longer exists" for every stored seat, for the whole session. */
export const useMobIndex = (): Map<string, CorpusMob> => {
  const roster = useMobRoster()
  return useMemo(() => new Map(roster.map((mob) => [mob.id, mob])), [roster])
}

/**
 * The picker's whole CONTENT derivation, portal-free: subscribed roster → modal rows + the empty line.
 * Split out because SearchPickerModal renders through `createPortal`, which this repo's SSR test harness
 * (no jsdom/happy-dom — see PetFeedModal.test.jsx) cannot resolve; the component below is a pass-through
 * shell over it, so driving this hook drives the picker.
 *
 * `empty_label`: absence is NOT emptiness (cache law). Until a load settles the list says LOADING — the
 * old picker rendered "NO RESULTS FOUND · 0/0" forever, because nothing ever loaded the corpus and a
 * `useMemo(..., [])` over module state could not have noticed if something had.
 */
export function useMobPickerContent(): { roster: CorpusMob[]; items: PickerItem[]; empty_label?: string } {
  const { t } = useTranslation()
  const roster = useMobRoster()
  const status = use_world_corpus((state) => state.status)

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

  return { roster, items, empty_label: status === 'loading' ? t('simulator.mob_roster_loading') : undefined }
}

export function MobPicker({
  on_pick,
  on_close,
  value,
}: Readonly<{ on_pick: (mob: CorpusMob) => void; on_close: () => void; value?: string }>) {
  const { t } = useTranslation()
  const { roster, items, empty_label } = useMobPickerContent()

  return (
    <SearchPickerModal
      title={t('simulator.pick_mob')}
      items={items}
      empty_label={empty_label}
      value={value}
      on_close={on_close}
      on_select={(id) => {
        const mob = roster.find((row) => row.id === id)
        if (mob) on_pick(mob)
      }}
    />
  )
}
