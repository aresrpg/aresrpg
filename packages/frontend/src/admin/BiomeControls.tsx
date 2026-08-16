// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { catmull_rom, type WorldRecipe } from '@aresrpg/engine'
import { useState } from 'react'

import { item_icon, mob_icon } from '../content/assets.ts'

import { move_spline_knot } from './biome_editor.ts'
import type { JsonPath, JsonValue } from './seed_editor.ts'

const input_class =
  'h-8 border border-white/12 bg-[#090a10] px-2 text-[9px] text-[#dedad2] outline-none focus:border-[#4a9eff]/60'
const button_class =
  'h-7 border border-white/12 px-2 text-[8px] tracking-[0.12em] text-[#858994] uppercase hover:border-[#c8963c]/50 hover:text-[#efbd45] disabled:opacity-30'
const as_record = (value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | null =>
  value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : null

export const SplineEditor = ({
  name,
  knots,
  change,
}: Readonly<{
  name: string
  knots: readonly (readonly [number, number])[]
  change: (knots: readonly (readonly [number, number])[]) => void
}>) => {
  const [dragging, set_dragging] = useState<number | null>(null)
  const width = 640
  const height = 180
  const x_min = Math.min(...knots.map(([x]) => x))
  const x_max = Math.max(...knots.map(([x]) => x))
  const y_low = Math.min(...knots.map(([, y]) => y))
  const y_high = Math.max(...knots.map(([, y]) => y))
  const padding = Math.max(0.1, (y_high - y_low) * 0.15)
  const y_min = y_low - padding
  const y_max = y_high + padding
  const to_x = (x: number): number => 20 + ((x - x_min) / Math.max(0.0001, x_max - x_min)) * (width - 40)
  const to_y = (y: number): number => height - 20 - ((y - y_min) / Math.max(0.0001, y_max - y_min)) * (height - 40)
  const point_from_event = (
    client_x: number,
    client_y: number,
    target: Readonly<SVGSVGElement>
  ): readonly [number, number] => {
    const bounds = target.getBoundingClientRect()
    const px = ((client_x - bounds.left) / bounds.width) * width
    const py = ((client_y - bounds.top) / bounds.height) * height
    return [
      x_min + ((px - 20) / (width - 40)) * (x_max - x_min),
      y_min + ((height - 20 - py) / (height - 40)) * (y_max - y_min),
    ]
  }
  const curve = Array.from({ length: 121 }, (_, index) => {
    const x = x_min + ((x_max - x_min) * index) / 120
    return `${to_x(x)},${to_y(catmull_rom(knots, x))}`
  }).join(' ')
  return (
    <section className="border border-white/10 bg-black/15 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[9px] tracking-[0.14em] text-[#c8963c] uppercase">{name.replaceAll('_', ' ')}</h3>
          <p className="mt-1 text-[7px] text-[#626670]">
            Drag a blue knot; the voxel preview updates from the exact terrain sampler.
          </p>
        </div>
        <button
          className={button_class}
          onClick={() => {
            const last = knots.at(-1)!
            change([...knots, [last[0] + 0.1, last[1]]])
          }}
          type="button"
        >
          + Point
        </button>
      </div>
      <svg
        className="w-full touch-none border border-white/6 bg-[#08080d]"
        onPointerMove={(event) =>
          dragging === null ||
          change(move_spline_knot(knots, dragging, point_from_event(event.clientX, event.clientY, event.currentTarget)))
        }
        onPointerUp={() => set_dragging(null)}
        viewBox={`0 0 ${width} ${height}`}
      >
        <polyline fill="none" points={curve} stroke="#c8963c" strokeWidth="2" />
        {knots.map(([x, y], index) => (
          <circle
            className="cursor-grab fill-[#67adff] stroke-[#07101b]"
            cx={to_x(x)}
            cy={to_y(y)}
            key={`${index}-${x}`}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              set_dragging(index)
            }}
            r="5"
            strokeWidth="2"
          />
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-2">
        {knots.map(([x, y], index) => (
          <div className="flex items-center gap-1 border border-white/7 bg-black/20 p-1" key={`${index}-fields`}>
            <span className="px-1 text-[7px] text-[#5f636d]">{index + 1}</span>
            <input
              className={`${input_class} w-20`}
              onChange={(event) => change(move_spline_knot(knots, index, [Number(event.target.value), y]))}
              step="0.01"
              type="number"
              value={x}
            />
            <input
              className={`${input_class} w-20`}
              onChange={(event) => change(move_spline_knot(knots, index, [x, Number(event.target.value)]))}
              step="0.01"
              type="number"
              value={y}
            />
            <button
              className={button_class}
              disabled={knots.length <= 2}
              onClick={() => change(knots.filter((_, knot) => knot !== index))}
              type="button"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

export const BiomeDefinitions = ({
  recipe,
  change,
}: Readonly<{ recipe: WorldRecipe; change: (path: JsonPath, value: JsonValue) => void }>) => {
  const material_names = Object.keys(recipe.materials)
  return (
    <div className="space-y-3">
      <p className="text-[8px] leading-4 text-[#777b86]">
        Climate values are target coordinates. Weight biases selection after climate distance; land picks named material
        colors.
      </p>
      {recipe.biomes.map((biome, index) => (
        <section
          className="border-l-2 bg-black/15 p-3"
          key={`${biome.name}-${index}`}
          style={{ borderColor: recipe.materials[biome.land.surface] }}
        >
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1">
              <span className="block text-[7px] text-[#777b86] uppercase">Biome</span>
              <input
                className={`${input_class} w-44`}
                onChange={(event) => change(['biomes', index, 'name'], event.target.value)}
                value={biome.name}
              />
            </label>
            <label className="space-y-1">
              <span className="block text-[7px] text-[#777b86] uppercase">Selection weight</span>
              <input
                className={`${input_class} w-24`}
                onChange={(event) => change(['biomes', index, 'weight'], Number(event.target.value))}
                step="0.1"
                type="number"
                value={biome.weight}
              />
            </label>
            {Object.entries(biome.land).map(([role, material]) => (
              <label className="space-y-1" key={role}>
                <span className="block text-[7px] text-[#777b86] uppercase">{role}</span>
                <select
                  className={`${input_class} w-32`}
                  onChange={(event) => change(['biomes', index, 'land', role], event.target.value)}
                  value={material}
                >
                  {material_names.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-white/6 pt-2">
            {Object.entries(biome.climate).map(([axis, value]) => (
              <label className="space-y-1" key={axis}>
                <span className="block text-[7px] text-[#626670] uppercase">{axis}</span>
                <input
                  className={`${input_class} w-24`}
                  onChange={(event) => change(['biomes', index, 'climate', axis], Number(event.target.value))}
                  step="0.01"
                  type="number"
                  value={value}
                />
              </label>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

const BiomeChips = ({
  names,
  selected,
  change,
}: Readonly<{ names: readonly string[]; selected: readonly string[]; change: (value: readonly string[]) => void }>) => (
  <div className="flex flex-wrap gap-1">
    {names.map((name) => (
      <button
        className={`h-6 border px-2 text-[7px] uppercase ${selected.includes(name) ? 'border-[#4a9eff]/45 bg-[#4a9eff]/10 text-[#8fc4ff]' : 'border-white/8 text-[#626670]'}`}
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

const PopulationGroup = ({
  kind,
  rows,
  biome_names,
  change,
}: Readonly<{
  kind: 'mobs' | 'resources'
  rows: readonly JsonValue[]
  biome_names: readonly string[]
  change: (path: JsonPath, value: JsonValue) => void
}>) => {
  const identity = kind === 'mobs' ? 'mob_type' : 'item_type'
  const add = (): void =>
    change(
      [kind],
      [
        ...rows,
        kind === 'mobs'
          ? { mob_type: '', weight_bp: 100, biomes: [] }
          : { item_type: '', job: 'FARMER', tier: 1, protector: '', rare_item_type: '', biomes: [] },
      ]
    )
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[9px] tracking-[0.15em] text-[#c8963c] uppercase">{kind}</h3>
          <p className="mt-1 text-[7px] text-[#626670]">Assign each entry directly to one or more biome pools.</p>
        </div>
        <button className={button_class} onClick={add} type="button">
          + Add
        </button>
      </div>
      {rows.map((value, index) => {
        const row = as_record(value)
        if (!row) return null
        const id = typeof row[identity] === 'string' ? row[identity] : ''
        const biomes = Array.isArray(row.biomes)
          ? row.biomes.filter((name): name is string => typeof name === 'string')
          : []
        const icon = kind === 'mobs' ? mob_icon(id) : item_icon(id)
        return (
          <div
            className="grid grid-cols-[40px_minmax(150px,0.8fr)_minmax(240px,1.2fr)_auto] items-start gap-2 border border-white/8 bg-black/15 p-2"
            key={`${id}-${index}`}
          >
            <span className="grid size-10 place-items-center border border-white/8 bg-black/30">
              {icon ? (
                <img alt="" className="size-full object-contain p-1" src={icon} />
              ) : (
                <small className="text-[6px] text-[#555b66]">NO ICON</small>
              )}
            </span>
            <div className="flex flex-wrap gap-1">
              <input
                className={`${input_class} w-48 max-w-full`}
                onChange={(event) => change([kind, index, identity], event.target.value)}
                value={id}
              />
              {kind === 'mobs' ? (
                <input
                  className={`${input_class} w-24`}
                  onChange={(event) => change([kind, index, 'weight_bp'], Number(event.target.value))}
                  title="Spawn weight (basis points)"
                  type="number"
                  value={typeof row.weight_bp === 'number' ? row.weight_bp : 0}
                />
              ) : (
                <>
                  <input
                    className={`${input_class} w-28`}
                    onChange={(event) => change([kind, index, 'job'], event.target.value)}
                    value={typeof row.job === 'string' ? row.job : ''}
                  />
                  <input
                    className={`${input_class} w-16`}
                    onChange={(event) => change([kind, index, 'tier'], Number(event.target.value))}
                    type="number"
                    value={typeof row.tier === 'number' ? row.tier : 1}
                  />
                  <input
                    className={`${input_class} w-44`}
                    onChange={(event) => change([kind, index, 'protector'], event.target.value)}
                    placeholder="protector"
                    value={typeof row.protector === 'string' ? row.protector : ''}
                  />
                  <input
                    className={`${input_class} w-44`}
                    onChange={(event) => change([kind, index, 'rare_item_type'], event.target.value)}
                    placeholder="rare item"
                    value={typeof row.rare_item_type === 'string' ? row.rare_item_type : ''}
                  />
                </>
              )}
            </div>
            <BiomeChips
              change={(next) => change([kind, index, 'biomes'], next)}
              names={biome_names}
              selected={biomes}
            />
            <button
              className={button_class}
              onClick={() =>
                change(
                  [kind],
                  rows.filter((_, row_index) => row_index !== index)
                )
              }
              type="button"
            >
              Remove
            </button>
          </div>
        )
      })}
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
  <div className="space-y-6">
    <PopulationGroup
      biome_names={biome_names}
      change={change}
      kind="mobs"
      rows={Array.isArray(world.mobs) ? world.mobs : []}
    />
    <PopulationGroup
      biome_names={biome_names}
      change={change}
      kind="resources"
      rows={Array.isArray(world.resources) ? world.resources : []}
    />
  </div>
)
