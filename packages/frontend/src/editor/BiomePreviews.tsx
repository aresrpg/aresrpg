// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { WorldRecipe } from '@aresrpg/engine'
import { useEffect, useMemo, useRef } from 'react'

import { biome_map_color, biome_preview } from './biome_editor.ts'

/* eslint-disable functional/immutable-data -- Canvas buffers and refs are mutable browser effect boundaries. */

type SelectedColumn = Readonly<{
  x: number
  z: number
  surface_y: number
  biome: Readonly<{ name: string }>
  climate: Readonly<Record<string, number>>
}>

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
      const color = biome ? biome_map_color(recipe, biome) : '#000000'
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
    <div className="absolute inset-0 grid place-items-center overflow-hidden bg-bg p-10">
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
      <span className="pointer-events-none absolute bottom-3 right-3 border border-white/8 bg-bg/82 px-3 py-2 text-[7px] tracking-[0.12em] text-faint uppercase">
        Click a zone to read its biome and height · 196² authored zones
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
            <strong className="block text-faint uppercase">Biome</strong>
            {selected.biome.name}
          </span>
          <span>
            <strong className="block text-faint uppercase">Height</strong>
            {selected.surface_y}
          </span>
          <span>
            <strong className="block text-faint uppercase">Position</strong>
            {selected.x}, {selected.z}
          </span>
        </div>
      )}
      <div className="grid gap-1.5 sm:grid-cols-2">
        {recipe.biomes.map((biome, index) => (
          <div className="grid grid-cols-[10px_1fr_auto] items-center gap-2 text-[8px]" key={biome.name}>
            <span className="size-2.5" style={{ backgroundColor: biome_map_color(recipe, biome) }} />
            <span className="truncate">
              {biome.name}{' '}
              <small className="text-faint">
                · {mob_count(biome.name)}M {resource_count(biome.name)}R
              </small>
            </span>
            <span className="tabular-nums text-faint">
              {((preview.coverage[index] / preview.cells.length) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
