// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable no-param-reassign -- The Move twin updates only its reducer-owned structuredClone draft; caller snapshots stay immutable. */

import { in_zone } from './combat_grid.ts'
import { effect_seed } from './fight_math.ts'
import { sheet_of } from './fighters.ts'
import { mix } from './prng.ts'
import { emit } from './runtime.ts'
import type { BoardZone, FightRuntime, ResolveRows } from './types.ts'

type IdentifiedZone = { zone: BoardZone; id: string }
type ZonePartition = { fired: IdentifiedZone[]; kept: IdentifiedZone[] }

export const on_enter = (runtime: FightRuntime, fighter: bigint, from: bigint, resolve_rows: ResolveRows): boolean => {
  if (runtime.contract.fighters[Number(fighter)].dead) return false
  const { cell } = runtime.contract.fighters[Number(fighter)]
  const partitioned = runtime.contract.zones.reduce<ZonePartition>(
    (result, zone, index) => {
      const crosses =
        zone.trap &&
        in_zone(zone.shape, zone.size, zone.anchor, cell) &&
        !in_zone(zone.shape, zone.size, zone.anchor, from)
      const wrapped = { zone, id: runtime.render_ids.zones[index] }
      return crosses ? { ...result, fired: [...result.fired, wrapped] } : { ...result, kept: [...result.kept, wrapped] }
    },
    { fired: [], kept: [] }
  )
  runtime.contract.zones = partitioned.kept.map(({ zone }) => zone)
  runtime.render_ids.zones = partitioned.kept.map(({ id }) => id)
  partitioned.fired.forEach(({ zone, id }) => {
    if (runtime.contract.ended) return
    emit(runtime, 'trap_triggered', {
      zone_id: id,
      owner: zone.owner_fighter,
      fighter,
      from,
      cell,
    })
    emit(runtime, 'zone_removed', { zone_id: id, kind: 'trap', reason: 'triggered' })
    resolve_rows({
      runtime,
      caster: zone.owner_fighter,
      sheet: sheet_of(runtime, zone.owner_fighter),
      rows: zone.effects,
      anchor: zone.anchor,
      origin: zone.anchor,
      cursor: { state: mix(runtime.contract.turn_seed, zone.anchor) },
      critical: false,
      cast_level: 0n,
      cause: 'trap',
    })
  })
  return partitioned.fired.length > 0
}

export const fire_glyphs_under = (runtime: FightRuntime, fighter: bigint, resolve_rows: ResolveRows): void => {
  if (runtime.contract.fighters[Number(fighter)].dead) return
  const { cell } = runtime.contract.fighters[Number(fighter)]
  runtime.contract.zones.forEach((zone, index) => {
    if (runtime.contract.ended || zone.trap || !in_zone(zone.shape, zone.size, zone.anchor, cell)) return
    emit(runtime, 'glyph_triggered', {
      zone_id: runtime.render_ids.zones[index],
      owner: zone.owner_fighter,
      fighter,
      cell,
    })
    resolve_rows({
      runtime,
      caster: zone.owner_fighter,
      sheet: sheet_of(runtime, zone.owner_fighter),
      rows: zone.effects,
      anchor: cell,
      origin: cell,
      cursor: { state: mix(runtime.contract.turn_seed, zone.anchor) },
      critical: false,
      cast_level: 0n,
      cause: 'glyph',
    })
  })
}

export const tick_board_zones = (runtime: FightRuntime, owner: bigint): void => {
  const kept: BoardZone[] = []
  const kept_ids: string[] = []
  runtime.contract.zones.forEach((zone, index) => {
    if (zone.owner_fighter === owner && zone.turns_left > 0n) {
      const next = { ...zone, turns_left: zone.turns_left - 1n }
      if (next.turns_left > 0n) {
        kept.push(next)
        kept_ids.push(runtime.render_ids.zones[index])
      } else
        emit(runtime, 'zone_removed', { zone_id: runtime.render_ids.zones[index], kind: 'glyph', reason: 'expired' })
    } else {
      kept.push(zone)
      kept_ids.push(runtime.render_ids.zones[index])
    }
  })
  runtime.contract.zones = kept
  runtime.render_ids.zones = kept_ids
}

export const drop_owned_zones = (runtime: FightRuntime, owner: bigint, reason: string): void => {
  const kept: BoardZone[] = []
  const kept_ids: string[] = []
  runtime.contract.zones.forEach((zone, index) => {
    if (zone.owner_fighter === owner) {
      emit(runtime, 'zone_removed', {
        zone_id: runtime.render_ids.zones[index],
        kind: zone.trap ? 'trap' : 'glyph',
        reason,
      })
    } else {
      kept.push(zone)
      kept_ids.push(runtime.render_ids.zones[index])
    }
  })
  runtime.contract.zones = kept
  runtime.render_ids.zones = kept_ids
}

export const placement_seed = effect_seed
