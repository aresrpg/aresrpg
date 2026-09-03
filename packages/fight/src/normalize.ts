// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Decode once at the package door. Every Move integer becomes bigint before combat code sees it.

import { CONTRACT_CONSTANTS, ITEM_STAT_FIELDS } from './move_contract.gen.ts'
import type {
  ActiveEffect,
  BoardZone,
  FightBoard,
  FightCheckpoint,
  FightContract,
  Fighter,
  FightSources,
  ItemStatField,
  KitSpell,
  MobLoot,
  MobSnapshot,
  PlayerSource,
  SpellEffect,
  SpellLevel,
} from './types.ts'

const SHIFT = BigInt(CONTRACT_CONSTANTS.item_stat_shift)

type RawRecord = Record<string, unknown>

const raw_record = (value: unknown): RawRecord => value as RawRecord
const raw_list = (value: unknown): unknown[] => value as unknown[]

export const as_bigint = (value: unknown, label = 'integer'): bigint => {
  const decoded =
    typeof value === 'bigint'
      ? value
      : typeof value === 'number' && Number.isSafeInteger(value)
        ? BigInt(value)
        : typeof value === 'string' && /^\d+$/.test(value)
          ? BigInt(value)
          : null
  if (decoded !== null && decoded >= 0n) return decoded
  throw new Error(`${label} must be an unsigned integer`)
}

const deep_freeze = <Value>(value: Value): Value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deep_freeze)
    Object.freeze(value)
  }
  return value
}

const normalize_effect = (input: unknown): SpellEffect => {
  const effect = raw_record(input)
  return {
    kind: as_bigint(effect.kind, 'effect.kind'),
    element: String(effect.element ?? ''),
    value: as_bigint(effect.value, 'effect.value'),
    value_max: as_bigint(effect.value_max ?? effect.value, 'effect.value_max'),
    area_shape: as_bigint(effect.area_shape ?? 0, 'effect.area_shape'),
    area_size: as_bigint(effect.area_size ?? 0, 'effect.area_size'),
    target_filter: as_bigint(effect.target_filter ?? 0, 'effect.target_filter'),
    chance_bp: as_bigint(effect.chance_bp ?? 10_000, 'effect.chance_bp'),
    turns: as_bigint(effect.turns ?? 0, 'effect.turns'),
    stat: as_bigint(effect.stat ?? 0, 'effect.stat'),
  }
}

const normalize_spell_level = (input: unknown): SpellLevel => {
  const level = raw_record(input)
  return {
    ap_cost: as_bigint(level.ap_cost, 'spell.ap_cost'),
    range_min: as_bigint(level.range_min, 'spell.range_min'),
    range_max: as_bigint(level.range_max, 'spell.range_max'),
    modifiable_range: Boolean(level.modifiable_range),
    line_of_sight: Boolean(level.line_of_sight),
    line_launch: Boolean(level.line_launch),
    free_cell: Boolean(level.free_cell),
    casts_per_turn: as_bigint(level.casts_per_turn ?? 0, 'spell.casts_per_turn'),
    casts_per_target: as_bigint(level.casts_per_target ?? 0, 'spell.casts_per_target'),
    cooldown_turns: as_bigint(level.cooldown_turns ?? 0, 'spell.cooldown_turns'),
    crit_1_in: as_bigint(level.crit_1_in ?? 0, 'spell.crit_1_in'),
    effects: raw_list(level.effects ?? []).map(normalize_effect),
    crit_effects: raw_list(level.crit_effects ?? []).map(normalize_effect),
  }
}

const normalize_kit_spell = (input: unknown): KitSpell => {
  const spell = raw_record(input)
  return {
    name: String(spell.name),
    ordinal: as_bigint(spell.ordinal, 'kit.ordinal'),
    level: normalize_spell_level(spell.level),
  }
}

const normalize_mob = (input: unknown): MobSnapshot => {
  const mob = raw_record(input)
  return {
    mob_type: String(mob.mob_type),
    level: as_bigint(mob.level, 'mob.level'),
    max_hp: as_bigint(mob.max_hp, 'mob.max_hp'),
    ap: as_bigint(mob.ap, 'mob.ap'),
    mp: as_bigint(mob.mp, 'mob.mp'),
    agility: as_bigint(mob.agility, 'mob.agility'),
    wisdom: as_bigint(mob.wisdom, 'mob.wisdom'),
    earth_res: as_bigint(mob.earth_res ?? SHIFT, 'mob.earth_res'),
    fire_res: as_bigint(mob.fire_res ?? SHIFT, 'mob.fire_res'),
    water_res: as_bigint(mob.water_res ?? SHIFT, 'mob.water_res'),
    air_res: as_bigint(mob.air_res ?? SHIFT, 'mob.air_res'),
    kit: raw_list(mob.kit ?? []).map(normalize_kit_spell),
    xp: as_bigint(mob.xp ?? 0, 'mob.xp'),
    loot: raw_list(mob.loot ?? []).map((input_row) => {
      const row = raw_record(input_row)
      return {
        ...row,
        chance_bp: as_bigint(row.chance_bp ?? row.chance ?? 0, 'loot.chance_bp'),
        min_qty: as_bigint(row.min_qty ?? 1, 'loot.min_qty'),
        max_qty: as_bigint(row.max_qty ?? row.min_qty ?? 1, 'loot.max_qty'),
      } as MobLoot
    }),
  }
}

const normalize_active_effect = (input: unknown): ActiveEffect => {
  const effect = raw_record(input)
  return {
    kind: as_bigint(effect.kind, 'active_effect.kind'),
    element: String(effect.element ?? ''),
    value: as_bigint(effect.value, 'active_effect.value'),
    turns_left: as_bigint(effect.turns_left, 'active_effect.turns_left'),
    source: as_bigint(effect.source, 'active_effect.source'),
    stat: as_bigint(effect.stat ?? 0, 'active_effect.stat'),
  }
}

const normalize_fighter = (input: unknown): Fighter => {
  const fighter = raw_record(input)
  const kind = raw_record(fighter.kind)
  return {
    team: as_bigint(fighter.team, 'fighter.team'),
    kind:
      kind.type === 'mob'
        ? { type: 'mob', snapshot: normalize_mob(kind.snapshot) }
        : {
            type: 'player',
            character: String(kind.character),
            owner: String(kind.owner),
            level: as_bigint(kind.level, 'fighter.kind.level'),
          },
    cell: as_bigint(fighter.cell, 'fighter.cell'),
    ready: Boolean(fighter.ready),
    dead: Boolean(fighter.dead),
    settled: Boolean(fighter.settled),
    forfeited: Boolean(fighter.forfeited),
    hp: as_bigint(fighter.hp, 'fighter.hp'),
    ap: as_bigint(fighter.ap ?? 0, 'fighter.ap'),
    mp: as_bigint(fighter.mp ?? 0, 'fighter.mp'),
    drops: raw_list(fighter.drops ?? []).map((input_drop) => {
      const drop = raw_record(input_drop)
      return { item_type: String(drop.item_type), qty: as_bigint(drop.qty, 'drop.qty') }
    }),
    effects: raw_list(fighter.effects ?? []).map(normalize_active_effect),
    cooldowns: raw_list(fighter.cooldowns ?? []).map((input_row) => {
      const row = raw_record(input_row)
      return { spell: String(row.spell), left: as_bigint(row.left, 'cooldown.left') }
    }),
  }
}

const normalize_board = (input: unknown): FightBoard => {
  const board = raw_record(input)
  return {
    width: as_bigint(board.width, 'board.width'),
    height: as_bigint(board.height, 'board.height'),
    shape_mask: raw_list(board.shape_mask).map((word) => as_bigint(word, 'board.shape_mask')),
    obstacles: raw_list(board.obstacles).map((cell) => as_bigint(cell, 'board.obstacles')),
    holes: raw_list(board.holes).map((cell) => as_bigint(cell, 'board.holes')),
    start_cells_a: raw_list(board.start_cells_a).map((cell) => as_bigint(cell, 'board.start_cells_a')),
    start_cells_b: raw_list(board.start_cells_b).map((cell) => as_bigint(cell, 'board.start_cells_b')),
  }
}

const normalize_zone = (input: unknown): BoardZone => {
  const zone = raw_record(input)
  return {
    owner_fighter: as_bigint(zone.owner_fighter, 'zone.owner_fighter'),
    trap: Boolean(zone.trap),
    shape: as_bigint(zone.shape, 'zone.shape'),
    size: as_bigint(zone.size, 'zone.size'),
    anchor: as_bigint(zone.anchor, 'zone.anchor'),
    turns_left: as_bigint(zone.turns_left, 'zone.turns_left'),
    effects: raw_list(zone.effects).map(normalize_effect),
  }
}

const nullable_string = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value)
const nullable_bigint = (value: unknown, label: string): bigint | null =>
  value === null || value === undefined ? null : as_bigint(value, label)

export const normalize_contract = (input: unknown): FightContract | null => {
  const contract = input === null ? null : raw_record(input)
  if (contract === null) return null
  return {
    id: String(contract.id),
    world: String(contract.world),
    x: as_bigint(contract.x, 'fight.x'),
    z: as_bigint(contract.z, 'fight.z'),
    board: normalize_board(contract.board),
    closed: raw_list(contract.closed).map((word) => as_bigint(word, 'fight.closed')),
    access_a: as_bigint(contract.access_a, 'fight.access_a'),
    access_b: as_bigint(contract.access_b, 'fight.access_b'),
    opener_a: contract.opener_a === null ? null : String(contract.opener_a),
    opener_b: contract.opener_b === null ? null : String(contract.opener_b),
    fighters: raw_list(contract.fighters).map(normalize_fighter),
    zones: raw_list(contract.zones ?? []).map(normalize_zone),
    queue: raw_list(contract.queue ?? []).map((seat) => as_bigint(seat, 'fight.queue')),
    turn_ptr: as_bigint(contract.turn_ptr ?? 0, 'fight.turn_ptr'),
    round: as_bigint(contract.round ?? 0, 'fight.round'),
    ended: Boolean(contract.ended),
    winner: nullable_bigint(contract.winner, 'fight.winner'),
    dungeon: nullable_string(contract.dungeon),
    dungeon_room: nullable_bigint(contract.dungeon_room, 'fight.dungeon_room'),
    managed: Boolean(contract.managed),
    wagered: Boolean(contract.wagered),
    drops_rolled: Boolean(contract.drops_rolled),
    turn_seed: as_bigint(contract.turn_seed ?? 0, 'fight.turn_seed'),
    turn_slot: as_bigint(contract.turn_slot ?? 0, 'fight.turn_slot'),
    turn_casts: raw_list(contract.turn_casts ?? []).map((input_row) => {
      const row = raw_record(input_row)
      return { spell: String(row.spell), target: as_bigint(row.target, 'turn_cast.target') }
    }),
    placement_ms: as_bigint(contract.placement_ms ?? 0, 'fight.placement_ms'),
    started_ms:
      contract.started_ms === null || contract.started_ms === undefined
        ? null
        : as_bigint(contract.started_ms, 'fight.started_ms'),
    ended_ms:
      contract.ended_ms === null || contract.ended_ms === undefined
        ? null
        : as_bigint(contract.ended_ms, 'fight.ended_ms'),
    turn_started_ms: as_bigint(contract.turn_started_ms ?? 0, 'fight.turn_started_ms'),
  }
}

const normalize_folded_stats = (input: unknown = {}): Record<ItemStatField, bigint> => {
  const stats = raw_record(input)
  return Object.fromEntries(
    ITEM_STAT_FIELDS.map((field) => [field, as_bigint(stats[field] ?? SHIFT, `stats.${field}`)])
  ) as Record<ItemStatField, bigint>
}

const normalize_player_appearance = (player: Readonly<Record<string, unknown>>) => ({
  sex: String(player.sex ?? 'male'),
  color_1: Number(player.color_1 ?? 0xffffff),
  color_2: Number(player.color_2 ?? 0xd9af57),
  color_3: Number(player.color_3 ?? 0x8b6539),
  hat: typeof player.hat === 'string' ? player.hat : null,
  cloak: typeof player.cloak === 'string' ? player.cloak : null,
})

const normalize_player = (input: unknown): PlayerSource => {
  const player = raw_record(input)
  const weapon = player.weapon ? raw_record(player.weapon) : null
  const appearance = normalize_player_appearance(player)
  return {
    name: typeof player.name === 'string' ? player.name : '',
    classe: String(player.classe),
    ...appearance,
    level: as_bigint(player.level, 'player.level'),
    experience: as_bigint(player.experience ?? 0, 'player.experience'),
    vitality: as_bigint(player.vitality ?? 0, 'player.vitality'),
    wisdom: as_bigint(player.wisdom ?? 0, 'player.wisdom'),
    strength: as_bigint(player.strength ?? 0, 'player.strength'),
    intelligence: as_bigint(player.intelligence ?? 0, 'player.intelligence'),
    chance: as_bigint(player.chance ?? 0, 'player.chance'),
    agility: as_bigint(player.agility ?? 0, 'player.agility'),
    spell_levels: Object.fromEntries(
      Object.entries(raw_record(player.spell_levels ?? {})).map(([name, level]) => [
        name,
        as_bigint(level, `spell_levels.${name}`),
      ])
    ),
    folded_stats: normalize_folded_stats(player.folded_stats),
    weapon: weapon
      ? {
          category: String(weapon.category),
          damages: raw_list(weapon.damages ?? []).map((input_line) => {
            const line = raw_record(input_line)
            return {
              element: String(line.element),
              from: as_bigint(line.from, 'weapon.from'),
              to: as_bigint(line.to, 'weapon.to'),
            }
          }),
        }
      : null,
  }
}

export const normalize_sources = (input: unknown): FightSources => {
  const sources = raw_record(input)
  return deep_freeze({
    players: Object.fromEntries(
      Object.entries(raw_record(sources.players ?? {})).map(([character, player]) => [
        character,
        normalize_player(player),
      ])
    ),
    spells: Object.fromEntries(
      Object.entries(raw_record(sources.spells ?? {})).map(([name, input_spell]) => {
        const spell = raw_record(input_spell)
        return [
          name,
          {
            classe: String(spell.classe),
            unlock_level: as_bigint(spell.unlock_level ?? 1, 'spell.unlock_level'),
            levels: raw_list(spell.levels).map(normalize_spell_level),
          },
        ]
      })
    ),
  })
}

export const normalize_checkpoint = (input: unknown): FightCheckpoint => {
  const checkpoint = raw_record(input)
  return {
    contract: normalize_contract(checkpoint.contract),
    sources: normalize_sources(checkpoint.sources),
  }
}
