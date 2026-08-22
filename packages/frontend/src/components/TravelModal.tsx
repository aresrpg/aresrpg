// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The star gate's world picker — the encyclopedia's own world-row DNA (titleized gold name,
// biome line, level band) inside the shared picker shell. Every world lists; the ones above
// the character's level grey out (the chain re-asserts each entry level — greying is manners).
// Picking a world fires ONE join_world transaction and folds its own WorldJoined receipt.

import { useMemo } from 'react'
import { WORLD_GATES } from '@aresrpg/immutable'

import { encyclopedia_catalog, titleize } from '../content/catalog.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'

import { SearchPickerModal, type PickerCopy, type PickerItem } from './SearchPickerModal.tsx'

export const TravelModal = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const wallet = useAppStore((state) => state.session.wallet)
  const character = useAppStore(
    (state) => state.session.characters.find(({ id }) => id === state.session.selected_character_id) ?? null
  )
  const text = copy_text(copy.world_hud)
  const close = (): void => dispatch_app({ type: 'dialog/open', dialog: null })

  const items = useMemo<PickerItem[]>(
    () =>
      WORLD_GATES.map((gate) => {
        const biomes = encyclopedia_catalog.world(gate.name)?.terrain?.biomes.map(({ name }) => titleize(name))
        return {
          id: gate.name,
          label: titleize(gate.name),
          color: '#c8963c',
          sublabel: [text('travel_entry_level', { level: gate.entry_level }), biomes?.join(' · ')]
            .filter(Boolean)
            .join(' · '),
        }
      }),
    [text]
  )
  const locked_ids = useMemo(
    () => new Set(WORLD_GATES.filter((gate) => (character?.level ?? 0) < gate.entry_level).map(({ name }) => name)),
    [character]
  )
  const picker_copy = useMemo<PickerCopy>(
    () =>
      Object.freeze({
        search: (title: string) => text('travel_search', { title }),
        all: copy.simulator_page.picker_all,
        no_results: copy.simulator_page.picker_no_results,
        results: (filtered: number, total: number) => text('travel_showing', { filtered, total: String(total) }),
        selected: (label: string) => text('travel_selected', { label }),
        new_label: copy.simulator_page.picker_new,
      }),
    [copy.simulator_page, text]
  )

  const travel = (world: string): void => {
    if (!wallet || !character) return
    if (world === character.world) return close()
    const pending = toast.loading(text('travel_pending'))
    void wallet.character
      .join_world({
        character_id: character.id,
        world,
        custody: { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap },
      })
      .then(({ joined }) => {
        dispatch_app({ type: 'character/world_joined', character_id: character.id, joined })
        pending.success(text('travel_success', { world: titleize(joined.world) }))
        close()
      })
      .catch(pending.error)
  }

  return (
    <SearchPickerModal
      copy={picker_copy}
      empty_label={text('travel_empty')}
      items={items}
      locked_ids={locked_ids}
      on_close={close}
      on_select={travel}
      title={text('travel_title')}
      value={character?.world ?? undefined}
    />
  )
}
