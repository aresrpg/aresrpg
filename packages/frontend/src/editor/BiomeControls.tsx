// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { MATERIAL_PRESETS, STRUCTURE_PACKS, STRUCTURE_TYPES, landscape_height, type WorldRecipe } from '@aresrpg/engine'
import { useEffect, useRef, useState } from 'react'

import { move_spline_knot } from './biome_editor.ts'
import type { JsonPath, JsonValue } from './seed_editor.ts'

/* eslint-disable functional/immutable-data -- Pointer-drag drafts are local UI effect boundaries. */

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
          ) ||
          recipe.biomes.some(({ structure_packs = [] }) =>
            structure_packs.some((pack_name) =>
              STRUCTURE_PACKS[pack_name]?.types.some(({ type }) => STRUCTURE_TYPES[type]?.palette.includes(name))
            )
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
  disabled = false,
  x_domain,
  y_domain,
  y_value_domain,
}: Readonly<{
  name: string
  knots: readonly (readonly [number, number])[]
  change: (knots: readonly (readonly [number, number])[]) => void
  compact?: boolean
  fill?: boolean
  selected?: number
  select?: (index: number) => void
  disabled?: boolean
  x_domain?: readonly [number, number]
  y_domain?: readonly [number, number]
  y_value_domain?: readonly [number, number]
}>) => {
  const [dragging, set_dragging] = useState<number | null>(null)
  const [draft_knots, set_draft_knots] = useState(knots)
  const draft_ref = useRef(knots)
  useEffect(() => {
    if (dragging !== null) return
    draft_ref.current = knots
    set_draft_knots(knots)
  }, [dragging, knots])
  const show_knots = (next: readonly (readonly [number, number])[]): void => {
    draft_ref.current = next
    set_draft_knots(next)
  }
  const commit_drag = (): void => {
    if (dragging === null) return
    set_dragging(null)
    if (draft_ref.current.some(([x, y], index) => x !== knots[index]?.[0] || y !== knots[index]?.[1]))
      change(draft_ref.current)
  }
  const preview_drag = (next: readonly (readonly [number, number])[]): void => {
    show_knots(next)
  }
  const width = 640
  const height = 108
  const [x_min, x_max] = x_domain ?? [
    Math.min(...draft_knots.map(([x]) => x)),
    Math.max(...draft_knots.map(([x]) => x)),
  ]
  const [y_min, y_max] = y_domain ?? [
    Math.min(...draft_knots.map(([, y]) => y)),
    Math.max(...draft_knots.map(([, y]) => y)),
  ]
  const [value_y_min, value_y_max] = y_value_domain ?? [y_min, y_max]
  const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value))
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
      clamp(x_min + ((px - 12) / (width - 24)) * (x_max - x_min), x_min, x_max),
      clamp(y_min + ((height - 12 - py) / (height - 24)) * (y_max - y_min), value_y_min, value_y_max),
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
            {disabled ? 'Rebuilding the exact voxel field…' : 'Drag a blue knot; release once to rebuild terrain.'}
          </p>
        </div>
        <button
          className={button_class}
          disabled={disabled}
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
        aria-disabled={disabled}
        className={`w-full touch-none border border-white/6 bg-[#08080d] ${fill ? 'min-h-40 flex-1' : ''} ${disabled ? 'pointer-events-none cursor-wait opacity-55' : ''}`}
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
        onPointerCancel={commit_drag}
        onPointerUp={commit_drag}
        preserveAspectRatio={fill ? 'none' : undefined}
        viewBox={`0 0 ${width} ${height}`}
      >
        <text fill="#555a64" fontSize="8" x="2" y="10">
          {y_max}
        </text>
        <text fill="#555a64" fontSize="8" x="2" y={height - 2}>
          {y_min}
        </text>
        <polyline fill="none" points={curve} stroke="#c8963c" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {draft_knots.map(([x, y], index) => (
          <path
            className={`cursor-grab ${selected === index ? 'stroke-[#efc15a]' : 'stroke-[#67adff]'}`}
            d={`M ${to_x(x)} ${to_y(y)} h 0.01`}
            fill="none"
            key={`${index}-${x}`}
            onPointerDown={(event) => {
              if (disabled) return
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
      <div className="mt-1 flex justify-between text-[6px] tabular-nums text-[#555a64] uppercase">
        <span>
          Elevation {y_min}–{y_max}
        </span>
        <span>
          Ground noise {x_min}–{x_max}
        </span>
      </div>
      {!compact && (
        <div className="mt-2 flex flex-wrap gap-2">
          {draft_knots.map(([x, y], index) => (
            <div className="flex items-center gap-1 border border-white/7 bg-black/20 p-1" key={`${index}-fields`}>
              <span className="px-1 text-[7px] text-[#5f636d]">{index + 1}</span>
              <input
                className={`${input_class} w-14`}
                disabled={disabled}
                onChange={(event) => change(move_spline_knot(draft_knots, index, [Number(event.target.value), y]))}
                step="0.01"
                type="number"
                value={x}
              />
              <input
                className={`${input_class} w-14`}
                disabled={disabled}
                onChange={(event) => change(move_spline_knot(draft_knots, index, [x, Number(event.target.value)]))}
                step="0.01"
                type="number"
                value={y}
              />
              <button
                className={button_class}
                disabled={disabled || draft_knots.length <= 2}
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

export { PopulationEditor } from './PopulationEditor.tsx'
