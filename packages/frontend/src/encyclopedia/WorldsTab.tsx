// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Globe2, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { encyclopedia_catalog, titleize } from '../content/catalog.ts'

import { Empty, SearchField } from './components.tsx'
import type { EncyclopediaText } from './copy.ts'
import { PlaceIcon, WorldPlaceDetails } from './WorldPlaceDetails.tsx'
import { place_matches, world_places } from './world_locations.ts'
import './worlds.css'

export const WorldsTab = ({
  selected_id,
  selected_place,
  select_place,
  select_mob,
  select_item,
  select_world,
  text,
}: Readonly<{
  selected_id: string | null
  selected_place: string | null
  select_place: (world: string, place: string) => void
  select_mob: (id: string) => void
  select_item: (id: string) => void
  select_world: (id: string) => void
  text: EncyclopediaText
}>) => {
  const [search, set_search] = useState('')
  const world = encyclopedia_catalog.worlds.find(({ world }) => world === selected_id) ?? encyclopedia_catalog.worlds[0]
  const places = useMemo(
    () => (world ? world_places(world, encyclopedia_catalog.mobs, encyclopedia_catalog.dungeons) : []),
    [world]
  )
  const matching = useMemo(
    () =>
      places.filter((place) =>
        place_matches(
          search,
          place,
          (id) => encyclopedia_catalog.mob(id)?.mob.name ?? titleize(id),
          (id) => encyclopedia_catalog.item(id)?.item.name ?? titleize(id)
        )
      ),
    [places, search]
  )
  const selected = matching.find(({ key }) => key === selected_place) ?? matching[0]

  return (
    <div className="world-atlas">
      <nav className="world-atlas__worlds" aria-label={text('worlds_tab')}>
        {encyclopedia_catalog.worlds.map((row) => (
          <button
            key={row.world}
            aria-pressed={row.world === world?.world}
            onClick={() => select_world(row.world)}
            type="button"
            data-world-select={row.world}
          >
            <Globe2 aria-hidden="true" size={22} />
            <span>
              <strong>{titleize(row.world)}</strong>
              <small>{text('world_entry', { level: row.entry_level })}</small>
            </span>
          </button>
        ))}
      </nav>
      <div className="world-atlas__search">
        <SearchField value={search} change={set_search} placeholder={text('world_search_places')} />
      </div>
      <div className="world-atlas__body">
        <nav className="world-atlas__places" aria-label={text('world_locations')}>
          <select
            className="world-atlas__place-select"
            aria-label={text('world_locations')}
            value={selected?.key ?? ''}
            onChange={(event) => select_place(world!.world, event.target.value)}
          >
            {(['biome', 'city'] as const).map((kind) => (
              <optgroup key={kind} label={text(kind === 'biome' ? 'world_biomes' : 'world_cities')}>
                {matching
                  .filter((place) => place.kind === kind)
                  .map((place) => (
                    <option key={place.key} value={place.key}>
                      {titleize(place.id)}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          {(['biome', 'city'] as const).map((kind) => (
            <section key={kind}>
              <h3>
                {text(kind === 'biome' ? 'world_biomes' : 'world_cities')}
                <span>{matching.filter((place) => place.kind === kind).length}</span>
              </h3>
              <div>
                {matching
                  .filter((place) => place.kind === kind)
                  .map((place) => (
                    <button
                      key={place.key}
                      aria-pressed={place.key === selected?.key}
                      onClick={() => select_place(world!.world, place.key)}
                      type="button"
                      data-world-location={place.key}
                    >
                      <PlaceIcon place={place} />
                      <span>{titleize(place.id)}</span>
                    </button>
                  ))}
              </div>
            </section>
          ))}
        </nav>
        {selected ? (
          <WorldPlaceDetails place={selected} select_item={select_item} select_mob={select_mob} text={text} />
        ) : (
          <div className="min-w-0 flex-1">
            <Empty>
              <Search aria-hidden="true" size={20} />
              {text('no_results')}
            </Empty>
          </div>
        )}
      </div>
    </div>
  )
}
