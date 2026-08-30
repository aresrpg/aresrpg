// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure fight/UI projection. The game submits cells and meaning; the engine owns every visual preset.

import { fight_blob_preset, type FightBlobSpec, type FightPresentationCue } from '@aresrpg/engine'
import { board_zone_cells, fight_path_to, type HydratedFightCheckpoint, type SpellCellProjection } from '@aresrpg/fight'
import { EFFECT_KINDS } from '@aresrpg/fight/move_contract'

export type FightBlobOverlay = Readonly<{ id: string; blob: FightBlobSpec }>
export type FightZoneVisualState = Readonly<{
  checkpoint: Readonly<HydratedFightCheckpoint>
  zone_ids: readonly string[]
}>

export const fight_range_seat = (owned_active_seat: bigint | null, hovered_seat: bigint | null): bigint | null =>
  hovered_seat ?? owned_active_seat

export const fight_viewer_team = (
  checkpoint: Readonly<HydratedFightCheckpoint> | null,
  owner: string | null,
  character_id: string | null
): bigint | null =>
  checkpoint?.contract.fighters.find(
    (fighter) =>
      fighter.kind.type === 'player' &&
      fighter.kind.owner === owner &&
      (character_id === null || fighter.kind.character === character_id)
  )?.team ?? null

export const fight_visual_checkpoint = (
  presented: Readonly<HydratedFightCheckpoint> | null,
  canonical: Readonly<HydratedFightCheckpoint> | null,
  presentation_pending: boolean
): HydratedFightCheckpoint | null => {
  if (!canonical) return null
  if (!presented || presented.contract.id !== canonical.contract.id) return canonical
  return presentation_pending ? presented : canonical
}

const fighter_seat_of = (entity_id: string): number | null => {
  const seat = Number(entity_id.split('_').at(-1))
  return Number.isInteger(seat) && seat >= 0 ? seat : null
}

type FightFighter = HydratedFightCheckpoint['contract']['fighters'][number]

const effects_after_start_cue = (
  fighter: Readonly<FightFighter>,
  seat: number,
  cue: Readonly<FightPresentationCue>
): FightFighter['effects'] | null => {
  if (cue.type === 'status') return [...cue.effects]
  if (cue.type !== 'visibility') return null
  const invisible = fighter.effects.some(({ kind }) => kind === EFFECT_KINDS.invis)
  if (invisible === cue.invisible) return null
  return cue.invisible
    ? [
        ...fighter.effects,
        Object.freeze({
          kind: EFFECT_KINDS.invis,
          element: '',
          value: 0n,
          turns_left: 0n,
          source: BigInt(seat),
          stat: 0n,
        }),
      ]
    : fighter.effects.filter(({ kind }) => kind !== EFFECT_KINDS.invis)
}

const start_fighter_projection = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  cue: Readonly<FightPresentationCue>
): Readonly<{ seat: number; fighter: FightFighter }> | null => {
  if (cue.type !== 'status' && cue.type !== 'visibility') return null
  const seat = fighter_seat_of(cue.entity_id)
  const fighter = seat === null ? null : checkpoint.contract.fighters[seat]
  if (seat === null || !fighter) return null
  const effects = effects_after_start_cue(fighter, seat, cue)
  return effects ? Object.freeze({ seat, fighter: Object.freeze({ ...fighter, effects }) }) : null
}

const with_fighter = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  seat: number,
  fighter: Readonly<FightFighter>
): HydratedFightCheckpoint =>
  Object.freeze({
    ...checkpoint,
    contract: Object.freeze({
      ...checkpoint.contract,
      fighters: checkpoint.contract.fighters.map((candidate, index) => (index === seat ? fighter : candidate)),
    }),
  })

/** Advance display truth only when its matching cue has actually played. Canonical state may
 * already contain the whole mob wave; cards, rings, and bodies must not reveal its future. */
export const fight_visual_checkpoint_after_cue = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  cue: Readonly<FightPresentationCue>,
  phase: 'start' | 'complete'
): HydratedFightCheckpoint => {
  if (phase === 'start') {
    const projection = start_fighter_projection(checkpoint, cue)
    if (projection) return with_fighter(checkpoint, projection.seat, projection.fighter)
  }
  if (phase !== 'complete') return checkpoint
  const entity_id =
    cue.type === 'damage' || cue.type === 'heal'
      ? cue.target_id
      : cue.type === 'death' || cue.type === 'movement'
        ? cue.entity_id
        : null
  if (!entity_id) return checkpoint
  const seat = fighter_seat_of(entity_id)
  const fighter = seat === null ? null : checkpoint.contract.fighters[seat]
  if (seat === null || !fighter) return checkpoint
  const cell = cue.type === 'movement' ? cue.cells.at(-1) : undefined
  if (cue.type === 'movement' && cell === undefined) return checkpoint
  const next =
    cue.type === 'damage' || cue.type === 'heal'
      ? Object.freeze({ ...fighter, hp: BigInt(cue.hp_after) })
      : cue.type === 'death'
        ? Object.freeze({ ...fighter, hp: 0n, dead: true })
        : Object.freeze({ ...fighter, cell: BigInt(cell!) })
  return with_fighter(checkpoint, seat, next)
}

const with_zones = (
  state: Readonly<FightZoneVisualState>,
  zones: Readonly<HydratedFightCheckpoint['contract']['zones']>,
  zone_ids: readonly string[]
): FightZoneVisualState =>
  Object.freeze({
    checkpoint: {
      ...state.checkpoint,
      contract: { ...state.checkpoint.contract, zones: [...zones] },
    },
    zone_ids: Object.freeze([...zone_ids]),
  })

const removed_zone_id = (cue: Readonly<FightPresentationCue>): string | null => {
  if (cue.type === 'zone_removed') return cue.zone_id
  if (cue.type === 'zone' && cue.action === 'trap_triggered') return cue.zone_id
  return null
}

export const fight_zone_visual_state = (
  presented: Readonly<FightZoneVisualState> | null,
  canonical: Readonly<FightZoneVisualState> | null,
  cue: Readonly<FightPresentationCue>,
  phase: 'start' | 'complete'
): FightZoneVisualState | null => {
  if (!canonical) return null
  if (!presented || presented.checkpoint.contract.id !== canonical.checkpoint.contract.id) return canonical
  const removed_zone = removed_zone_id(cue)
  if (removed_zone !== null && phase === 'start') {
    const index = presented.zone_ids.indexOf(removed_zone)
    if (index < 0) return presented
    return with_zones(
      presented,
      presented.checkpoint.contract.zones.filter((_, zone_index) => zone_index !== index),
      presented.zone_ids.filter((_, zone_index) => zone_index !== index)
    )
  }
  if (cue.type === 'zone_placed' && phase === 'complete') {
    if (presented.zone_ids.includes(cue.zone_id)) return presented
    const index = canonical.zone_ids.indexOf(cue.zone_id)
    const zone = canonical.checkpoint.contract.zones[index]
    if (!zone) return presented
    return with_zones(presented, [...presented.checkpoint.contract.zones, zone], [...presented.zone_ids, cue.zone_id])
  }
  return presented
}

const unique_cells = (cells: readonly bigint[]): readonly number[] => Object.freeze([...new Set(cells.map(Number))])

// A subtle team ring under every visible living fighter; the active character breathes
// stronger. Reads the PRESENTED checkpoint so visibility and rings change in cue order.
const team_ring_overlays = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  presented_turn_seat: bigint | null
): readonly FightBlobOverlay[] => {
  const active_seat = presented_turn_seat ?? checkpoint.contract.queue[Number(checkpoint.contract.turn_ptr)]
  return Object.freeze(
    checkpoint.contract.fighters.flatMap((fighter, seat) => {
      if (fighter.dead || fighter.effects.some(({ kind }) => kind === EFFECT_KINDS.invis)) return []
      const active = BigInt(seat) === active_seat && checkpoint.contract.round !== 0n
      const side = fighter.team === 0n ? 'a' : 'b'
      const preset = active ? (`team_${side}_active` as const) : (`team_${side}` as const)
      return [
        Object.freeze({
          id: `team:${seat}`,
          blob: fight_blob_preset(preset, {
            cells: Object.freeze([Number(fighter.cell)]),
            origin_cell: Number(fighter.cell),
          }),
        }),
      ]
    })
  )
}

const zone_overlays = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  zone_ids: readonly string[],
  viewer_team: bigint | null
): readonly FightBlobOverlay[] => {
  return Object.freeze(
    checkpoint.contract.zones.flatMap((zone, index) => {
      const id = zone_ids[index] ?? `initial:zone:${index}`
      const owner = checkpoint.contract.fighters[Number(zone.owner_fighter)]
      const visible = !zone.trap || (viewer_team !== null && owner?.team === viewer_team)
      if (!visible) return []
      return [
        Object.freeze({
          id: `zone:${id}`,
          blob: fight_blob_preset(zone.trap ? 'trap' : 'glyph', {
            cells: unique_cells(board_zone_cells(zone)),
            origin_cell: Number(zone.anchor),
          }),
        }),
      ]
    })
  )
}

export const project_fight_overlays = ({
  checkpoint,
  presentation_active,
  hovered_cell,
  owned_active_seat,
  attack_selected,
  movement_cells,
  range_seat,
  spell_cells,
  spell_hover_area,
  hovered_spell_targetable,
  viewer_team = null,
  presented_turn_seat = null,
  visual_checkpoint = checkpoint,
  zone_checkpoint = checkpoint,
  zone_ids = Object.freeze([]),
}: Readonly<{
  checkpoint: HydratedFightCheckpoint
  presentation_active: boolean
  hovered_cell: bigint | null
  owned_active_seat: bigint | null
  attack_selected: boolean
  movement_cells: readonly bigint[]
  range_seat: bigint | null
  spell_cells: SpellCellProjection | null
  spell_hover_area: readonly bigint[]
  hovered_spell_targetable: boolean
  viewer_team?: bigint | null
  presented_turn_seat?: bigint | null
  visual_checkpoint?: Readonly<HydratedFightCheckpoint>
  zone_checkpoint?: Readonly<HydratedFightCheckpoint>
  zone_ids?: readonly string[]
}>): readonly FightBlobOverlay[] => {
  const zones = Object.freeze([
    ...team_ring_overlays(visual_checkpoint, presented_turn_seat),
    ...zone_overlays(zone_checkpoint, zone_ids, viewer_team),
  ])
  if (presentation_active) return zones
  if (spell_cells && owned_active_seat !== null) {
    const fighter = checkpoint.contract.fighters[Number(owned_active_seat)]
    if (!fighter) return zones
    const hovered_target = hovered_spell_targetable ? hovered_cell : null
    const hovered_area = new Set(spell_hover_area)
    const overlays: readonly FightBlobOverlay[] = [
      Object.freeze({
        id: 'spell-range',
        blob: fight_blob_preset('spell_range', {
          cells: Object.freeze(spell_cells.range.filter((cell) => !hovered_area.has(cell)).map(Number)),
          origin_cell: Number(fighter.cell),
        }),
      }),
      Object.freeze({
        id: 'spell-targetable',
        blob: fight_blob_preset('spell_targetable', {
          cells: Object.freeze(spell_cells.targetable.filter((cell) => !hovered_area.has(cell)).map(Number)),
          origin_cell: Number(fighter.cell),
        }),
      }),
    ]
    if (hovered_target === null) return Object.freeze([...zones, ...overlays])
    return Object.freeze([
      ...zones,
      ...overlays,
      Object.freeze({
        id: 'spell-hover',
        blob: fight_blob_preset('spell_hover', {
          cells: Object.freeze(spell_hover_area.map(Number)),
          origin_cell: Number(hovered_target),
        }),
      }),
    ])
  }
  if (range_seat === null) return zones
  const fighter = checkpoint.contract.fighters[Number(range_seat)]
  if (!fighter || movement_cells.length === 0) return zones
  const path =
    owned_active_seat !== null && range_seat === owned_active_seat && hovered_cell !== null && !attack_selected
      ? fight_path_to(checkpoint, owned_active_seat, hovered_cell)
      : null
  const path_cells = new Set(path ?? [])
  const range_blob = Object.freeze({
    id: 'movement-range',
    blob: fight_blob_preset(range_seat === owned_active_seat ? 'movement_range' : 'movement_preview', {
      cells: Object.freeze(movement_cells.filter((cell) => !path_cells.has(cell)).map(Number)),
      origin_cell: Number(fighter.cell),
      animate: hovered_cell === null,
    }),
  })
  if (!path) return Object.freeze([...zones, range_blob])
  return Object.freeze([
    ...zones,
    range_blob,
    Object.freeze({
      id: 'movement-path',
      blob: fight_blob_preset('movement_path', {
        cells: Object.freeze(path.map(Number)),
        origin_cell: Number(checkpoint.contract.fighters[Number(owned_active_seat)]?.cell ?? fighter.cell),
      }),
    }),
  ])
}
