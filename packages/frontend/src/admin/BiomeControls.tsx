// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { MATERIAL_PRESETS, landscape_height, type WorldRecipe } from '@aresrpg/engine'
import { useEffect, useRef, useState } from 'react'

import { item_icon, mob_icon } from '../content/assets.ts'

import { move_spline_knot } from './biome_editor.ts'
import type { JsonPath, JsonValue } from './seed_editor.ts'

/* eslint-disable functional/immutable-data -- Pointer-drag drafts and debounce timers are local UI effect boundaries. */

const input_class =
  'h-8 border border-white/12 bg-[#090a10] px-2 text-[9px] text-[#dedad2] outline-none focus:border-[#4a9eff]/60'
const button_class =
  'h-7 border border-white/12 px-2 text-[8px] tracking-[0.12em] text-[#858994] uppercase hover:border-[#c8963c]/50 hover:text-[#efbd45] disabled:opacity-30'
const as_record = (value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | null =>
  value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : null

export const MaterialEditor = ({
  recipe,
  change,
}: Readonly<{ recipe: WorldRecipe; change: (path: JsonPath, value: JsonValue) => void }>) => {
  const [new_name, set_new_name] = useState('')
  const add = (): void => {
    const name = new_name.trim()
    if (!name || recipe.materials[name]) return
    change([], { ...recipe.materials, [name]: { color: '#808080', preset: 'stone' } } as unknown as JsonValue)
    set_new_name('')
  }
  const remove = (name: string): void =>
    change(
      [],
      Object.fromEntries(Object.entries(recipe.materials).filter(([candidate]) => candidate !== name)) as JsonValue
    )
  return (
    <div className="space-y-1">
      {Object.entries(recipe.materials).map(([name, material]) => {
        const referenced =
          recipe.liquid === name ||
          recipe.biomes.some(({ landscape }) =>
            landscape.some(({ land }) => land && Object.values(land).includes(name))
          )
        return (
          <div
            className="grid h-9 grid-cols-[1.5rem_minmax(5rem,1fr)_5.5rem_6rem_1.75rem] items-center gap-1.5 border-l-2 bg-black/18 px-2"
            key={name}
            style={{ borderColor: material.color }}
          >
            <input
              aria-label={`${name} color`}
              className="size-5 cursor-pointer border-0 bg-transparent p-0"
              onChange={(event) => change([name, 'color'], event.target.value)}
              type="color"
              value={material.color}
            />
            <strong className="truncate text-[8px] tracking-[0.08em] text-[#d8d4cb] uppercase" title={name}>
              {name}
            </strong>
            <input
              aria-label={`${name} hex color`}
              className="h-7 min-w-0 border border-white/10 bg-[#090a10] px-1.5 text-[7px] text-[#aaaeb6] outline-none focus:border-[#4a9eff]/60"
              onChange={(event) => change([name, 'color'], event.target.value)}
              value={material.color}
            />
            <select
              aria-label={`${name} surface preset`}
              className="h-7 min-w-0 border border-white/10 bg-[#090a10] px-1.5 text-[7px] outline-none"
              onChange={(event) => change([name, 'preset'], event.target.value)}
              value={material.preset}
            >
              {MATERIAL_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
            <button
              className="grid size-7 place-items-center border border-white/8 text-[8px] text-[#626670] hover:text-[#ff8caa] disabled:opacity-20"
              disabled={referenced}
              onClick={() => remove(name)}
              title={referenced ? 'Used by terrain or liquid' : 'Remove material'}
              type="button"
            >
              ×
            </button>
          </div>
        )
      })}
      <section className="flex h-9 items-center gap-1.5 border border-dashed border-white/10 bg-black/10 px-2">
        <label className="min-w-0 flex-1">
          <input
            className={`${input_class} w-full`}
            onChange={(event) => set_new_name(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add()
            }}
            placeholder="new material name"
            value={new_name}
          />
        </label>
        <button className={button_class} disabled={!new_name.trim()} onClick={add} type="button">
          Add
        </button>
      </section>
    </div>
  )
}

export const SplineEditor = ({
  name,
  knots,
  change,
  compact = false,
  fill = false,
  selected,
  select,
}: Readonly<{
  name: string
  knots: readonly (readonly [number, number])[]
  change: (knots: readonly (readonly [number, number])[]) => void
  compact?: boolean
  fill?: boolean
  selected?: number
  select?: (index: number) => void
}>) => {
  const [dragging, set_dragging] = useState<number | null>(null)
  const [draft_knots, set_draft_knots] = useState(knots)
  const draft_ref = useRef(knots)
  const change_timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (dragging !== null) return
    draft_ref.current = knots
    set_draft_knots(knots)
  }, [dragging, knots])
  useEffect(
    () => () => {
      if (change_timer.current !== null) clearTimeout(change_timer.current)
    },
    []
  )
  const show_knots = (next: readonly (readonly [number, number])[]): void => {
    draft_ref.current = next
    set_draft_knots(next)
  }
  const commit_drag = (): void => {
    if (change_timer.current !== null) clearTimeout(change_timer.current)
    change_timer.current = null
    change(draft_ref.current)
    set_dragging(null)
  }
  const preview_drag = (next: readonly (readonly [number, number])[]): void => {
    show_knots(next)
    if (change_timer.current !== null) clearTimeout(change_timer.current)
    change_timer.current = setTimeout(() => change(next), 220)
  }
  const width = 640
  const height = 108
  const x_min = Math.min(...draft_knots.map(([x]) => x))
  const x_max = Math.max(...draft_knots.map(([x]) => x))
  const y_low = Math.min(...draft_knots.map(([, y]) => y))
  const y_high = Math.max(...draft_knots.map(([, y]) => y))
  const padding = Math.max(0.1, (y_high - y_low) * 0.15)
  const y_min = y_low - padding
  const y_max = y_high + padding
  const to_x = (x: number): number => 12 + ((x - x_min) / Math.max(0.0001, x_max - x_min)) * (width - 24)
  const to_y = (y: number): number => height - 12 - ((y - y_min) / Math.max(0.0001, y_max - y_min)) * (height - 24)
  const point_from_event = (
    client_x: number,
    client_y: number,
    target: Readonly<SVGSVGElement>
  ): readonly [number, number] => {
    const bounds = target.getBoundingClientRect()
    const px = ((client_x - bounds.left) / bounds.width) * width
    const py = ((client_y - bounds.top) / bounds.height) * height
    return [
      x_min + ((px - 12) / (width - 24)) * (x_max - x_min),
      y_min + ((height - 12 - py) / (height - 24)) * (y_max - y_min),
    ]
  }
  const curve = Array.from({ length: 121 }, (_, index) => {
    const x = x_min + ((x_max - x_min) * index) / 120
    return `${to_x(x)},${to_y(landscape_height(draft_knots, x))}`
  }).join(' ')
  return (
    <section className={`border border-white/10 bg-black/15 p-3 ${fill ? 'flex min-h-48 flex-1 flex-col' : ''}`}>
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
            const gaps = draft_knots
              .slice(1)
              .map(([x], index) => ({ index: index + 1, size: x - draft_knots[index]![0] }))
            const [largest] = [...gaps].sort((left, right) => right.size - left.size)
            if (!largest) return
            const before = draft_knots[largest.index - 1]!
            const after = draft_knots[largest.index]!
            const next = [
              ...draft_knots.slice(0, largest.index),
              [(before[0] + after[0]) / 2, (before[1] + after[1]) / 2],
              ...draft_knots.slice(largest.index),
            ] as const
            show_knots(next)
            change(next)
          }}
          type="button"
        >
          + Point
        </button>
      </div>
      <svg
        className={`w-full touch-none border border-white/6 bg-[#08080d] ${fill ? 'min-h-40 flex-1' : ''}`}
        onPointerMove={(event) =>
          dragging === null ||
          preview_drag(
            move_spline_knot(
              draft_ref.current,
              dragging,
              point_from_event(event.clientX, event.clientY, event.currentTarget)
            )
          )
        }
        onPointerUp={commit_drag}
        preserveAspectRatio={fill ? 'none' : undefined}
        viewBox={`0 0 ${width} ${height}`}
      >
        <polyline fill="none" points={curve} stroke="#c8963c" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {draft_knots.map(([x, y], index) => (
          <path
            className={`cursor-grab ${selected === index ? 'stroke-[#efc15a]' : 'stroke-[#67adff]'}`}
            d={`M ${to_x(x)} ${to_y(y)} h 0.01`}
            fill="none"
            key={`${index}-${x}`}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              select?.(index)
              set_dragging(index)
            }}
            strokeLinecap="round"
            strokeWidth={selected === index ? 7 : 5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {!compact && (
        <div className="mt-2 flex flex-wrap gap-2">
          {draft_knots.map(([x, y], index) => (
            <div className="flex items-center gap-1 border border-white/7 bg-black/20 p-1" key={`${index}-fields`}>
              <span className="px-1 text-[7px] text-[#5f636d]">{index + 1}</span>
              <input
                className={`${input_class} w-14`}
                onChange={(event) => change(move_spline_knot(draft_knots, index, [Number(event.target.value), y]))}
                step="0.01"
                type="number"
                value={x}
              />
              <input
                className={`${input_class} w-14`}
                onChange={(event) => change(move_spline_knot(draft_knots, index, [x, Number(event.target.value)]))}
                step="0.01"
                type="number"
                value={y}
              />
              <button
                className={button_class}
                disabled={draft_knots.length <= 2}
                onClick={() => change(draft_knots.filter((_, knot) => knot !== index))}
                type="button"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
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
            className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-start gap-2 border border-white/8 bg-black/15 p-2"
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
            <div className="col-span-3">
              <BiomeChips
                change={(next) => change([kind, index, 'biomes'], next)}
                names={biome_names}
                selected={biomes}
              />
            </div>
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
