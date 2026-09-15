// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  ArrowUpRight,
  Castle,
  Compass,
  Leaf,
  Mountain,
  Snowflake,
  Sprout,
  Sun,
  Swords,
  TreePine,
  Trees,
  Waves,
} from 'lucide-react'
import { tier_unlock_level } from '@aresrpg/immutable'

import { encyclopedia_catalog, titleize, type WorldResource } from '../content/catalog.ts'
import { item_icon, mob_icon } from '../content/assets.ts'

import { EntityIcon } from './components.tsx'
import type { EncyclopediaText } from './copy.ts'
import { dungeon_mobs, type WorldPlace } from './world_locations.ts'

const BIOME_ICONS = {
  plains: Sprout,
  forest: Trees,
  rainforest: Trees,
  highlands: Mountain,
  desert: Sun,
  ocean: Waves,
  taiga: TreePine,
  black_ice: Snowflake,
  ice_peaks: Mountain,
  blue_steppe: Sprout,
  frostfen: Leaf,
  caldera: Mountain,
}

export const PlaceIcon = ({
  place,
  size = 20,
}: Readonly<{ place: Pick<WorldPlace, 'id' | 'kind'>; size?: number }>) => {
  const Icon = place.kind === 'city' ? Castle : (BIOME_ICONS[place.id as keyof typeof BIOME_ICONS] ?? Compass)
  return <Icon aria-hidden="true" size={size} />
}

const MobRows = ({
  ids,
  select,
  text,
}: Readonly<{ ids: readonly string[]; select: (id: string) => void; text: EncyclopediaText }>) => (
  <div className="world-atlas__mob-grid">
    {ids.flatMap((id) => {
      const mob = encyclopedia_catalog.mob(id)?.mob
      return mob
        ? [
            <button
              className="world-atlas__entity"
              key={id}
              onClick={() => select(id)}
              type="button"
              data-world-mob={id}
            >
              <EntityIcon src={mob_icon(id)} label={mob.name} />
              <span className="world-atlas__entity-name">
                {mob.name}
                {mob.role === 'archi' && <small className="text-gold">{text('world_role.archi')}</small>}
                {mob.role === 'boss' && <small className="text-gold">{text('world_role.boss')}</small>}
              </span>
              <span className="world-atlas__level">
                {text('level_range', { min: mob.level_min, max: mob.level_max })}
              </span>
              <ArrowUpRight aria-hidden="true" className="shrink-0 text-muted/60" size={12} />
            </button>,
          ]
        : []
    })}
  </div>
)

const ResourceCard = ({
  resource,
  select_item,
  select_mob,
  text,
}: Readonly<{
  resource: WorldResource
  select_item: (id: string) => void
  select_mob: (id: string) => void
  text: EncyclopediaText
}>) => {
  const item = encyclopedia_catalog.item(resource.item_type)?.item
  const name = item?.name ?? titleize(resource.item_type)
  const rare = encyclopedia_catalog.item(resource.rare_item_type)?.item
  const protector = encyclopedia_catalog.mob(resource.protector)?.mob
  return (
    <article className="world-atlas__resource" data-world-resource={resource.item_type}>
      <button className="world-atlas__entity" onClick={() => select_item(resource.item_type)} type="button">
        <EntityIcon src={item_icon(resource.item_type)} label={name} />
        <span className="world-atlas__entity-name">
          {name}
          <small>
            {text('world_gather_level', {
              job: text(`gather_job.${resource.job.toLowerCase()}`),
              level: tier_unlock_level(resource.tier),
            })}
          </small>
        </span>
        <ArrowUpRight aria-hidden="true" className="shrink-0 text-cyan" size={14} />
      </button>
      {rare && (
        <button
          className="world-atlas__related"
          onClick={() => select_item(rare.item_type)}
          type="button"
          data-world-rare={rare.item_type}
        >
          <span>{text('rare_variant')}</span>
          <EntityIcon src={item_icon(rare.item_type)} label={rare.name} size="size-6" />
          <strong>{rare.name}</strong>
          <ArrowUpRight aria-hidden="true" size={12} />
        </button>
      )}
      {protector && (
        <button
          className="world-atlas__related"
          onClick={() => select_mob(protector.mob_type)}
          type="button"
          data-world-protector={protector.mob_type}
        >
          <span>{text('world_protector')}</span>
          <EntityIcon src={mob_icon(protector.mob_type)} label={protector.name} size="size-6" />
          <strong>{protector.name}</strong>
          <ArrowUpRight aria-hidden="true" size={12} />
        </button>
      )}
    </article>
  )
}

export const WorldPlaceDetails = ({
  place,
  select_item,
  select_mob,
  text,
}: Readonly<{
  place: WorldPlace
  select_item: (id: string) => void
  select_mob: (id: string) => void
  text: EncyclopediaText
}>) => {
  const { dungeon } = place
  const key = dungeon ? encyclopedia_catalog.item(dungeon.key)?.item : null
  return (
    <div className="world-atlas__detail" data-world-place={place.key}>
      <header className="world-atlas__place-heading">
        <span className="world-atlas__place-icon">
          <PlaceIcon place={place} size={28} />
        </span>
        <div>
          <p>{text(place.kind === 'city' ? 'world_city' : 'world_biome')}</p>
          <h2>{titleize(place.id)}</h2>
        </div>
      </header>
      <div className="world-atlas__columns">
        <div className="flex min-w-0 flex-col gap-7">
          <section data-world-roaming>
            <h3 className="world-atlas__section-title">
              <Swords aria-hidden="true" size={14} />
              {text('world_roaming')}
              <span>{place.mob_types.length}</span>
            </h3>
            {place.mob_types.length ? (
              <MobRows ids={place.mob_types} select={select_mob} text={text} />
            ) : (
              <p className="world-atlas__empty">{text('world_no_roaming')}</p>
            )}
          </section>
          {dungeon && (
            <section data-world-dungeon={dungeon.dungeon}>
              <h3 className="world-atlas__section-title">
                <Castle aria-hidden="true" size={14} />
                {text('world_dungeon')} · {titleize(dungeon.dungeon)}
              </h3>
              {key && (
                <button className="world-atlas__key" onClick={() => select_item(key.item_type)} type="button">
                  <EntityIcon src={item_icon(key.item_type)} label={key.name} size="size-7" />
                  {key.name}
                  <ArrowUpRight aria-hidden="true" size={12} />
                </button>
              )}
              <MobRows ids={dungeon_mobs(dungeon)} select={select_mob} text={text} />
            </section>
          )}
        </div>
        <section>
          <h3 className="world-atlas__section-title">
            <Leaf aria-hidden="true" size={14} />
            {text('world_gatherables')}
            <span>{place.resources.length}</span>
          </h3>
          {place.resources.length ? (
            <div className="flex flex-col gap-3">
              {place.resources.map((resource) => (
                <ResourceCard
                  key={resource.item_type}
                  resource={resource}
                  select_item={select_item}
                  select_mob={select_mob}
                  text={text}
                />
              ))}
            </div>
          ) : (
            <p className="world-atlas__empty">{text('world_no_resources')}</p>
          )}
        </section>
      </div>
    </div>
  )
}
