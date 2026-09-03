// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { generate_board } from './board_gen.ts'
import { GRID_CELLS, empty_mask, mask_add_cells, mask_get } from './combat_grid.ts'
import { CONTRACT_CONSTANTS, ITEM_STAT_FIELDS } from './move_contract.gen.ts'
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

const ITEM_STAT_CENTER = 32_768n
const BASE_HP = BigInt(CONTRACT_CONSTANTS.base_hp)
const HP_PER_LEVEL = BigInt(CONTRACT_CONSTANTS.hp_per_level)

export const mob_band_scaled = (base: bigint, low: bigint, high: bigint, level: bigint): bigint => {
  if (high === low) return base
  const span = high - low
  return (base * (6n * span + 10n * (level - low))) / (10n * span)
}

export const mob_effect_value_scaled = (base: bigint, low: bigint, high: bigint, level: bigint): bigint => {
  const scaled = mob_band_scaled(base, low, high, level)
  return base > 0n && scaled === 0n ? 1n : scaled
}

export const mob_centered_band_scaled = (
  value: bigint,
  center: bigint,
  low: bigint,
  high: bigint,
  level: bigint
): bigint => {
  if (value >= center) return center + mob_band_scaled(value - center, low, high, level)
  if (high === low) return value
  const span = high - low
  const scaled = ((center - value) * (16n * span - 10n * (level - low))) / (10n * span)
  return scaled >= center ? 0n : center - scaled
}

export const mob_loot_chance_scaled = (base_bp: bigint, low: bigint, high: bigint, level: bigint): bigint => {
  if (high === low) return base_bp
  const span = high - low
  const scaled = (base_bp * (8n * span + 4n * (level - low))) / (10n * span)
  return scaled > 10_000n ? 10_000n : scaled
}

export const mob_pool_scaled = (base: bigint, low: bigint, high: bigint, level: bigint): bigint => {
  if (high === low) return base
  const span = high - low
  const denominator = 10n * span
  const numerator = base * (10n * span + 3n * (level - low))
  return (numerator + denominator / 2n) / denominator
}

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

export const create_mob_snapshot = (template: MobTemplateSource, scalar: bigint): MobSnapshot => {
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
    earth_res: mob_centered_band_scaled(
      template.earth_res,
      ITEM_STAT_CENTER,
      template.level_min,
      template.level_max,
      level
    ),
    fire_res: mob_centered_band_scaled(
      template.fire_res,
      ITEM_STAT_CENTER,
      template.level_min,
      template.level_max,
      level
    ),
    water_res: mob_centered_band_scaled(
      template.water_res,
      ITEM_STAT_CENTER,
      template.level_min,
      template.level_max,
      level
    ),
    air_res: mob_centered_band_scaled(
      template.air_res,
      ITEM_STAT_CENTER,
      template.level_min,
      template.level_max,
      level
    ),
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

const character_source_appearance = ({
  sex = 'male',
  color_1 = 0xffffff,
  color_2 = 0xd9af57,
  color_3 = 0x8b6539,
  hat = null,
  cloak = null,
}: CharacterSourceInput) => Object.freeze({ sex, color_1, color_2, color_3, hat, cloak })

export const create_character_source = (input: CharacterSourceInput): PlayerSource => {
  const {
    name = '',
    classe,
    level = 1n,
    experience = 0n,
    vitality = 0n,
    wisdom = 0n,
    strength = 0n,
    intelligence = 0n,
    chance = 0n,
    agility = 0n,
    spell_levels = {},
    folded_stats = {},
    weapon = null,
  } = input
  const appearance = character_source_appearance(input)
  return normalize_sources({
    players: {
      character: {
        name,
        classe,
        ...appearance,
        level,
        experience,
        vitality,
        wisdom,
        strength,
        intelligence,
        chance,
        agility,
        spell_levels,
        folded_stats: Object.fromEntries(
          ITEM_STAT_FIELDS.map((field) => [field, folded_stats[field] ?? ITEM_STAT_CENTER])
        ),
        weapon,
      },
    },
    spells: {},
  }).players.character
}

export const player_max_hp = (source: Readonly<PlayerSource>): bigint => {
  const base = BASE_HP + HP_PER_LEVEL * source.level + source.vitality
  const folded = source.folded_stats.vitality
  if (folded >= ITEM_STAT_CENTER) return base + folded - ITEM_STAT_CENTER
  const malus = ITEM_STAT_CENTER - folded
  return malus >= base ? 1n : base - malus
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
