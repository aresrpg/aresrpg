// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Globe2, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { encyclopedia_catalog, titleize } from '../content/catalog.ts'

import { category_pill, Empty, encyclopedia_layout, Fact, LinkChip, SearchField, Section } from './components.tsx'
import type { EncyclopediaText } from './copy.ts'

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
  select_item,
  select_mob,
  select_world,
  text,
}: Readonly<{
  selected_id: string | null
  select_item: (id: string) => void
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
  const band = detail ? world_band(detail.world) : null

  const list = (
    <div className={encyclopedia_layout.list}>
      {worlds.length === 0 ? (
        <Empty>
          <Search className="opacity-30" size={16} />
          {text('no_results')}
        </Empty>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-0">
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
        </div>
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
          <p className="text-[9px] tracking-[0.12em] text-[#6b7280] uppercase">
            {band ? text('level_range', { min: band[0], max: band[1] }) : text('world_level_unknown')}
          </p>
        </header>
        <Section title={text('world_mob_roster')}>
          {detail.mobs.length === 0 ? (
            <p className="text-[9px] text-[#6b7280]">{text('world_no_mobs')}</p>
          ) : (
            <div className="grid gap-1 sm:grid-cols-2">
              {detail.mobs.map((row) => {
                const mob = encyclopedia_catalog.mob(row.mob_type)?.mob
                return (
                  <LinkChip key={row.mob_type} select={() => select_mob(row.mob_type)}>
                    {mob?.name ?? titleize(row.mob_type)} · {(row.weight_bp / 100).toLocaleString('en-US')}%
                  </LinkChip>
                )
              })}
            </div>
          )}
        </Section>
        <Section title={text('world_resources')}>
          {detail.resources.length === 0 ? (
            <p className="text-[9px] text-[#6b7280]">{text('world_no_resources')}</p>
          ) : (
            <div className="grid gap-1 sm:grid-cols-2">
              {detail.resources.map((row) => (
                <LinkChip key={`${row.job}-${row.item_type}`} select={() => select_item(row.item_type)}>
                  {encyclopedia_catalog.item(row.item_type)?.item.name ?? titleize(row.item_type)} ·{' '}
                  {text('world_resource_tier', { tier: row.tier })}
                </LinkChip>
              ))}
            </div>
          )}
        </Section>
        {detail.terrain && (
          <Section title={text('gameplay.game_mechanics')}>
            <div className="grid gap-1 sm:grid-cols-2">
              <Fact label={text('terrain_seed')} value={detail.terrain.seed} />
              <Fact label={text('sea_level')} value={detail.terrain.sea_level} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {Object.entries(detail.terrain.materials).map(([name, color]) => (
                <span
                  className="flex items-center gap-2 border border-[#1e1e2e] px-2 py-1.5 text-[8px] text-[#9da0a9]"
                  key={name}
                >
                  <span className="size-2" style={{ backgroundColor: color }} />
                  {titleize(name)}
                </span>
              ))}
            </div>
          </Section>
        )}
        {detail.dungeon && (
          <Section title={text('world_dungeon')}>
            <Fact
              label={text('world_dungeon')}
              value={encyclopedia_catalog.item(detail.dungeon.key)?.item.name ?? titleize(detail.dungeon.key)}
            />
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {detail.dungeon.rooms.map((room, index) => (
                <div className="border border-[#1e1e2e] bg-white/2 p-3" key={index}>
                  <p className="mb-2 text-[8px] tracking-[0.15em] text-[#c8963c] uppercase">
                    {text('world_dungeon_room', { n: index + 1 })}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {room.map(({ mob_type }) => (
                      <LinkChip key={mob_type} select={() => select_mob(mob_type)}>
                        {encyclopedia_catalog.mob(mob_type)?.mob.name ?? titleize(mob_type)}
                      </LinkChip>
                    ))}
                  </div>
                </div>
              ))}
            </div>
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
              className="h-9 min-w-[110px] border border-[#1e1e2e] bg-[#0a0a0f]/55 px-2 text-[9px] text-[#9da0a9] uppercase"
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
