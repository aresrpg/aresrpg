// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { create_world_preview, type WorldPreview, type WorldRecipe } from '@aresrpg/engine'
import { useEffect, useMemo, useRef, useState } from 'react'

import { biome_preview, first_biome_land } from './biome_editor.ts'

/* eslint-disable functional/immutable-data -- Canvas buffers and refs are mutable browser effect boundaries. */

type SelectedColumn = Readonly<{
  x: number
  z: number
  surface_y: number
  biome: Readonly<{ name: string }>
  climate: Readonly<Record<string, number>>
}>

export const TerrainPreview = ({
  recipe,
  selected,
  on_rendering_change,
}: Readonly<{
  recipe: WorldRecipe
  selected: SelectedColumn | null
  on_rendering_change: (rendering: boolean) => void
}>) => {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const preview = useRef<WorldPreview | null>(null)
  const drag = useRef<Readonly<{ x: number; y: number; mode: 'orbit' | 'pan' }> | null>(null)
  const latest = useRef(recipe)
  const focus = useRef<readonly [number, number]>([selected?.x ?? 0, selected?.z ?? 0])
  const exact_radius = useRef(192)
  const [radius, set_radius] = useState(192)
  const [error, set_error] = useState<string | null>(null)

  useEffect(() => {
    const target = canvas.current
    if (!target) return
    let cancelled = false
    on_rendering_change(true)
    void (async () => {
      try {
        const created = await create_world_preview(target, latest.current)
        if (cancelled) {
          created.dispose()
          return
        }
        preview.current = created
        created.set_focus(focus.current[0], focus.current[1])
        created.set_exact_radius(exact_radius.current)
        await created.update(latest.current)
        if (cancelled) return
        set_error(null)
        on_rendering_change(false)
        // eslint-disable-next-line no-silent-failures/no-swallowed-failure -- The preview failure is rendered inline below the canvas.
      } catch (reason) {
        if (!cancelled) {
          set_error(reason instanceof Error ? reason.message : String(reason))
          on_rendering_change(false)
        }
      }
    })()
    return () => {
      cancelled = true
      preview.current?.dispose()
      preview.current = null
      on_rendering_change(false)
    }
  }, [on_rendering_change])
  useEffect(() => {
    latest.current = recipe
    const { current } = preview
    if (!current) return
    let active = true
    on_rendering_change(true)
    void current.update(recipe).then(
      () => {
        if (active) on_rendering_change(false)
      },
      (reason: unknown) => {
        if (!active) return
        set_error(reason instanceof Error ? reason.message : String(reason))
        on_rendering_change(false)
      }
    )
    return () => {
      active = false
    }
  }, [on_rendering_change, recipe])
  useEffect(() => {
    focus.current = [selected?.x ?? 0, selected?.z ?? 0]
    preview.current?.set_focus(focus.current[0], focus.current[1])
  }, [selected?.x, selected?.z])

  return (
    <div className="absolute inset-0 bg-[#0b1017]">
      <canvas
        className="size-full touch-none cursor-grab active:cursor-grabbing"
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (event.button !== 0 && event.button !== 2) return
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { x: event.clientX, y: event.clientY, mode: event.button === 2 ? 'pan' : 'orbit' }
        }}
        onPointerMove={(event) => {
          const previous = drag.current
          if (!previous) return
          const x_delta = event.clientX - previous.x
          const y_delta = event.clientY - previous.y
          if (previous.mode === 'pan') {
            const next_focus = preview.current?.pan(x_delta, y_delta)
            if (next_focus) focus.current = next_focus
          } else preview.current?.orbit(-x_delta * 0.006, y_delta * 0.004)
          drag.current = { x: event.clientX, y: event.clientY, mode: previous.mode }
        }}
        onPointerCancel={() => {
          if (drag.current?.mode === 'pan') preview.current?.settle_pan()
          drag.current = null
        }}
        onPointerUp={() => {
          if (drag.current?.mode === 'pan') preview.current?.settle_pan()
          drag.current = null
        }}
        onWheel={(event) => preview.current?.zoom(event.deltaY)}
        ref={canvas}
      />
      <span className="pointer-events-none absolute bottom-3 right-3 border border-white/8 bg-[#080a10]/82 px-3 py-2 text-[7px] tracking-[0.12em] text-[#8a909b] uppercase">
        Left-drag orbit · Right-drag pan · Scroll zoom
      </span>
      <label className="absolute bottom-3 left-3 w-64 border border-white/10 bg-[#080a10]/88 px-3 py-2 backdrop-blur-sm">
        <span className="mb-1.5 flex items-center justify-between text-[7px] tracking-[0.1em] uppercase">
          <span className="text-[#858b96]">Exact voxel field</span>
          <strong className="tabular-nums text-[#efbd45]">
            {radius} radius · {radius * 2 + 1}²
          </strong>
        </span>
        <input
          aria-label="Exact voxel preview radius"
          className="h-3 w-full cursor-ew-resize accent-[#c8963c]"
          max="384"
          min="64"
          onBlur={() => preview.current?.set_exact_radius(exact_radius.current)}
          onChange={(event) => {
            const next = Number(event.target.value)
            exact_radius.current = next
            set_radius(next)
          }}
          onKeyUp={() => preview.current?.set_exact_radius(exact_radius.current)}
          onPointerUp={() => preview.current?.set_exact_radius(exact_radius.current)}
          step="32"
          type="range"
          value={radius}
        />
      </label>
      {error && (
        <span className="absolute inset-x-4 bottom-4 border border-[#ff5a8b]/35 bg-[#16090e]/94 p-3 text-[8px] text-[#ff8caa]">
          {error}
        </span>
      )}
    </div>
  )
}

export const BiomeMap = ({
  recipe,
  select,
  selected,
}: Readonly<{
  recipe: WorldRecipe
  select: (column: number, row: number) => void
  selected?: readonly [number, number] | null
}>) => {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const preview = useMemo(() => biome_preview(recipe), [recipe])
  useEffect(() => {
    const target = canvas.current
    const context = target?.getContext('2d')
    if (!target || !context) return
    const image = context.createImageData(preview.side, preview.side)
    preview.cells.forEach((biome_index, index) => {
      const biome = recipe.biomes[biome_index]
      const land = first_biome_land(biome)
      const color = land ? (recipe.materials[land.surface]?.color ?? '#000000') : '#000000'
      const rgb = Number.parseInt(color.slice(1), 16)
      image.data[index * 4] = (rgb >> 16) & 0xff
      image.data[index * 4 + 1] = (rgb >> 8) & 0xff
      image.data[index * 4 + 2] = rgb & 0xff
      image.data[index * 4 + 3] = 255
    })
    target.width = preview.side
    target.height = preview.side
    context.putImageData(image, 0, 0)
    if (selected) {
      context.strokeStyle = '#ffffff'
      context.lineWidth = 1
      context.strokeRect(selected[0] - 2.5, selected[1] - 2.5, 5, 5)
      context.strokeStyle = '#05070a'
      context.strokeRect(selected[0] - 1.5, selected[1] - 1.5, 3, 3)
    }
  }, [preview, recipe, selected])
  return (
    <div className="absolute inset-0 grid place-items-center overflow-hidden bg-[#07090d] p-10">
      <canvas
        className="aspect-square h-full max-h-full w-auto max-w-full cursor-crosshair border border-white/10 bg-black [image-rendering:pixelated]"
        onPointerDown={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          select(
            Math.min(
              preview.side - 1,
              Math.max(0, Math.floor(((event.clientX - bounds.left) / bounds.width) * preview.side))
            ),
            Math.min(
              preview.side - 1,
              Math.max(0, Math.floor(((event.clientY - bounds.top) / bounds.height) * preview.side))
            )
          )
        }}
        ref={canvas}
      />
      <span className="pointer-events-none absolute bottom-3 right-3 border border-white/8 bg-[#080a10]/82 px-3 py-2 text-[7px] tracking-[0.12em] text-[#8a909b] uppercase">
        Click a zone to focus the height preview · 196² authored zones
      </span>
    </div>
  )
}

export const BiomeCoverage = ({
  recipe,
  selected,
  mob_count,
  resource_count,
}: Readonly<{
  recipe: WorldRecipe
  selected: SelectedColumn | null
  mob_count: (biome: string) => number
  resource_count: (biome: string) => number
}>) => {
  const preview = useMemo(() => biome_preview(recipe), [recipe])
  return (
    <section className="border border-white/10 bg-black/15 p-3">
      {selected && (
        <div className="mb-3 grid grid-cols-3 gap-2 border-b border-white/8 pb-3 text-[8px]">
          <span>
            <strong className="block text-[#666b75] uppercase">Biome</strong>
            {selected.biome.name}
          </span>
          <span>
            <strong className="block text-[#666b75] uppercase">Height</strong>
            {selected.surface_y}
          </span>
          <span>
            <strong className="block text-[#666b75] uppercase">Position</strong>
            {selected.x}, {selected.z}
          </span>
        </div>
      )}
      <div className="grid gap-1.5 sm:grid-cols-2">
        {recipe.biomes.map((biome, index) => (
          <div className="grid grid-cols-[10px_1fr_auto] items-center gap-2 text-[8px]" key={biome.name}>
            <span
              className="size-2.5"
              style={{ backgroundColor: recipe.materials[first_biome_land(biome)?.surface ?? '']?.color }}
            />
            <span className="truncate">
              {biome.name}{' '}
              <small className="text-[#5f636d]">
                · {mob_count(biome.name)}M {resource_count(biome.name)}R
              </small>
            </span>
            <span className="tabular-nums text-[#777b86]">
              {((preview.coverage[index] / preview.cells.length) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
