// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { BIOME_SLOTS, parse_world_recipe, type WorldRecipe } from '@aresrpg/engine'
import {
  Boxes,
  ChevronDown,
  ChevronUp,
  Dna,
  DoorOpen,
  Globe2,
  Layers3,
  Map as MapIcon,
  Mountain,
  TreePine,
} from 'lucide-react'
import { useMemo, useState, type ComponentType } from 'react'

import { dispatch_app, useAppStore } from '../store.ts'

import { BiomeAtmosphere } from './BiomeAtmosphere.tsx'
import { MaterialEditor, PopulationEditor, SplineEditor } from './BiomeControls.tsx'
import { BiomeCoverage, BiomeMap, TerrainPreview } from './BiomePreviews.tsx'
import { ClimateSlots, type LandscapeSelection } from './ClimateSlots.tsx'
import { DungeonEditor } from './DungeonEditor.tsx'
import { LiveTerrainPreview } from './LiveTerrainPreview.tsx'
import { move_spline_knot, sample_biome_cell, world_height_domain, world_height_graph_domain } from './biome_editor.ts'
import { mob_filter_rows } from './content_list.ts'
import { entity_rows, type JsonPath, type JsonValue } from './seed_editor.ts'

const action_class =
  'h-8 cursor-pointer border border-[#4a9eff]/35 bg-[#07101b]/80 px-3 text-[8px] tracking-[0.14em] text-[#67adff] uppercase hover:border-[#4a9eff]/65 disabled:cursor-not-allowed disabled:opacity-35'
const input_class =
  'h-7 border border-white/12 bg-[#090a10] px-2 text-[8px] text-[#dedad2] outline-none focus:border-[#4a9eff]/60'
const micro_label = 'block text-[7px] tracking-[0.1em] text-[#6f747e] uppercase'

const record = (value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | null =>
  value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : null

type BiomeTab = 'landscape' | 'materials' | 'atmosphere' | 'population' | 'dungeon'
type PreviewMode = 'live' | 'height' | 'map'
const tabs: readonly Readonly<{ id: BiomeTab; label: string; help: string; icon: ComponentType<{ size?: number }> }>[] =
  Object.freeze([
    { id: 'landscape', label: 'Landscape', help: 'Map nine climate slots, then shape one biome.', icon: Dna },
    { id: 'materials', label: 'Materials', help: 'World bounds, block colors and render presets.', icon: Layers3 },
    {
      id: 'atmosphere',
      label: 'Atmosphere',
      help: 'Assign deterministic structure packs to each biome.',
      icon: TreePine,
    },
    { id: 'population', label: 'Population', help: 'Assign mobs and resources to biome pools.', icon: Boxes },
    { id: 'dungeon', label: 'Dungeon', help: 'Author the key and ordered room compositions.', icon: DoorOpen },
  ])

const roles = ['surface', 'subsurface', 'filler'] as const

type ReplaceTerrain = (path: JsonPath, value: JsonValue) => void

const PreviewSurface = ({
  mode,
  recipe,
  terrain,
  sampled,
  cell,
  select_cell,
  set_preview_busy,
}: Readonly<{
  mode: PreviewMode
  recipe: WorldRecipe
  terrain: JsonValue | undefined
  sampled: ReturnType<typeof sample_biome_cell> | null
  cell: readonly [number, number] | null
  select_cell: (cell: readonly [number, number]) => void
  set_preview_busy: (busy: boolean) => void
}>) => {
  if (mode === 'live' && terrain !== undefined) return <LiveTerrainPreview terrain={terrain} />
  if (mode === 'height')
    return <TerrainPreview on_rendering_change={set_preview_busy} recipe={recipe} selected={sampled} />
  if (mode === 'map') return <BiomeMap recipe={recipe} select={(x, y) => select_cell([x, y])} selected={cell} />
  return null
}

const LandscapeControls = ({
  recipe,
  replace,
  preview_busy,
  begin_preview_update,
}: Readonly<{
  recipe: WorldRecipe
  replace: ReplaceTerrain
  preview_busy: boolean
  begin_preview_update: () => void
}>) => {
  const [selected_slot, set_selected_slot] = useState<LandscapeSelection>('mid_mid')
  const [selected_point, set_selected_point] = useState(0)
  const biome_name =
    selected_slot === 'ocean' ? (recipe.ocean?.biome ?? recipe.biome_slots.mid_mid) : recipe.biome_slots[selected_slot]
  const biome_index = recipe.biomes.findIndex(({ name }) => name === biome_name)
  const biome = recipe.biomes[biome_index]!
  const point_index = Math.min(selected_point, biome.landscape.length - 1)
  const point = biome.landscape[point_index]!
  const resolved_knot = biome.landscape
    .slice(0, point_index + 1)
    .toReversed()
    .find(({ land }) => land)
  const resolved_land = resolved_knot?.land ?? biome.landscape[0]!.land!
  const numeric_knots = biome.landscape.map(({ x, y }) => [x, y] as const)
  const point_path = ['terrain', 'biomes', biome_index, 'landscape', point_index] as const
  const change_landscape = (next: readonly (readonly [number, number])[]): void => {
    begin_preview_update()
    const same_length = next.length === biome.landscape.length
    const landscape = next.map(([x, y], index) => {
      const source = same_length
        ? biome.landscape[index]
        : biome.landscape.find((candidate) => candidate.x === x && candidate.y === y)
      return source
        ? {
            x,
            y,
            ...(source.land ? { land: source.land } : {}),
            ...(source.variance === undefined ? {} : { variance: source.variance }),
          }
        : { x, y }
    })
    replace(['terrain', 'biomes', biome_index, 'landscape'], landscape as JsonValue)
  }
  const update_land = (role: (typeof roles)[number], material: string): void =>
    replace([...point_path, 'land'], { ...resolved_land, [role]: material })

  return (
    <div className="flex h-full min-h-[34rem] flex-col gap-3">
      <div className="shrink-0">
        <ClimateSlots
          recipe={recipe}
          replace={replace}
          select={(slot) => {
            set_selected_slot(slot)
            set_selected_point(0)
          }}
          selected={selected_slot}
        />
      </div>
      <SplineEditor
        change={change_landscape}
        compact
        disabled={preview_busy}
        fill
        key={biome.name}
        knots={numeric_knots}
        name={`${biome.name} landscape`}
        select={set_selected_point}
        selected={point_index}
        x_domain={[0, 1]}
        y_domain={world_height_graph_domain()}
        y_value_domain={world_height_domain()}
      />
      <section className="shrink-0 border-l-2 border-[#efbd45]/55 bg-black/22 px-2.5 py-2">
        <div className="mb-2 flex items-end justify-between gap-2">
          <div>
            <span className={micro_label}>Selected knot</span>
            <strong className="mt-1 block text-[9px] text-[#efbd45]">{point_index + 1}</strong>
          </div>
          <div className="flex items-end gap-1.5">
            <label>
              <span className={micro_label}>Threshold</span>
              <input
                className={`${input_class} mt-1 w-16`}
                disabled={preview_busy}
                max={
                  point_index === biome.landscape.length - 1 ? undefined : biome.landscape[point_index + 1]!.x - 0.0001
                }
                min={point_index === 0 ? undefined : biome.landscape[point_index - 1]!.x + 0.0001}
                onChange={(event) =>
                  change_landscape(move_spline_knot(numeric_knots, point_index, [Number(event.target.value), point.y]))
                }
                step="0.01"
                type="number"
                value={point.x}
              />
            </label>
            <label>
              <span className={micro_label}>Height</span>
              <input
                className={`${input_class} mt-1 w-16`}
                disabled={preview_busy}
                onChange={(event) =>
                  change_landscape(move_spline_knot(numeric_knots, point_index, [point.x, Number(event.target.value)]))
                }
                step="1"
                type="number"
                value={point.y}
              />
            </label>
            <label>
              <span className={micro_label}>Variance</span>
              <input
                className={`${input_class} mt-1 w-16`}
                disabled={!point.land}
                max="0.25"
                min="0"
                onChange={(event) => replace([...point_path, 'variance'], Number(event.target.value))}
                step="0.01"
                title={
                  point.land
                    ? 'Jitters this material boundary; terrain noise stays engine-owned.'
                    : 'Choose a block for this knot before adding boundary variance.'
                }
                type="number"
                value={point.variance ?? 0}
              />
            </label>
            <button
              className="h-7 border border-white/10 px-2 text-[8px] text-[#777b86] hover:border-[#ff5a8b]/45 hover:text-[#ff8caa] disabled:opacity-25"
              disabled={preview_busy || biome.landscape.length <= 2}
              onClick={() => {
                begin_preview_update()
                replace(
                  ['terrain', 'biomes', biome_index, 'landscape'],
                  biome.landscape.filter((_, index) => index !== point_index) as JsonValue
                )
                set_selected_point(Math.max(0, point_index - 1))
              }}
              title="Remove selected knot"
              type="button"
            >
              ×
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {roles.map((role) => {
            const material_name = resolved_land[role]
            const material = recipe.materials[material_name]
            return (
              <label className="min-w-0" key={role}>
                <span className={micro_label}>{role}</span>
                <span
                  className="mt-1 flex h-8 min-w-0 items-center border bg-[#090a10] px-1.5"
                  style={{ borderColor: `${material?.color ?? '#777777'}88` }}
                >
                  <input
                    aria-label={`${material_name} color`}
                    className="mr-1 size-4 shrink-0 cursor-pointer border-0 bg-transparent p-0"
                    onChange={(event) => replace(['terrain', 'materials', material_name, 'color'], event.target.value)}
                    type="color"
                    value={material?.color ?? '#000000'}
                  />
                  <select
                    className="min-w-0 flex-1 bg-transparent text-[7px] outline-none"
                    onChange={(event) => update_land(role, event.target.value)}
                    value={material_name}
                  >
                    {Object.entries(recipe.materials).map(([name, candidate]) => (
                      <option className="bg-[#090a10]" key={name} value={name}>
                        {candidate.color} · {name}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            )
          })}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[6px] text-[#626670]">
            {point.land ? 'Own material boundary' : 'Inherits previous boundary'}
          </span>
          {point_index > 0 && point.land && (
            <button
              className="text-[7px] tracking-[0.08em] text-[#777b86] uppercase hover:text-[#efbd45]"
              onClick={() =>
                replace(point_path, {
                  x: point.x,
                  y: point.y,
                  ...(point.variance === undefined ? {} : { variance: point.variance }),
                })
              }
              type="button"
            >
              Inherit previous
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

const WorldAndMaterials = ({ recipe, replace }: Readonly<{ recipe: WorldRecipe; replace: ReplaceTerrain }>) => (
  <div className="space-y-3">
    <section className="flex flex-wrap items-end gap-2 border-l-2 border-[#4a9eff]/45 bg-black/20 p-2.5">
      <label>
        <span className={micro_label}>Seed</span>
        <input
          className={`${input_class} mt-1 w-32`}
          onChange={(event) => replace(['terrain', 'seed'], event.target.value)}
          value={recipe.seed}
        />
      </label>
      <label>
        <span className={micro_label}>Sea level</span>
        <input
          className={`${input_class} mt-1 w-16`}
          onChange={(event) => replace(['terrain', 'sea_level'], Number(event.target.value))}
          type="number"
          value={recipe.sea_level}
        />
      </label>
      <label>
        <span className={micro_label}>Liquid</span>
        <select
          className={`${input_class} mt-1 w-28`}
          onChange={(event) => replace(['terrain', 'liquid'], event.target.value)}
          value={recipe.liquid ?? ''}
        >
          <option value="">none</option>
          {Object.keys(recipe.materials).map((name) => (
            <option className="bg-[#090a10]" key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </section>
    <MaterialEditor change={(path, value) => replace(['terrain', 'materials', ...path], value)} recipe={recipe} />
  </div>
)

export const BiomePage = () => {
  const editor = useAppStore((state) => state.editor)
  const file = editor.files.worlds
  const worlds = useMemo(() => (file ? entity_rows('worlds', file.value) : []), [file])
  const mob_filters = useMemo(
    () => mob_filter_rows(entity_rows('mobs', editor.files.mobs?.value), worlds),
    [editor.files.mobs, worlds]
  )
  const terrain_worlds = worlds.filter(({ value }) => record(value)?.terrain)
  const selected = terrain_worlds.find(({ id }) => id === editor.entity_id) ?? terrain_worlds[0]
  const world = record(selected?.value)
  const terrain_value = world?.terrain
  const [cell, set_cell] = useState<readonly [number, number] | null>(null)
  const [tab, set_tab] = useState<BiomeTab>('landscape')
  const [mode, set_mode] = useState<PreviewMode>('live')
  const [panel_open, set_panel_open] = useState(true)
  const [preview_busy, set_preview_busy] = useState(false)
  let recipe: WorldRecipe | null = null
  let recipe_error: string | null = null
  try {
    if (terrain_value) recipe = parse_world_recipe(terrain_value)
    // eslint-disable-next-line no-silent-failures/no-swallowed-failure -- Invalid authored data is shown inline.
  } catch (error) {
    recipe_error = error instanceof Error ? error.message : String(error)
  }
  if (!file || !selected || !world)
    return <div className="grid flex-1 place-items-center text-[10px] text-[#777b86]">No terrain recipe available.</div>

  const replace = (path: JsonPath, value: JsonValue): void =>
    dispatch_app({ type: 'editor/value_changed', domain: 'worlds', path: [...selected.path, ...path], value })
  const sampled = recipe && cell ? sample_biome_cell(recipe, cell[0], cell[1]) : null
  const rows_for = (key: 'mobs' | 'resources'): readonly JsonValue[] => (Array.isArray(world[key]) ? world[key] : [])
  const count_for = (key: 'mobs' | 'resources', biome: string): number =>
    rows_for(key).filter((row) => {
      const biomes = record(row)?.biomes
      return Array.isArray(biomes) && biomes.includes(biome)
    }).length
  const active_tab = tabs.find(({ id }) => id === tab)!

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-[#07090d]">
      <header className="absolute inset-x-0 top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-white/8 bg-[#0b0c12]/92 px-4 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-3">
          <select
            className="h-8 max-w-48 border border-white/10 bg-black/35 px-3 text-[9px]"
            onChange={(event) => dispatch_app({ type: 'editor/entity_selected', entity_id: event.target.value })}
            value={selected.id}
          >
            {terrain_worlds.map(({ id, label }) => (
              <option className="bg-[#0a0a0f]" key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <div className="flex border border-white/10 bg-black/30 p-0.5">
            {(
              [
                ['live', 'Live Engine', Globe2],
                ['height', '3D Height', Mountain],
                ['map', '2D Map', MapIcon],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                className={`flex h-7 items-center gap-2 px-3 text-[8px] tracking-[0.12em] uppercase ${mode === id ? 'bg-[#4a9eff]/14 text-[#8fc4ff]' : 'text-[#777b86] hover:text-[#d8d3ca]'}`}
                key={id}
                onClick={() => {
                  set_preview_busy(false)
                  set_mode(id)
                }}
                type="button"
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="shrink-0 text-[8px] tracking-[0.14em] uppercase">
          {editor.status === 'saving' ? (
            <span className="animate-pulse text-[#efbd45]">Saving…</span>
          ) : file.dirty ? (
            <span className="text-[#efbd45]">● unsaved</span>
          ) : (
            <span className="text-[#65c993]">Saved · autosave on</span>
          )}
        </p>
      </header>

      <div className="absolute inset-0 pt-14">
        {recipe && (
          <PreviewSurface
            cell={cell}
            mode={mode}
            recipe={recipe}
            sampled={sampled}
            select_cell={set_cell}
            set_preview_busy={set_preview_busy}
            terrain={terrain_value}
          />
        )}
      </div>

      {recipe_error && (
        <pre className="absolute inset-x-4 top-18 z-40 whitespace-pre-wrap border border-[#ff5a8b]/30 bg-[#16090e]/96 p-3 text-[9px] text-[#ff8caa]">
          {recipe_error}
        </pre>
      )}

      {recipe && (
        <details
          className="absolute left-3 top-17 z-20 w-80 max-w-[calc(100%-24px)] border border-white/10 bg-[#080a10]/88 shadow-2xl backdrop-blur-md"
          open
        >
          <summary className="cursor-pointer list-none px-3 py-2 text-[8px] tracking-[0.14em] text-[#9ea4ae] uppercase marker:hidden">
            Map readout {sampled ? `· ${sampled.biome.name} · Y ${sampled.surface_y}` : '· click 2D map to focus'}
          </summary>
          <BiomeCoverage
            mob_count={(biome) => count_for('mobs', biome)}
            recipe={recipe}
            resource_count={(biome) => count_for('resources', biome)}
            selected={sampled}
          />
        </details>
      )}

      {recipe && !panel_open && (
        <button
          className="absolute right-3 top-17 z-30 flex h-9 items-center gap-2 border border-[#c8963c]/35 bg-[#0a0b11]/92 px-3 text-[8px] tracking-[0.12em] text-[#e0b86b] uppercase shadow-xl backdrop-blur-md"
          onClick={() => set_panel_open(true)}
          type="button"
        >
          <ChevronDown className="-rotate-90" size={13} />
          Edit world
        </button>
      )}

      {recipe && panel_open && (
        <aside className="absolute bottom-3 right-3 top-17 z-30 flex w-[min(440px,calc(100%-24px))] flex-col overflow-hidden border border-white/10 bg-[#0a0b11]/92 shadow-2xl backdrop-blur-md">
          <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-3 py-2">
            <div>
              <strong className="text-[9px] tracking-[0.15em] text-[#e0b86b] uppercase">World editor</strong>
              <p className="mt-0.5 text-[7px] text-[#6f747e]">
                {active_tab.help} Live Engine is the real game renderer; 3D Height is the fast sampler.
              </p>
            </div>
            {preview_busy && (
              <span className="ml-auto mr-2 animate-pulse text-[7px] tracking-[0.12em] text-[#efbd45] uppercase">
                Rebuilding terrain…
              </span>
            )}
            <button
              aria-label="Collapse terrain editor"
              className="grid size-8 place-items-center border border-white/8 text-[#858994] hover:text-white"
              onClick={() => set_panel_open(false)}
              type="button"
            >
              <ChevronUp className="rotate-90" size={14} />
            </button>
          </div>
          <nav className="grid shrink-0 grid-cols-5 border-b border-white/8 bg-black/15">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                className={`flex h-10 items-center justify-center gap-1.5 border-b-2 text-[7px] tracking-[0.1em] uppercase ${tab === id ? 'border-[#c8963c] bg-[#c8963c]/7 text-[#e0b86b]' : 'border-transparent text-[#747883] hover:text-[#d8d3ca]'}`}
                key={id}
                onClick={() => set_tab(id)}
                type="button"
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
            {tab === 'landscape' && (
              <LandscapeControls
                begin_preview_update={() => {
                  if (mode === 'height') set_preview_busy(true)
                }}
                preview_busy={preview_busy}
                recipe={recipe}
                replace={replace}
              />
            )}
            {tab === 'materials' && <WorldAndMaterials recipe={recipe} replace={replace} />}
            {tab === 'atmosphere' && (
              <BiomeAtmosphere
                begin_preview_update={() => {
                  if (mode === 'height') set_preview_busy(true)
                }}
                recipe={recipe}
                replace={replace}
              />
            )}
            {tab === 'population' && (
              <PopulationEditor biome_names={recipe.biomes.map(({ name }) => name)} change={replace} world={world} />
            )}
            {tab === 'dungeon' && <DungeonEditor change={replace} mob_filters={mob_filters} world={world} />}
          </div>
        </aside>
      )}
    </div>
  )
}
