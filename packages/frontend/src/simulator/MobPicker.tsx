// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The established mob picker over the shared searchable picker shell and seed catalog.

import { useMemo } from 'react'

import { SearchPickerModal, type PickerCopy, type PickerItem } from '../components/SearchPickerModal.tsx'
import { mob_icon } from '../content/assets.ts'
import { encyclopedia_catalog, type SeedMob } from '../content/catalog.ts'
import { format_text, type AppCopy } from '../i18n/copy.ts'

export const MobPicker = ({
  close,
  copy,
  pick,
  value,
}: Readonly<{
  close: () => void
  copy: AppCopy
  pick: (mob: SeedMob) => void
  value?: string
}>) => {
  const text = copy.simulator_page
  const items = useMemo<readonly PickerItem[]>(
    () =>
      Object.freeze(
        encyclopedia_catalog.mobs.map((mob) =>
          Object.freeze({
            id: mob.mob_type,
            label: mob.name,
            category: mob.role,
            sublabel: format_text(text.level_range, { min: mob.level_min, max: mob.level_max }),
            icon: mob_icon(mob.mob_type),
            tags: Object.freeze([mob.element]),
          })
        )
      ),
    [text]
  )
  const picker_copy = useMemo<PickerCopy>(
    () =>
      Object.freeze({
        search: (title: string) => format_text(text.picker_search, { title }),
        all: text.picker_all,
        no_results: text.picker_no_results,
        results: (filtered: number, total: number) => format_text(text.picker_results, { filtered, total }),
        selected: (label: string) => format_text(text.picker_selected, { label }),
        new_label: text.picker_new,
      }),
    [text]
  )
  return (
    <SearchPickerModal
      copy={picker_copy}
      items={items}
      on_close={close}
      on_select={(mob_type) => {
        const mob = encyclopedia_catalog.mobs.find((candidate) => candidate.mob_type === mob_type)
        if (mob) pick(mob)
      }}
      title={text.pick_mob}
      value={value}
    />
  )
}
