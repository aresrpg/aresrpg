// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  mob_band_scaled,
  mob_centered_band_scaled,
  mob_effect_value_scaled,
  mob_loot_chance_scaled,
  mob_pool_scaled,
} from '../../immutable/src/mob_scaling.ts'

import { generate_board } from './board_gen.ts'
import { GRID_CELLS, empty_mask, mask_add_cells, mask_get } from './combat_grid.ts'
import { FIGHT_ELEMENTS, player_max_hp } from './fighters.ts'
import { CONTRACT_CONSTANTS } from './move_contract.gen.ts'
import { normalize_checkpoint, normalize_sources } from './normalize.ts'
import type {
  CharacterSourceInput,
  FightBoard,
  FightSetup,
  FightSources,
  HydratedFightCheckpoint,
  MobSnapshot,
  MobTemplateSource,
  PlayerSource,
} from './types.ts'

const scalable_mob_effect = (kind: bigint): boolean => kind <= 7n || kind === 14n || kind === 15n

const scale_mob_effect = (
  effect: MobTemplateSource['spells'][number]['level']['effects'][number],
  low: bigint,
  high: bigint,
  level: bigint
) =>
  scalable_mob_effect(effect.kind)
    ? {
        ...effect,
        value: mob_effect_value_scaled(effect.value, low, high, level),
        value_max: mob_effect_value_scaled(effect.value_max, low, high, level),
      }
    : effect

const scale_mob_spell_level = (
  spell_level: MobTemplateSource['spells'][number]['level'],
  low: bigint,
  high: bigint,
  level: bigint
) => ({
  ...spell_level,
  effects: spell_level.effects.map((effect) => scale_mob_effect(effect, low, high, level)),
  crit_effects: spell_level.crit_effects.map((effect) => scale_mob_effect(effect, low, high, level)),
})

const create_mob_snapshot = (template: MobTemplateSource, scalar: bigint): MobSnapshot => {
  const level = template.level_min + ((template.level_max - template.level_min) * scalar) / 100n
  const kit = template.spells.map((spell) => ({
    name: spell.name,
    ordinal: 1n,
    level: scale_mob_spell_level(spell.level, template.level_min, template.level_max, level),
  }))
  return {
    mob_type: template.mob_type,
    level,
    max_hp: mob_band_scaled(template.hp, template.level_min, template.level_max, level),
    ap: mob_pool_scaled(template.ap, template.level_min, template.level_max, level),
    mp: mob_pool_scaled(template.mp, template.level_min, template.level_max, level),
    agility: mob_band_scaled(template.agility, template.level_min, template.level_max, level),
    wisdom: mob_band_scaled(template.wisdom, template.level_min, template.level_max, level),
    ...(Object.fromEntries(
      FIGHT_ELEMENTS.map((element) => [
        `${element}_res`,
        mob_centered_band_scaled(
          template[`${element}_res`],
          CONTRACT_CONSTANTS.item_stat_shift,
          template.level_min,
          template.level_max,
          level
        ),
      ])
    ) as Pick<MobSnapshot, `${(typeof FIGHT_ELEMENTS)[number]}_res`>),
    kit,
    xp: mob_band_scaled(template.xp, template.level_min, template.level_max, level),
    loot: template.loot.map((row) => ({
      ...row,
      chance_bp: mob_loot_chance_scaled(row.chance_bp, template.level_min, template.level_max, level),
    })),
  }
}

export const mob_scalar_for_level = (template: MobTemplateSource, requested_level: bigint): bigint => {
  const low = template.level_min
  const high = template.level_max
  const level = requested_level < low ? low : requested_level > high ? high : requested_level
  const range = high - low
  return range === 0n ? 0n : ((level - low) * 100n + range - 1n) / range
}

/** A full character source from the fields a caller knows; every other field takes its normalized default. */
export const create_character_source = (input: CharacterSourceInput): PlayerSource =>
  normalize_sources({ players: { character: { ...input, level: input.level ?? 1n } } }).players.character

/**
 * Health of one wallet's hero seated in a fight. A fight owns its fighters' health, so every client
 * reads it here. Null when that seat is not this live hero: another owner, settled, forfeited or unknown.
 */
export const seated_player_health = (
  { contract, sources }: Readonly<Pick<HydratedFightCheckpoint, 'contract' | 'sources'>>,
  seated: Readonly<{ character: string; owner: string; seat: number }>
): Readonly<{ current: bigint; maximum: bigint }> | null => {
  const fighter = contract.fighters[seated.seat]
  const player = sources.players[seated.character]
  if (!fighter || !player || fighter.kind.type !== 'player') return null
  const live = [
    fighter.kind.character === seated.character,
    fighter.kind.owner === seated.owner,
    !fighter.settled,
    !fighter.forfeited,
  ].every(Boolean)
  return live ? { current: fighter.hp, maximum: player_max_hp(player) } : null
}

const closed_mask = (board: FightBoard): bigint[] => {
  const off_shape = Array.from({ length: Number(GRID_CELLS) }, (_, index) => BigInt(index)).filter(
    (cell) => !mask_get(board.shape_mask, cell)
  )
  return mask_add_cells(mask_add_cells(mask_add_cells(empty_mask(), off_shape), board.obstacles), board.holes)
}

export const create_fight_state = ({
  fight_id = 'local',
  world = 'local',
  x = 0n,
  z = 0n,
  board_seed = 1n,
  board: authored_board,
  players,
  mobs,
  spells = {},
  placement_ms = 0n,
}: FightSetup): HydratedFightCheckpoint => {
  const board = authored_board ?? generate_board(board_seed)
  const used_cells = new Set<bigint>()
  const start_cell = (team: bigint, explicit: bigint | undefined): bigint => {
    if (explicit !== undefined) {
      if (used_cells.has(explicit)) throw new Error(`fight setup assigns cell ${explicit} twice`)
      used_cells.add(explicit)
      return explicit
    }
    const side = Number(team)
    const cells = side === 0 ? board.start_cells_a : board.start_cells_b
    const cell = cells.find((candidate) => !used_cells.has(candidate))
    if (cell === undefined) throw new Error(`fight setup has more team ${side} fighters than start cells`)
    used_cells.add(cell)
    return cell
  }
  const fighters = [
    ...players.map((player) => ({
      team: BigInt(player.team ?? 0),
      kind: { type: 'player' as const, character: player.character, owner: player.owner, level: player.source.level },
      cell: start_cell(BigInt(player.team ?? 0), player.cell),
      ready: Boolean(player.ready),
      dead: false,
      settled: false,
      forfeited: false,
      hp: player.hp,
      ap: 0n,
      mp: 0n,
      drops: [],
      effects: [],
      cooldowns: [],
    })),
    ...mobs.map((mob) => {
      const snapshot = create_mob_snapshot(mob.template, mob.scalar)
      return {
        team: BigInt(mob.team ?? 1),
        kind: { type: 'mob' as const, snapshot },
        cell: start_cell(BigInt(mob.team ?? 1), mob.cell),
        ready: true,
        dead: false,
        settled: true,
        forfeited: false,
        hp: snapshot.max_hp,
        ap: 0n,
        mp: 0n,
        drops: [],
        effects: [],
        cooldowns: [],
      }
    }),
  ]
  const sources: FightSources = {
    players: Object.fromEntries(players.map((player) => [player.character, player.source])),
    spells,
  }
  return normalize_checkpoint({
    contract: {
      id: fight_id,
      world,
      x,
      z,
      board,
      closed: closed_mask(board),
      access_a: 0n,
      access_b: 255n,
      opener_a: players[0]?.character ?? null,
      opener_b: null,
      fighters,
      zones: [],
      queue: [],
      turn_ptr: 0n,
      round: 0n,
      ended: false,
      winner: null,
      dungeon: null,
      dungeon_room: null,
      managed: false,
      wagered: false,
      drops_rolled: false,
      boss_weight: 0,
      kares_reward: 0,
      turn_seed: 0n,
      turn_slot: 0n,
      turn_casts: [],
      placement_ms,
      started_ms: null,
      ended_ms: null,
      turn_started_ms: 0n,
    },
    sources,
  }) as HydratedFightCheckpoint
}
