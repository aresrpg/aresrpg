// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One derived mob taxonomy for authored drafts, published content, pickers, and the encyclopedia.

import { element_names } from '@aresrpg/immutable'

export type MobFilterKind = 'world' | 'biome' | 'city' | 'family' | 'element'

export type MobFilterRow = Readonly<{
  kind: MobFilterKind | 'protector'
  id: string
  parent?: string
  count: number
  mob_types: readonly string[]
}>

export type MobFilterSource = Readonly<{
  mob_type: string
  family: string
  element: string
  role: string
}>

type MobFilterMembership = Readonly<{
  mob_type: string
  biomes: readonly string[]
  cities?: readonly string[]
}>

export type MobFilterWorldSource = Readonly<{
  world: string
  biome_names: readonly string[]
  mobs: readonly MobFilterMembership[]
  protectors: readonly MobFilterMembership[]
  cities: readonly Readonly<{ city: string }>[]
}>

export type MobFilterSelection = Readonly<{ kind: MobFilterKind; ids: readonly string[] }>

const unique = (values: readonly string[]): readonly string[] => Object.freeze([...new Set(values)])

export const derive_mob_filter_rows = (
  mobs: readonly MobFilterSource[],
  world_sources: readonly MobFilterWorldSource[]
): readonly MobFilterRow[] => {
  const mobs_by_type = new Map(mobs.map((mob) => [mob.mob_type, mob] as const))
  const mob_ids = new Set(mobs_by_type.keys())
  const places = world_sources.flatMap((world): readonly MobFilterRow[] => {
    const inherited_archis = world.mobs.flatMap(({ mob_type, biomes, cities }) => {
      const family = mobs_by_type.get(mob_type)?.family
      return family
        ? mobs
            .filter((mob) => mob.role === 'archi' && mob.family === family)
            .map((mob) => Object.freeze({ mob_type: mob.mob_type, biomes, cities }))
        : []
    })
    const memberships = [...world.mobs, ...inherited_archis, ...world.protectors].filter(({ mob_type }) =>
      mob_ids.has(mob_type)
    )
    const world_mobs = unique(memberships.map(({ mob_type }) => mob_type))
    const biomes = world.biome_names.flatMap((biome): readonly MobFilterRow[] => {
      const biome_mobs = unique(
        memberships.filter(({ biomes: names }) => names.includes(biome)).map(({ mob_type }) => mob_type)
      )
      return biome_mobs.length
        ? [
            Object.freeze({
              kind: 'biome',
              id: `${world.world}:${biome}`,
              parent: world.world,
              count: biome_mobs.length,
              mob_types: biome_mobs,
            }),
          ]
        : []
    })
    const cities = world.cities.flatMap(({ city }): readonly MobFilterRow[] => {
      const members = memberships.flatMap(({ mob_type, cities: city_names }) =>
        city_names?.includes(city) ? [mob_type] : []
      )
      return members.length
        ? [
            Object.freeze({
              kind: 'city',
              id: `${world.world}:${city}`,
              parent: world.world,
              count: members.length,
              mob_types: Object.freeze(members),
            }),
          ]
        : []
    })
    return world_mobs.length
      ? [
          Object.freeze({ kind: 'world', id: world.world, count: world_mobs.length, mob_types: world_mobs }),
          ...biomes,
          ...cities,
        ]
      : []
  })
  const field_rows = (kind: 'family' | 'element', ids: readonly string[]): readonly MobFilterRow[] =>
    ids.flatMap((id) => {
      const mob_types = mobs.filter((mob) => mob[kind] === id).map(({ mob_type }) => mob_type)
      return mob_types.length
        ? [Object.freeze({ kind, id, count: mob_types.length, mob_types: Object.freeze(mob_types) })]
        : []
    })
  const families = unique(mobs.map(({ family }) => family).filter(Boolean)).toSorted()
  return Object.freeze([...places, ...field_rows('family', families), ...field_rows('element', element_names)])
}

/** Filters OR within one facet (fire OR water), and AND between facets (Nauvis AND forest AND ant). */
export const filter_mob_types = (
  mob_types: readonly string[],
  rows: readonly MobFilterRow[],
  selections: readonly MobFilterSelection[]
): readonly string[] => {
  const active = selections.filter(({ ids }) => ids.length > 0)
  return Object.freeze(
    mob_types.filter((mob_type) =>
      active.every(({ kind, ids }) =>
        ids.some((id) => rows.find((row) => row.kind === kind && row.id === id)?.mob_types.includes(mob_type))
      )
    )
  )
}
