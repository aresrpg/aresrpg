// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { parse_world_recipe, type WorldRecipe } from '@aresrpg/engine'
import { Boxes, Dna, Mountain, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState, type ComponentType } from 'react'

import { dispatch_app, useAppStore } from '../store.ts'

import { BiomeDefinitions, PopulationEditor, SplineEditor } from './BiomeControls.tsx'
import { BiomeCoverage, BiomeMap, TerrainPreview } from './BiomePreviews.tsx'
import { sample_biome_cell } from './biome_editor.ts'
import { JsonEditor } from './JsonEditor.tsx'
import { entity_rows, type JsonPath, type JsonValue } from './seed_editor.ts'

const action_class =
  'h-8 cursor-pointer border border-[#4a9eff]/35 bg-[#4a9eff]/7 px-3 text-[8px] tracking-[0.14em] text-[#67adff] uppercase hover:border-[#4a9eff]/65 disabled:cursor-not-allowed disabled:opacity-35'

const record = (value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | null =>
  value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : null

type BiomeTab = 'terrain' | 'splines' | 'biomes' | 'population'
const tabs: readonly Readonly<{ id: BiomeTab; label: string; help: string; icon: ComponentType<{ size?: number }> }>[] =
  Object.freeze([
    { id: 'terrain', label: 'Terrain', help: 'Noise scale, sea level, blocks and visible colors.', icon: Mountain },
    {
      id: 'splines',
      label: 'Splines',
      help: 'Turn climate samples into base height, amplitude and relief.',
      icon: Dna,
    },
    {
      id: 'biomes',
      label: 'Biomes',
      help: 'Climate targets, selection bias and surface composition.',
      icon: SlidersHorizontal,
    },
    { id: 'population', label: 'Population', help: 'Mobs and resources assigned to each biome pool.', icon: Boxes },
  ])

export const BiomePage = () => {
  const editor = useAppStore((state) => state.admin.editor)
  const file = editor.files.worlds
  const worlds = useMemo(() => (file ? entity_rows('worlds', file.value) : []), [file])
  const terrain_worlds = worlds.filter(({ value }) => record(value)?.terrain)
  const selected = terrain_worlds.find(({ id }) => id === editor.entity_id) ?? terrain_worlds[0]
  const world = record(selected?.value)
  const terrain_value = world?.terrain
  const [cell, set_cell] = useState<readonly [number, number] | null>(null)
  const [tab, set_tab] = useState<BiomeTab>('splines')
  let recipe: WorldRecipe | null = null
  let recipe_error: string | null = null
  try {
    if (terrain_value) recipe = parse_world_recipe(terrain_value)
    // eslint-disable-next-line no-silent-failures/no-swallowed-failure -- Invalid authored data is shown inline.
  } catch (error) {
    recipe_error = error instanceof Error ? error.message : String(error)
  }
  if (!file || !selected || !world)
    return (
      <div className="grid flex-1 place-items-center text-[10px] text-[#777b86]">
        No authored terrain recipe is available.
      </div>
    )

  const replace = (path: JsonPath, value: JsonValue): void =>
    dispatch_app({ type: 'admin/editor_value_changed', domain: 'worlds', path: [...selected.path, ...path], value })
  const sampled = recipe && cell ? sample_biome_cell(recipe, cell[0], cell[1]) : null
  const rows_for = (key: 'mobs' | 'resources'): readonly JsonValue[] => (Array.isArray(world[key]) ? world[key] : [])
  const count_for = (key: 'mobs' | 'resources', biome: string): number =>
    rows_for(key).filter((row) => {
      const biomes = record(row)?.biomes
      return Array.isArray(biomes) && biomes.includes(biome)
    }).length
  const active_tab = tabs.find(({ id }) => id === tab)!

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="z-[3] flex shrink-0 items-center justify-between gap-3 border-b border-white/8 bg-[#0d0d14]/96 px-4 py-3">
        <select
          className="h-8 border border-white/10 bg-black/30 px-3 text-[9px]"
          onChange={(event) => dispatch_app({ type: 'admin/editor_entity_selected', entity_id: event.target.value })}
          value={selected.id}
        >
          {terrain_worlds.map(({ id, label }) => (
            <option className="bg-[#0a0a0f]" key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <span className="text-[8px] text-[#777b86]">196² zones · live engine output</span>
          <button
            className={action_class}
            disabled={!file.dirty || editor.status === 'saving'}
            onClick={() => dispatch_app({ type: 'admin/editor_reset', domain: 'worlds' })}
            type="button"
          >
            Reset
          </button>
          <button
            className={`${action_class} !border-[#c8963c]/45 !text-[#efc15a]`}
            disabled={!file.dirty || editor.status === 'saving'}
            onClick={() => dispatch_app({ type: 'admin/editor_save', domain: 'worlds' })}
            type="button"
          >
            Save worlds.json
          </button>
        </div>
      </header>
      {recipe_error && (
        <pre className="m-4 whitespace-pre-wrap border border-[#ff5a8b]/30 p-3 text-[9px] text-[#ff8caa]">
          {recipe_error}
        </pre>
      )}
      {recipe && (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(380px,0.8fr)_minmax(520px,1.2fr)] overflow-hidden max-xl:grid-cols-[380px_minmax(500px,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-r border-white/8 bg-black/10 p-3">
            <div className="space-y-3">
              <TerrainPreview recipe={recipe} selected={sampled} />
              <div className="mx-auto max-w-[440px]">
                <BiomeMap recipe={recipe} select={(column, row) => set_cell([column, row])} />
              </div>
              <BiomeCoverage
                recipe={recipe}
                selected={sampled}
                mob_count={(biome) => count_for('mobs', biome)}
                resource_count={(biome) => count_for('resources', biome)}
              />
            </div>
          </aside>
          <main className="flex min-h-0 flex-col overflow-hidden">
            <nav className="flex shrink-0 border-b border-white/8 bg-black/10">
              {tabs.map(({ id, label, icon: Icon }) => (
                <button
                  className={`flex h-12 flex-1 items-center justify-center gap-2 border-b-2 text-[8px] tracking-[0.14em] uppercase ${tab === id ? 'border-[#c8963c] bg-[#c8963c]/7 text-[#e0b86b]' : 'border-transparent text-[#747883] hover:text-[#d8d3ca]'}`}
                  key={id}
                  onClick={() => set_tab(id)}
                  type="button"
                >
                  <Icon size={13} />
                  {label}
                </button>
              ))}
            </nav>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mb-4 border-l-2 border-[#4a9eff]/45 bg-[#4a9eff]/5 px-3 py-2">
                <h2 className="text-[9px] tracking-[0.16em] text-[#8fc4ff] uppercase">{active_tab.label}</h2>
                <p className="mt-1 text-[8px] text-[#6f747e]">
                  {active_tab.help} Every change redraws the fixed previews.
                </p>
              </div>
              {tab === 'terrain' && (
                <div className="space-y-4">
                  <section className="border border-white/8 bg-black/10 p-3">
                    <h3 className="mb-3 text-[8px] tracking-[0.15em] text-[#c8963c] uppercase">World profile</h3>
                    <JsonEditor
                      on_change={(path, value) => replace(['terrain', ...path], value)}
                      value={{
                        seed: recipe.seed,
                        sea_level: recipe.sea_level,
                        liquid: recipe.liquid ?? '',
                        vertical_chunks: recipe.vertical_chunks,
                      }}
                    />
                  </section>
                  <section className="border border-white/8 bg-black/10 p-3">
                    <h3 className="mb-3 text-[8px] tracking-[0.15em] text-[#c8963c] uppercase">Noise fields</h3>
                    <JsonEditor
                      on_change={(path, value) => replace(['terrain', 'noise', ...path], value)}
                      value={recipe.noise as unknown as JsonValue}
                    />
                  </section>
                  <section className="border border-white/8 bg-black/10 p-3">
                    <h3 className="mb-3 text-[8px] tracking-[0.15em] text-[#c8963c] uppercase">Blocks and colors</h3>
                    <JsonEditor
                      on_change={(path, value) => replace(['terrain', 'materials', ...path], value)}
                      value={recipe.materials as unknown as JsonValue}
                    />
                  </section>
                </div>
              )}
              {tab === 'splines' && (
                <div className="space-y-4">
                  {Object.entries(recipe.splines).map(([name, knots]) => (
                    <SplineEditor
                      change={(next) => replace(['terrain', 'splines', name], next as JsonValue)}
                      key={name}
                      knots={knots}
                      name={name}
                    />
                  ))}
                </div>
              )}
              {tab === 'biomes' && (
                <div className="space-y-4">
                  <section className="border border-white/8 bg-black/10 p-3">
                    <h3 className="mb-3 text-[8px] tracking-[0.15em] text-[#c8963c] uppercase">Selection model</h3>
                    <JsonEditor
                      on_change={(path, value) => replace(['terrain', 'biome_selection', ...path], value)}
                      value={recipe.biome_selection as unknown as JsonValue}
                    />
                  </section>
                  <BiomeDefinitions change={(path, value) => replace(['terrain', ...path], value)} recipe={recipe} />
                </div>
              )}
              {tab === 'population' && (
                <PopulationEditor biome_names={recipe.biomes.map(({ name }) => name)} change={replace} world={world} />
              )}
            </div>
          </main>
        </div>
      )}
    </div>
  )
}
