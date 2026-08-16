// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { WorldRecipe } from '@aresrpg/engine'
import { useEffect, useMemo, useRef } from 'react'

import { biome_preview, terrain_patch } from './biome_editor.ts'

/* eslint-disable functional/immutable-data, fp-law/no-mutating-methods -- Canvas buffers are mutable browser effect boundaries. */

type SelectedColumn = Readonly<{
  x: number
  z: number
  surface_y: number
  biome: Readonly<{ name: string }>
  climate: Readonly<Record<string, number>>
}>

const darken = (hex: string, factor: number): string => {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  const channel = (shift: number) => Math.round(((value >> shift) & 0xff) * factor)
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`
}

export const TerrainPreview = ({
  recipe,
  selected,
}: Readonly<{ recipe: WorldRecipe; selected: SelectedColumn | null }>) => {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const patch = useMemo(
    () => terrain_patch(recipe, { center_x: selected?.x ?? 0, center_z: selected?.z ?? 0 }),
    [recipe, selected?.x, selected?.z]
  )
  useEffect(() => {
    const target = canvas.current
    const context = target?.getContext('2d')
    if (!target || !context) return
    const width = 720
    const height = 360
    const tile = 25
    const rise = 2.2
    const minimum = Math.min(...patch.columns.map(({ surface_y }) => surface_y))
    target.width = width
    target.height = height
    context.clearRect(0, 0, width, height)
    context.fillStyle = '#08090e'
    context.fillRect(0, 0, width, height)
    for (const column of patch.columns) {
      const screen_x = width / 2 + (column.column - column.row) * (tile / 2)
      const ground_y = 70 + (column.column + column.row) * (tile / 4)
      const screen_y = ground_y - (column.surface_y - minimum) * rise
      const depth = Math.max(3, ground_y - screen_y + 5)
      context.beginPath()
      context.moveTo(screen_x - tile / 2, screen_y)
      context.lineTo(screen_x, screen_y + tile / 4)
      context.lineTo(screen_x, screen_y + tile / 4 + depth)
      context.lineTo(screen_x - tile / 2, screen_y + depth)
      context.closePath()
      context.fillStyle = darken(column.color, 0.45)
      context.fill()
      context.beginPath()
      context.moveTo(screen_x + tile / 2, screen_y)
      context.lineTo(screen_x, screen_y + tile / 4)
      context.lineTo(screen_x, screen_y + tile / 4 + depth)
      context.lineTo(screen_x + tile / 2, screen_y + depth)
      context.closePath()
      context.fillStyle = darken(column.color, 0.62)
      context.fill()
      context.beginPath()
      context.moveTo(screen_x, screen_y - tile / 4)
      context.lineTo(screen_x + tile / 2, screen_y)
      context.lineTo(screen_x, screen_y + tile / 4)
      context.lineTo(screen_x - tile / 2, screen_y)
      context.closePath()
      context.fillStyle = column.color
      context.fill()
    }
  }, [patch])
  return (
    <section className="border border-white/10 bg-black/20">
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-2">
        <h2 className="text-[8px] tracking-[0.16em] text-[#c8963c] uppercase">Live voxel terrain</h2>
        <span className="text-[7px] text-[#666b75] uppercase">Exact engine sampler</span>
      </div>
      <canvas className="aspect-[2/1] w-full [image-rendering:pixelated]" ref={canvas} />
    </section>
  )
}

export const BiomeMap = ({
  recipe,
  select,
}: Readonly<{ recipe: WorldRecipe; select: (column: number, row: number) => void }>) => {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const preview = useMemo(() => biome_preview(recipe), [recipe])
  useEffect(() => {
    const target = canvas.current
    const context = target?.getContext('2d')
    if (!target || !context) return
    const image = context.createImageData(preview.side, preview.side)
    preview.cells.forEach((biome_index, index) => {
      const biome = recipe.biomes[biome_index]
      const color = recipe.materials[biome.land.surface] ?? '#000000'
      const rgb = Number.parseInt(color.slice(1), 16)
      image.data[index * 4] = (rgb >> 16) & 0xff
      image.data[index * 4 + 1] = (rgb >> 8) & 0xff
      image.data[index * 4 + 2] = rgb & 0xff
      image.data[index * 4 + 3] = 255
    })
    target.width = preview.side
    target.height = preview.side
    context.putImageData(image, 0, 0)
  }, [preview, recipe])
  return (
    <canvas
      className="aspect-square min-h-0 w-full cursor-crosshair border border-white/10 bg-black [image-rendering:pixelated]"
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
            <span className="size-2.5" style={{ backgroundColor: recipe.materials[biome.land.surface] }} />
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
