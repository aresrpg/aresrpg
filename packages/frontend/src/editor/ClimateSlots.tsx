// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { BiomeSlot, WorldRecipe } from '@aresrpg/engine'

import { biome_map_color } from './biome_editor.ts'
import type { JsonPath, JsonValue } from './seed_editor.ts'

export type LandscapeSelection = BiomeSlot | 'ocean'

const bands = ['low', 'mid', 'high'] as const
const band_label = Object.freeze({ low: 'Cold', mid: 'Temperate', high: 'Hot' })
const humidity_label = Object.freeze({ low: 'Dry', mid: 'Moderate', high: 'Wet' })
const input_class =
  'h-7 border border-white/12 bg-[#090a10] px-2 text-[8px] text-[#dedad2] outline-none focus:border-[#4a9eff]/60'

export const ClimateSlots = ({
  recipe,
  selected,
  select,
  replace,
}: Readonly<{
  recipe: WorldRecipe
  selected: LandscapeSelection
  select: (slot: LandscapeSelection) => void
  replace: (path: JsonPath, value: JsonValue) => void
}>) => (
  <section>
    <div className="mb-1.5 grid grid-cols-[3.5rem_repeat(3,minmax(0,1fr))] gap-1">
      <span />
      {bands.map((band) => (
        <span className="text-center text-[6px] tracking-[0.1em] text-[#777b86] uppercase" key={band}>
          {humidity_label[band]}
        </span>
      ))}
      {bands.map((temperature) => (
        <div className="contents" key={temperature}>
          <span className="self-center text-[6px] tracking-[0.08em] text-[#777b86] uppercase">
            {band_label[temperature]}
          </span>
          {bands.map((humidity) => {
            const slot = `${temperature}_${humidity}` as BiomeSlot
            const biome_name = recipe.biome_slots[slot]
            const biome = recipe.biomes.find(({ name }) => name === biome_name)!
            const color = biome_map_color(recipe, biome)
            return (
              <label
                className={`relative flex h-8 min-w-0 items-center border bg-black/25 pl-2 ${selected === slot ? 'border-[#efbd45]/70' : 'border-white/9'}`}
                key={slot}
                onPointerDown={() => select(slot)}
                style={{ borderTopColor: color }}
              >
                <span className="mr-1.5 size-2 shrink-0" style={{ backgroundColor: color }} />
                <select
                  aria-label={`${band_label[temperature]} ${humidity_label[humidity]} biome`}
                  className="min-w-0 flex-1 bg-transparent pr-1 text-[7px] text-[#d8d4cb] outline-none"
                  onChange={(event) => {
                    select(slot)
                    replace(['terrain', 'biome_slots', slot], event.target.value)
                  }}
                  value={biome_name}
                >
                  {recipe.biomes
                    .filter(({ name }) => name !== recipe.ocean?.biome)
                    .map(({ name }) => (
                      <option className="bg-[#090a10]" key={name} value={name}>
                        {name}
                      </option>
                    ))}
                </select>
              </label>
            )
          })}
        </div>
      ))}
    </div>
    {recipe.ocean && (
      <div
        className={`mt-2 flex h-8 w-full items-center gap-2 border bg-black/25 px-2 text-left ${selected === 'ocean' ? 'border-[#efbd45]/70' : 'border-white/9'}`}
      >
        <button
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => select('ocean')}
          type="button"
        >
          <span
            className="size-2 shrink-0"
            style={{ backgroundColor: recipe.materials[recipe.liquid ?? '']?.color ?? '#2e609e' }}
          />
          <span className="text-[7px] tracking-[0.1em] text-[#d8d4cb] uppercase">Ocean</span>
        </button>
        <span className="ml-auto text-[6px] text-[#777b86] uppercase">ground below</span>
        <input
          aria-label="Ocean ground maximum"
          className={`${input_class} w-16 text-right`}
          max="0.99"
          min="0.01"
          onChange={(event) => replace(['terrain', 'ocean', 'ground_max'], Number(event.target.value))}
          onClick={(event) => event.stopPropagation()}
          step="0.01"
          type="number"
          value={recipe.ocean.ground_max}
        />
      </div>
    )}
    <p className="text-[6px] leading-3 text-[#5f636d]">Temperature ↓ · humidity → · neighboring slots blend.</p>
  </section>
)
