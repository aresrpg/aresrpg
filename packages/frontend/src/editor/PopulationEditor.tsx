// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { gatherable_item_types, gatherable_of } from '@aresrpg/immutable'
import { useState } from 'react'

import { ItemReferencePicker } from './ItemReferencePicker.tsx'
import { MobReferencePicker } from './MobReferencePicker.tsx'
import type { JsonPath, JsonValue } from './seed_editor.ts'

const RESOURCE_CATEGORIES = new Set(['resource'])
const NORMAL_MOB_ROLES = new Set(['normal'])

const as_record = (value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | null =>
  value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : null

const BiomeChips = ({
  names,
  selected,
  change,
}: Readonly<{ names: readonly string[]; selected: readonly string[]; change: (value: readonly string[]) => void }>) => (
  <div className="flex min-w-0 flex-wrap items-center gap-1" data-population-biomes="">
    {names.map((name) => (
      <button
        aria-pressed={selected.includes(name)}
        className={`h-6 px-2 text-[7px] tracking-[0.06em] uppercase ${selected.includes(name) ? 'bg-[#4a9eff]/12 text-[#8fc4ff]' : 'text-[#565d68] hover:text-[#9ba2ad]'}`}
        key={name}
        onClick={() =>
          change(selected.includes(name) ? selected.filter((value) => value !== name) : [...selected, name])
        }
        type="button"
      >
        {name}
      </button>
    ))}
  </div>
)

const InlineNumber = ({
  label,
  value,
  change,
  minimum,
  maximum,
}: Readonly<{
  label: string
  value: number
  change: (value: number) => void
  minimum?: number
  maximum?: number
}>) => {
  const [editing, set_editing] = useState(false)
  return editing ? (
    <input
      aria-label={label}
      autoFocus
      className="h-7 w-16 border border-white/10 bg-bg px-1.5 text-right text-[8px] tabular-nums outline-none focus:border-[#4a9eff]/60"
      max={maximum}
      min={minimum}
      onBlur={() => set_editing(false)}
      onChange={(event) => change(Number(event.target.value))}
      type="number"
      value={value}
    />
  ) : (
    <button
      aria-label={`Edit ${label}`}
      className="h-7 cursor-text px-2 text-[8px] tabular-nums text-[#858c97] hover:bg-white/[0.035] hover:text-[#d8d3ca]"
      onClick={() => set_editing(true)}
      type="button"
    >
      {label} {value.toLocaleString()}
    </button>
  )
}

type PopulationProps = Readonly<{
  rows: readonly JsonValue[]
  biome_names: readonly string[]
  change: (path: JsonPath, value: JsonValue) => void
}>

const selected_biomes = (row: Readonly<Record<string, JsonValue>>): readonly string[] =>
  Array.isArray(row.biomes) ? row.biomes.filter((name): name is string => typeof name === 'string') : []

const remove_row = (rows: readonly JsonValue[], index: number): readonly JsonValue[] =>
  rows.filter((_, row_index) => row_index !== index)

const MobsPopulation = ({ rows, biome_names, change }: PopulationProps) => {
  const used = rows.flatMap((value) => {
    const mob_type = as_record(value)?.mob_type
    return typeof mob_type === 'string' ? [mob_type] : []
  })
  return (
    <section>
      <header className="flex items-end justify-between border-b border-white/8 pb-2">
        <div>
          <h3 className="text-[9px] tracking-[0.15em] text-[#c8963c] uppercase">Mobs</h3>
          <p className="mt-1 text-[7px] text-[#626670]">Spawn weight and biome membership.</p>
        </div>
        <span className="text-[7px] tabular-nums text-[#555b66]">{rows.length}</span>
      </header>
      {rows.map((value, index) => {
        const row = as_record(value)
        if (!row) return null
        const mob_type = typeof row.mob_type === 'string' ? row.mob_type : ''
        return (
          <div className="border-b border-white/7 py-1" data-population-row="mob" key={`${mob_type}-${index}`}>
            <div className="flex min-w-0 items-center">
              <span className="w-6 shrink-0 text-center text-[7px] tabular-nums text-[#414751]">{index + 1}</span>
              <MobReferencePicker
                class_name="flex-1 !h-11 !border-0 !bg-transparent !px-1 hover:!border-0"
                excluded={new Set(used.filter((candidate) => candidate !== mob_type))}
                label="world mob"
                roles={NORMAL_MOB_ROLES}
                select={(next) => change(['mobs', index, 'mob_type'], next)}
                value={mob_type}
              />
              <InlineNumber
                change={(next) => change(['mobs', index, 'weight_bp'], next)}
                label="Weight"
                minimum={1}
                value={typeof row.weight_bp === 'number' ? row.weight_bp : 1}
              />
              <button
                aria-label="Remove mob"
                className="grid size-8 shrink-0 place-items-center text-[#873f55] hover:text-[#ff5a8b]"
                onClick={() => change(['mobs'], remove_row(rows, index))}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="flex items-start gap-2 pl-7 pb-1">
              <span className="pt-1.5 text-[6px] tracking-[0.1em] text-[#4f5560] uppercase">Biomes</span>
              <BiomeChips
                change={(next) => change(['mobs', index, 'biomes'], next)}
                names={biome_names}
                selected={selected_biomes(row)}
              />
            </div>
          </div>
        )
      })}
      <div className="flex items-center border-b border-dashed border-white/8" data-population-placeholder="mob">
        <span className="w-6 shrink-0 text-center text-[7px] text-[#414751]">{rows.length + 1}</span>
        <MobReferencePicker
          class_name="flex-1 !h-11 !border-0 !bg-transparent !px-1 hover:!border-0"
          empty_sublabel="Choose once to append"
          excluded={new Set(used)}
          label="add world mob"
          placeholder="Add mob"
          roles={NORMAL_MOB_ROLES}
          select={(mob_type) => change(['mobs'], [...rows, { mob_type, weight_bp: 1_000, biomes: [] }])}
          value=""
        />
      </div>
    </section>
  )
}

const ResourcesPopulation = ({ rows, biome_names, change }: PopulationProps) => {
  const used = rows.flatMap((value) => {
    const item_type = as_record(value)?.item_type
    return typeof item_type === 'string' ? [item_type] : []
  })
  return (
    <section>
      <header className="flex items-end justify-between border-b border-white/8 pb-2">
        <div>
          <h3 className="text-[9px] tracking-[0.15em] text-[#65c993] uppercase">Resources</h3>
          <p className="mt-1 text-[7px] text-[#626670]">Assign immutable gatherables to biome pools.</p>
        </div>
        <span className="text-[7px] tabular-nums text-[#555b66]">{rows.length}</span>
      </header>
      {rows.map((value, index) => {
        const row = as_record(value)
        if (!row) return null
        const item_type = typeof row.item_type === 'string' ? row.item_type : ''
        const gatherable = gatherable_of(item_type)
        return (
          <div className="border-b border-white/7 py-1" data-population-row="resource" key={`${item_type}-${index}`}>
            <div className="flex min-w-0 items-center">
              <span className="w-6 shrink-0 text-center text-[7px] tabular-nums text-[#414751]">{index + 1}</span>
              <ItemReferencePicker
                categories={RESOURCE_CATEGORIES}
                class_name="flex-1 !h-11 !border-0 !bg-transparent !px-1 hover:!border-0"
                excluded={new Set(used.filter((candidate) => candidate !== item_type))}
                item_types={gatherable_item_types}
                label="world resource"
                select={(next) => change(['resources', index, 'item_type'], next)}
                value={item_type}
              />
              <span
                aria-label="Derived resource identity"
                className="shrink-0 px-2 text-[7px] tracking-[0.06em] text-[#69717c]"
              >
                {gatherable ? `${gatherable.job} · T${gatherable.tier}` : 'UNKNOWN'}
              </span>
              <button
                aria-label="Remove resource"
                className="grid size-8 shrink-0 place-items-center text-[#873f55] hover:text-[#ff5a8b]"
                onClick={() => change(['resources'], remove_row(rows, index))}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="flex items-start gap-2 pl-7 pb-1">
              <span className="pt-1.5 text-[6px] tracking-[0.1em] text-[#4f5560] uppercase">Biomes</span>
              <BiomeChips
                change={(next) => change(['resources', index, 'biomes'], next)}
                names={biome_names}
                selected={selected_biomes(row)}
              />
            </div>
          </div>
        )
      })}
      <div className="flex items-center border-b border-dashed border-white/8" data-population-placeholder="resource">
        <span className="w-6 shrink-0 text-center text-[7px] text-[#414751]">{rows.length + 1}</span>
        <ItemReferencePicker
          categories={RESOURCE_CATEGORIES}
          class_name="flex-1 !h-11 !border-0 !bg-transparent !px-1 hover:!border-0"
          empty_sublabel="Choose once to append"
          excluded={new Set(used)}
          item_types={gatherable_item_types}
          label="add world resource"
          placeholder="Add resource"
          select={(item_type) => change(['resources'], [...rows, { item_type, biomes: [] }])}
          value=""
        />
      </div>
    </section>
  )
}

export const PopulationEditor = ({
  world,
  biome_names,
  change,
}: Readonly<{
  world: Readonly<Record<string, JsonValue>>
  biome_names: readonly string[]
  change: (path: JsonPath, value: JsonValue) => void
}>) => (
  <div className="space-y-5" data-population-editor="">
    <MobsPopulation biome_names={biome_names} change={change} rows={Array.isArray(world.mobs) ? world.mobs : []} />
    <ResourcesPopulation
      biome_names={biome_names}
      change={change}
      rows={Array.isArray(world.resources) ? world.resources : []}
    />
  </div>
)
