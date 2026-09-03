// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { STRUCTURE_PACKS, type WorldRecipe } from '@aresrpg/engine'
import { useState } from 'react'

import type { JsonPath, JsonValue } from './seed_editor.ts'

const input_class =
  'h-7 border border-white/12 bg-bg px-2 text-[8px] text-[#dedad2] outline-none focus:border-[#4a9eff]/60'
const micro_label = 'block text-[7px] tracking-[0.1em] text-[#6f747e] uppercase'

export const BiomeAtmosphere = ({
  recipe,
  replace,
  begin_preview_update,
}: Readonly<{
  recipe: WorldRecipe
  replace: (path: JsonPath, value: JsonValue) => void
  begin_preview_update: () => void
}>) => {
  const [selected_biome, set_selected_biome] = useState(recipe.biomes[0]!.name)
  const biome_index = Math.max(
    0,
    recipe.biomes.findIndex(({ name }) => name === selected_biome)
  )
  const biome = recipe.biomes[biome_index]!
  const selected = biome.structure_packs ?? []
  const toggle = (pack: string): void => {
    begin_preview_update()
    replace(
      ['terrain', 'biomes', biome_index, 'structure_packs'],
      (selected.includes(pack) ? selected.filter((name) => name !== pack) : [...selected, pack]) as JsonValue
    )
  }
  const category_color = Object.freeze({ trees: '#4f9b63', rocks: '#8a9094', ruins: '#c8963c' })
  const ordered = Object.entries(STRUCTURE_PACKS).toSorted(([left], [right]) => {
    const left_match = Number(!left.startsWith(`${biome.name}_`))
    const right_match = Number(!right.startsWith(`${biome.name}_`))
    return left_match - right_match || left.localeCompare(right)
  })
  return (
    <div className="space-y-2">
      <section className="flex items-end gap-2 border-l-2 border-[#4f9b63]/55 bg-black/20 p-2.5">
        <label className="min-w-0 flex-1">
          <span className={micro_label}>Biome</span>
          <select
            className={`${input_class} mt-1 w-full`}
            onChange={(event) => set_selected_biome(event.target.value)}
            value={biome.name}
          >
            {recipe.biomes.map(({ name }) => (
              <option className="bg-bg" key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <span className="pb-2 text-[7px] text-[#777b86]">{selected.length} packs active</span>
      </section>
      <button
        className={`flex w-full items-center justify-between border-l-2 px-2.5 py-2 text-left ${biome.mountain_passes ? 'border-[#c8963c] bg-[#c8963c]/10 text-[#ead8b3]' : 'border-[#292c34] bg-black/16 text-[#858994] hover:bg-white/[0.025]'}`}
        onClick={() => {
          begin_preview_update()
          replace(['terrain', 'biomes', biome_index, 'mountain_passes'], !biome.mountain_passes)
        }}
        type="button"
      >
        <span>
          <strong className="block text-[8px] tracking-[0.08em] uppercase">Colossal mountain passes</strong>
          <span className="mt-0.5 block text-[6px] text-[#666b75]">Rare seeded cuts through tall terrain</span>
        </span>
        <span className="text-[7px] tracking-[0.1em] uppercase">{biome.mountain_passes ? 'On' : 'Off'}</span>
      </button>
      <button
        className={`flex w-full items-center justify-between border-l-2 px-2.5 py-2 text-left ${biome.ravines ? 'border-[#a5634d] bg-[#a5634d]/10 text-[#e4c1ad]' : 'border-[#292c34] bg-black/16 text-[#858994] hover:bg-white/[0.025]'}`}
        onClick={() => {
          begin_preview_update()
          replace(['terrain', 'biomes', biome_index, 'ravines'], !biome.ravines)
        }}
        type="button"
      >
        <span>
          <strong className="block text-[8px] tracking-[0.08em] uppercase">Colossal ravines</strong>
          <span className="mt-0.5 block text-[6px] text-[#666b75]">Rare deep fractures with feathered ends</span>
        </span>
        <span className="text-[7px] tracking-[0.1em] uppercase">{biome.ravines ? 'On' : 'Off'}</span>
      </button>
      <div className="space-y-1">
        {ordered.map(([name, pack]) => {
          const active = selected.includes(name)
          return (
            <button
              className={`grid w-full grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2 border-l-2 px-2.5 py-2 text-left ${active ? 'bg-[#4f9b63]/10 text-[#d7e7d9]' : 'bg-black/16 text-[#858994] hover:bg-white/[0.025]'}`}
              key={name}
              onClick={() => toggle(name)}
              style={{ borderColor: active ? category_color[pack.category] : '#292c34' }}
              type="button"
            >
              <span
                className={`size-2 border ${active ? 'border-[#79c98e] bg-[#4f9b63]' : 'border-white/15 bg-black/30'}`}
              />
              <span className="min-w-0">
                <strong className="block truncate text-[8px] tracking-[0.08em] uppercase">{name}</strong>
                <span className="mt-0.5 block text-[6px] text-[#666b75]">
                  {pack.types.length} types · {pack.category} · {pack.density_bp / 100}% slots
                </span>
              </span>
              <span className="text-right text-[6px] leading-3 text-[#686d77]">
                {pack.spacing}m spacing
                <br />≤ {pack.max_slope} slope
              </span>
            </button>
          )
        })}
      </div>
      <p className="px-1 text-[6px] leading-3 text-[#5f636d]">
        Geometry comes from preprocessed type names. Pack weights and placement rules live in structure_packs.json.
      </p>
    </div>
  )
}
