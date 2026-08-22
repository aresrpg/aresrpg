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

const band_scaled = (base: bigint, low: bigint, high: bigint, level: bigint): bigint =>
  high === low ? base : (base * 7n * (high - low + (level - low))) / (10n * (high - low))

export const create_mob_snapshot = (template: MobTemplateSource, scalar: bigint): MobSnapshot => {
  const level = template.level_min + ((template.level_max - template.level_min) * scalar) / 100n
  const kit = template.spells.map((spell) => {
    const count = BigInt(spell.levels.length)
    const raw =
      template.level_max === template.level_min
        ? count - 1n
        : ((level - template.level_min) * count) / (template.level_max - template.level_min + 1n)
    const index = raw >= count ? count - 1n : raw
    const selected = spell.levels[Number(index)]
    if (!selected) throw new Error(`mob template ${template.mob_type} spell ${spell.name} has no levels`)
    return { name: spell.name, ordinal: index + 1n, level: selected }
  })
  return {
    mob_type: template.mob_type,
    level,
    max_hp: band_scaled(template.hp, template.level_min, template.level_max, level),
    ap: template.ap,
    mp: template.mp,
    agility: template.agility,
    wisdom: template.wisdom,
    earth_res: template.earth_res,
    fire_res: template.fire_res,
    water_res: template.water_res,
    air_res: template.air_res,
    kit,
    xp: band_scaled(template.xp, template.level_min, template.level_max, level),
    loot: template.loot,
  }
}

export const mob_scalar_for_level = (template: MobTemplateSource, requested_level: bigint): bigint => {
  const low = template.level_min
  const high = template.level_max
  const level = requested_level < low ? low : requested_level > high ? high : requested_level
  const range = high - low
  return range === 0n ? 0n : ((level - low) * 100n + range - 1n) / range
}

export const create_character_source = ({
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
}: CharacterSourceInput): PlayerSource =>
  normalize_sources({
    players: {
      character: {
        name,
        classe,
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
  players,
  mobs,
  spells = {},
  placement_ms = 0n,
}: FightSetup): HydratedFightCheckpoint => {
  const board = generate_board(board_seed)
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
      kind: { type: 'player' as const, character: player.character, owner: player.owner },
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
      managed: false,
      wagered: false,
      drops_rolled: false,
      turn_seed: 0n,
      turn_slot: 0n,
      turn_casts: [],
      placement_ms,
      turn_started_ms: 0n,
    },
    sources,
  }) as HydratedFightCheckpoint
}
