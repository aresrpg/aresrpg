// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { as_record, SheetSection, string_value, TextField, titleize_field } from './ContentFields.tsx'
import { ItemContentEditor, type ItemRecipeBinding } from './ItemContentEditor.tsx'
import { JsonEditor } from './JsonEditor.tsx'
import { DungeonEditor } from './DungeonEditor.tsx'
import { MobContentEditor } from './MobContentEditor.tsx'
import type { JsonPath, JsonValue, SeedDomain } from './seed_editor.ts'
import { StructurePackEditor } from './StructurePackEditor.tsx'
import type { ItemFilterRow } from './content_list.ts'

type Props = Readonly<{
  domain: SeedDomain
  value: JsonValue
  on_change: (path: JsonPath, value: JsonValue) => void
  is_readonly: (path: JsonPath) => boolean
  save?: () => void
  item_recipe?: ItemRecipeBinding
  item_filters?: readonly ItemFilterRow[]
  mob_templates?: readonly JsonValue[]
}>

const AirdropEditor = ({ value, on_change, is_readonly }: Pick<Props, 'value' | 'on_change' | 'is_readonly'>) => {
  const row = as_record(value)
  if (!row) return null
  const identity_keys = ['id', 'name', 'kind'] as const
  const identity = identity_keys.filter((key) => key in row)
  const rest = Object.freeze(
    Object.fromEntries(Object.entries(row).filter(([key]) => !identity_keys.includes(key as never)))
  )
  return (
    <div className="mx-auto max-w-3xl space-y-5" data-content-editor="airdrop">
      <section className="flex flex-wrap items-end gap-3 border-b border-white/9 pb-4">
        {identity.map((key) => (
          <TextField
            change={(next) => on_change([key], next)}
            key={key}
            label={titleize_field(key)}
            value={string_value(row[key])}
            width={key === 'name' ? 'w-64' : 'w-44'}
          />
        ))}
      </section>
      {Object.keys(rest).length > 0 && (
        <SheetSection accent="#b584e8" note="Distribution, custody, and asset facts for this entry." title="Entry data">
          <JsonEditor is_readonly={is_readonly} on_change={on_change} value={rest} />
        </SheetSection>
      )}
    </div>
  )
}

export const ContentEntityEditor = ({
  domain,
  value,
  on_change,
  is_readonly,
  save,
  item_recipe,
  item_filters,
  mob_templates,
}: Props) => {
  if (domain === 'items')
    return (
      <ItemContentEditor
        is_readonly={is_readonly}
        item_recipe={item_recipe}
        item_filters={item_filters}
        on_change={on_change}
        save={save}
        value={value}
      />
    )
  if (domain === 'mobs')
    return <MobContentEditor mob_templates={mob_templates} on_change={on_change} save={save} value={value} />
  if (domain === 'dungeons') {
    const dungeon = as_record(value)
    return dungeon ? <DungeonEditor change={on_change} dungeon={dungeon} /> : null
  }
  if (domain === 'airdrop') return <AirdropEditor is_readonly={is_readonly} on_change={on_change} value={value} />
  if (domain === 'structure_packs') return <StructurePackEditor on_change={on_change} save={save} value={value} />
  return <JsonEditor is_readonly={is_readonly} on_change={on_change} value={value} />
}
