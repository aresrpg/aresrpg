// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Globe2, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { encyclopedia_catalog, titleize, type SeedWorld } from '../content/catalog.ts'

import { category_pill, Empty, encyclopedia_layout, EntityGrid, LinkChip, SearchField, Section } from './components.tsx'
import type { EncyclopediaText } from './copy.ts'

export type WorldMobGroup = Readonly<{ id: string; mob_types: readonly string[] }>

export const world_mob_groups = (
  world: Readonly<SeedWorld>
): Readonly<{ biomes: readonly WorldMobGroup[]; cities: readonly WorldMobGroup[] }> =>
  Object.freeze({
    biomes: Object.freeze(
      (world.terrain?.biomes ?? []).map(({ name }) =>
        Object.freeze({
          id: name,
          mob_types: Object.freeze(
            world.mobs.filter(({ biomes }) => biomes.includes(name)).map(({ mob_type }) => mob_type)
          ),
        })
      )
    ),
    cities: Object.freeze(
      world.cities.map(({ city }) =>
        Object.freeze({
          id: city,
          mob_types: Object.freeze(
            world.mobs.filter(({ cities }) => cities.includes(city)).map(({ mob_type }) => mob_type)
          ),
        })
      )
    ),
  })

const WorldMobPanels = ({
  groups,
  select_mob,
  text,
}: Readonly<{ groups: readonly WorldMobGroup[]; select_mob: (id: string) => void; text: EncyclopediaText }>) => (
  <div className="grid gap-3 sm:grid-cols-2">
    {groups.map((group) => (
      <article className="border border-border bg-white/2 p-3" key={group.id}>
        <h4 className="mb-2 border-b border-border pb-2 text-[10px] font-semibold tracking-[0.14em] text-[#c8963c] uppercase">
          {titleize(group.id)}
        </h4>
        {group.mob_types.length === 0 ? (
          <p className="text-[9px] text-[#6b7280]">{text('world_no_mobs')}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {group.mob_types.map((mob_type) => (
              <LinkChip key={mob_type} select={() => select_mob(mob_type)}>
                {encyclopedia_catalog.mob(mob_type)?.mob.name ?? titleize(mob_type)}
              </LinkChip>
            ))}
          </div>
        )}
      </article>
    ))}
  </div>
)

const world_band = (world_id: string): readonly [number, number] | null => {
  const world = encyclopedia_catalog.world(world_id)
  const mobs = (world?.mobs ?? []).flatMap(({ mob_type }) => {
    const row = encyclopedia_catalog.mob(mob_type)?.mob
    return row ? [row] : []
  })
  return mobs.length === 0
    ? null
    : Object.freeze([
        Math.min(...mobs.map(({ level_min }) => level_min)),
        Math.max(...mobs.map(({ level_max }) => level_max)),
      ])
}

export const WorldsTab = ({
  selected_id,
  select_mob,
  select_world,
  text,
}: Readonly<{
  selected_id: string | null
  select_mob: (id: string) => void
  select_world: (id: string) => void
  text: EncyclopediaText
}>) => {
  const [search, set_search] = useState('')
  const [biome, set_biome] = useState('')
  const [sort, set_sort] = useState<'band_asc' | 'name_asc'>('band_asc')
  const biomes = useMemo(
    () =>
      [
        ...new Set(encyclopedia_catalog.worlds.flatMap(({ terrain }) => terrain?.biomes.map(({ name }) => name) ?? [])),
      ].toSorted(),
    []
  )
  const worlds = useMemo(() => {
    const query = search.trim().toLowerCase()
    return encyclopedia_catalog.worlds
      .filter(
        (world) =>
          (!query || world.world.toLowerCase().includes(query)) &&
          (!biome || world.terrain?.biomes.some(({ name }) => name === biome))
      )
      .toSorted((left, right) => {
        if (sort === 'name_asc') return left.world.localeCompare(right.world)
        return (
          (world_band(left.world)?.[0] ?? Number.POSITIVE_INFINITY) -
          (world_band(right.world)?.[0] ?? Number.POSITIVE_INFINITY)
        )
      })
  }, [biome, search, sort])
  const detail = selected_id ? encyclopedia_catalog.world(selected_id) : null
  const groups = detail ? world_mob_groups(detail) : null

  const list = (
    <div className={encyclopedia_layout.list}>
      {worlds.length === 0 ? (
        <Empty>
          <Search className="opacity-30" size={16} />
          {text('no_results')}
        </Empty>
      ) : (
        <EntityGrid>
          {worlds.map((world, index) => {
            const active = selected_id === world.world
            const row_band = world_band(world.world)
            return (
              <button
                className="flex w-full cursor-pointer flex-col gap-0.5 border-l-2 px-3 py-2 text-left hover:bg-white/4"
                key={world.world}
                onClick={() => select_world(world.world)}
                style={{
                  borderLeftColor: active ? '#c8963c' : 'rgba(74,158,255,0.25)',
                  background: active ? 'rgba(200,150,60,0.08)' : index % 2 ? 'rgba(255,255,255,0.02)' : 'transparent',
                }}
                type="button"
              >
                <span className="flex items-center gap-2">
                  <Globe2 className="shrink-0 text-[#4a9eff] opacity-50" size={12} />
                  <span className="min-w-0 flex-1 truncate text-[10px] tracking-[0.1em] text-[#c8963c] uppercase">
                    {titleize(world.world)}
                  </span>
                  {row_band && (
                    <span className="shrink-0 text-[9px] text-[#6b7280]">
                      {text('level_range', { min: row_band[0], max: row_band[1] })}
                    </span>
                  )}
                </span>
                <span className="truncate pl-[18px] text-[8px] tracking-[0.15em] text-[#6b7280]/60 uppercase">
                  {world.terrain?.biomes.map(({ name }) => titleize(name)).join(' · ') || '—'}
                </span>
              </button>
            )
          })}
        </EntityGrid>
      )}
    </div>
  )

  const detail_panel = detail && (
    <div className="flex-1 overflow-y-auto p-4 pt-14">
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <header className="space-y-1">
          <h2 className="text-[14px] font-semibold tracking-[0.15em] text-[#c8963c] uppercase">
            {titleize(detail.world)}
          </h2>
        </header>
        <Section title={text('world_biomes')}>
          <WorldMobPanels groups={groups?.biomes ?? []} select_mob={select_mob} text={text} />
        </Section>
        {groups && groups.cities.length > 0 && (
          <Section title={text('world_cities')}>
            <WorldMobPanels groups={groups.cities} select_mob={select_mob} text={text} />
          </Section>
        )}
      </div>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1">
      <div className={`flex min-h-0 min-w-0 flex-col ${detail ? 'flex-[7]' : 'flex-1'}`}>
        <div className={encyclopedia_layout.filters}>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <SearchField change={set_search} placeholder={text('search_worlds')} value={search} />
            </div>
            <span className="shrink-0 text-[8px] tracking-[0.15em] text-[#6b7280] uppercase">
              {text('showing_count', { count: worlds.length, total: encyclopedia_catalog.worlds.length })}
            </span>
            <select
              className="h-9 min-w-[110px] border border-border bg-bg/55 px-2 text-[9px] text-[#9da0a9] uppercase"
              onChange={(event) => set_sort(event.target.value as 'band_asc' | 'name_asc')}
              value={sort}
            >
              <option value="band_asc">{text('sort_level_asc')}</option>
              <option value="name_asc">{text('sort_name')}</option>
            </select>
          </div>
          {biomes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <button className={category_pill(biome === '')} onClick={() => set_biome('')} type="button">
                {text('view_all')}
              </button>
              {biomes.map((name) => (
                <button
                  className={category_pill(biome === name)}
                  key={name}
                  onClick={() => set_biome(biome === name ? '' : name)}
                  type="button"
                >
                  {titleize(name)}
                </button>
              ))}
            </div>
          )}
        </div>
        {list}
      </div>
      {detail && <aside className={encyclopedia_layout.detail}>{detail_panel}</aside>}
    </div>
  )
}
