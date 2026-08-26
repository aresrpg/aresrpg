// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { STRUCTURE_TYPES } from '@aresrpg/engine'

import {
  as_record,
  button_class,
  NumberField,
  number_value,
  SelectField,
  SheetSection,
  string_value,
} from './ContentFields.tsx'
import type { JsonPath, JsonValue } from './seed_editor.ts'

const type_names = Object.freeze(Object.keys(STRUCTURE_TYPES).toSorted())

export const StructurePackEditor = ({
  value,
  on_change,
  save,
}: Readonly<{ value: JsonValue; on_change: (path: JsonPath, value: JsonValue) => void; save?: () => void }>) => {
  const pack = as_record(value)
  if (!pack) return null
  const rows = Array.isArray(pack.types) ? pack.types : []
  const replace_rows = (next: readonly JsonValue[]): void => on_change(['types'], Object.freeze(next))
  return (
    <div className="mx-auto max-w-3xl space-y-5" data-content-editor="structure-pack">
      <SheetSection
        accent="#65a875"
        note="One deterministic sparse slot field. Geometry bounds come from the selected preprocessed types."
        title="Placement"
      >
        <div className="flex flex-wrap items-end gap-3">
          <SelectField
            change={(next) => on_change(['category'], next)}
            label="Category"
            options={['trees', 'rocks', 'ruins']}
            value={string_value(pack.category)}
            width="w-28"
          />
          <NumberField
            change={(next) => on_change(['spacing'], next)}
            label="Spacing"
            value={number_value(pack.spacing)}
            width="w-20"
          />
          <NumberField
            change={(next) => on_change(['density_bp'], next)}
            hint="10,000 = every slot"
            label="Density"
            value={number_value(pack.density_bp)}
            width="w-24"
          />
          <NumberField
            change={(next) => on_change(['max_slope'], next)}
            label="Max slope"
            value={number_value(pack.max_slope)}
            width="w-20"
          />
          <NumberField
            change={(next) => on_change(['bury'], next)}
            label="Bury"
            value={number_value(pack.bury)}
            width="w-16"
          />
        </div>
      </SheetSection>
      <SheetSection
        accent="#c8963c"
        note="Weights are relative inside this pack. Larger templates still win overlap resolution."
        title="Weighted types"
      >
        <div className="space-y-1">
          {rows.map((row, index) => {
            const object = as_record(row)
            const type = string_value(object?.type)
            const source = STRUCTURE_TYPES[type]
            return (
              <div
                className="grid grid-cols-[minmax(0,1fr)_5rem_2rem] items-end gap-2 border-l-2 border-white/10 bg-black/18 px-2 py-1.5"
                key={`${type}:${index}`}
              >
                <label className="min-w-0">
                  <span className="mb-1 block text-[7px] tracking-[0.12em] text-[#737883] uppercase">Type</span>
                  <select
                    className="h-8 w-full min-w-0 border border-white/12 bg-bg px-2 text-[8px] outline-none focus:border-[#4a9eff]/70"
                    onChange={(event) =>
                      replace_rows(
                        rows.map((candidate, row_index) =>
                          row_index === index
                            ? Object.freeze({ ...as_record(candidate), type: event.target.value })
                            : candidate
                        )
                      )
                    }
                    value={type}
                  >
                    {type_names.map((name) => (
                      <option className="bg-bg" key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  {source && (
                    <span className="mt-1 block text-[6px] text-[#595e68]">
                      {source.size.join(' × ')} · {source.palette.filter((name) => name !== 'air').join(', ')}
                    </span>
                  )}
                </label>
                <NumberField
                  change={(next) =>
                    replace_rows(
                      rows.map((candidate, row_index) =>
                        row_index === index ? Object.freeze({ ...as_record(candidate), weight: next }) : candidate
                      )
                    )
                  }
                  label="Weight"
                  value={number_value(object?.weight)}
                  width="w-20"
                />
                <button
                  aria-label={`Remove ${type}`}
                  className="mb-0.5 grid size-7 place-items-center border border-white/8 text-[#666b75] hover:border-[#ff5a8b]/40 hover:text-[#ff8caa]"
                  onClick={() => replace_rows(rows.filter((_, row_index) => row_index !== index))}
                  type="button"
                >
                  ×
                </button>
              </div>
            )
          })}
          <button
            className={button_class}
            onClick={() => replace_rows([...rows, Object.freeze({ type: type_names[0]!, weight: 1 })])}
            type="button"
          >
            + Type
          </button>
        </div>
      </SheetSection>
      {save && (
        <button className={`${button_class} !border-[#c8963c]/45 !text-[#efbd45]`} onClick={save} type="button">
          Save structure_packs.json
        </button>
      )}
    </div>
  )
}
