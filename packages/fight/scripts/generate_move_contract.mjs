#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The fight package is a projection of Move declarations. This offline generator deliberately
// parses only the exact declarations it owns; an absent declaration is a hard failure.

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import prettier from 'prettier'

const package_root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repo_root = join(package_root, '../..')
const output_path = join(package_root, 'src/move_contract.gen.ts')

const source_paths = [
  'packages/move/sources/fight.move',
  'packages/move-combat/sources/combat.move',
  'packages/move/sources/api.move',
  'packages/move/sources/character.move',
  'packages/move/sources/equipment.move',
  'packages/move/sources/forgemagie.move',
  'packages/seed/sources/mob_rows.move',
  'packages/seed/sources/spell_rows.move',
  'packages/move/sources/progression.move',
  'packages/move-math/sources/prng.move',
  'packages/move-math/sources/fight_math.move',
  'packages/move-math/sources/combat_grid.move',
  'packages/move-math/sources/spell_effect.move',
  'packages/move-math/sources/item_stats.move',
  'packages/move-math/sources/item_damages.move',
  'packages/move-math/sources/weapon.move',
]

const sources = Object.fromEntries(source_paths.map((path) => [path, readFileSync(join(repo_root, path), 'utf8')]))

const required_match = (source, pattern, label) => {
  const match = source.match(pattern)
  if (!match) throw new Error(`generate_move_contract: missing ${label}`)
  return match
}

const constant_table = (source) => {
  const declarations = Object.fromEntries(
    [...source.matchAll(/const ([A-Z][A-Z0-9_]*): (?:u8|u16|u32|u64) = ([^;]+);/g)].map(([, name, raw]) => [
      name,
      raw.trim(),
    ])
  )
  const resolved = {}
  const resolve = (name) => {
    if (resolved[name] !== undefined) return resolved[name]
    const raw = declarations[name]
    if (raw === undefined) throw new Error(`generate_move_contract: unknown constant ${name}`)
    const substituted = raw.replace(/\b[A-Z][A-Z0-9_]*\b/g, resolve).replaceAll('_', '')
    if (!/^[\dxa-fA-F()+*/%&|<>\s-]+$/.test(substituted))
      throw new Error(`generate_move_contract: unsupported constant expression ${name} = ${raw}`)
    const bigint_expression = substituted.replace(/0x[\da-fA-F]+|\b\d+\b/g, (token) => `${token}n`)
    const value = Function(`"use strict"; return (${bigint_expression})`)().toString()
    resolved[name] = value
    return value
  }
  Object.keys(declarations).forEach(resolve)
  return resolved
}

const integer = (raw, source) => {
  const synthetic = `${source}\nconst GENERATED_VALUE: u64 = ${raw};`
  return constant_table(synthetic).GENERATED_VALUE
}

const consts = (source, prefix) =>
  Object.fromEntries(
    Object.entries(constant_table(source))
      .filter(([name]) => name.startsWith(prefix))
      .map(([name, value]) => [name.toLowerCase().replace(`${prefix.toLowerCase()}`, ''), value])
  )

const selected_constants = (source, names) => {
  const table = constant_table(source)
  return Object.fromEntries(
    names.map((name) => {
      if (table[name] === undefined) throw new Error(`generate_move_contract: missing constant ${name}`)
      return [name.toLowerCase(), table[name]]
    })
  )
}

const split_top_level = (source, delimiter) => {
  const parts = []
  let start = 0
  let angle_depth = 0
  let paren_depth = 0
  let bracket_depth = 0
  let brace_depth = 0
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === '<') angle_depth += 1
    else if (character === '>') angle_depth -= 1
    else if (character === '(') paren_depth += 1
    else if (character === ')') paren_depth -= 1
    else if (character === '[') bracket_depth += 1
    else if (character === ']') bracket_depth -= 1
    else if (character === '{') brace_depth += 1
    else if (character === '}') brace_depth -= 1
    else if (
      character === delimiter &&
      angle_depth === 0 &&
      paren_depth === 0 &&
      bracket_depth === 0 &&
      brace_depth === 0
    ) {
      parts.push(source.slice(start, index))
      start = index + 1
    }
  }
  parts.push(source.slice(start))
  return parts
}

const struct_schema = (source, name) => {
  const [, body] = required_match(
    source,
    new RegExp(`public (?:enum|struct) ${name}(?: has [^{]+)? \\{([\\s\\S]*?)\\}`),
    `struct ${name}`
  )
  const uncommented = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const fields = split_top_level(uncommented, ',').flatMap((part) => {
    const match = part.trim().match(/^([a-z][a-z0-9_]*):\s*([\s\S]+)$/)
    return match ? [{ name: match[1], type: match[2].trim().replace(/\s+/g, ' ') }] : []
  })
  if (fields.length === 0 && !body.includes('Player') && !body.includes('Mob'))
    throw new Error(`generate_move_contract: struct ${name} parsed zero fields`)
  return fields
}

const shape_values = (source) =>
  Object.fromEntries(
    [...source.matchAll(/public fun shape_([a-z_]+)\(\): u8 \{ (\d+) \}/g)].map(([, name, value]) => [name, value])
  )

const direction_values = (source) => {
  const [, positive_x, negative_x, positive_y, negative_y] = required_match(
    source,
    /if \(sx >= px\) (\d+) else (\d+) \} else \{ if \(sy >= py\) (\d+) else (\d+) \}/,
    'cardinal directions'
  )
  return {
    positive_x,
    negative_x,
    positive_y,
    negative_y,
    none: constant_table(source).DIR_NONE,
  }
}

const target_filters = (source) => {
  const [, body] = required_match(
    source,
    /public fun target_allowed\([\s\S]*?\): bool \{([\s\S]*?)\n\}/,
    'target_allowed'
  )
  const patterns = {
    not_team: /filter == (\d+)\) target_team != caster_team/,
    not_self: /filter == (\d+)\) !self_target/,
    not_enemy: /filter == (\d+)\) target_team == caster_team/,
    only_caster: /filter == (\d+)\) self_target/,
  }
  return Object.fromEntries([
    ['none', '0'],
    ...Object.entries(patterns).map(([name, pattern]) => [
      name,
      required_match(body, pattern, `target filter ${name}`)[1],
    ]),
  ])
}

const weapon_physics = (source) => {
  const rows = [...source.matchAll(/\*category == b"([^"]+)"\.to_string\(\)\) \(([^)]+)\)/g)]
  if (rows.length !== 5) throw new Error(`generate_move_contract: expected 5 weapon rows, got ${rows.length}`)
  return Object.fromEntries(
    rows.map(([, category, raw]) => {
      const [crit_1_in, ap, reach, range_min, modifiable_range, line_launch, area_shape, area_size] = raw
        .split(',')
        .map((value) => value.trim())
      return [
        category,
        {
          crit_1_in,
          ap,
          reach,
          range_min,
          modifiable_range: modifiable_range === 'true',
          line_launch: line_launch === 'true',
          area_shape,
          area_size,
        },
      ]
    })
  )
}

const affinities = (source) =>
  Object.fromEntries(
    [...source.matchAll(/c == b"([^"]+)"\.to_string\(\) && f == b"([^"]+)"\.to_string\(\)/g)].map(
      ([, classe, category]) => [classe, category]
    )
  )

const fight_doors = (source) => {
  const [, section] = required_match(
    source,
    /\[ Fights \][\s\S]*?\n([\s\S]*?)\/\/ ╔[^\n]*\[ Party \]/,
    'api fight section'
  )
  const stripped = section.replace(/\/\/[^\n]*/g, '')
  return Object.fromEntries(
    [...stripped.matchAll(/(?:public\s+entry\s+fun|public\s+fun|entry\s+fun)\s+(\w+)\s*\(([^)]*)\)/g)].map(
      ([, name, params]) => {
        const arguments_shape = params
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => {
            const [argument, ...rest] = part.split(':')
            return { name: argument.trim(), type: rest.join(':').trim().replace(/\s+/g, ' ') }
          })
        return [
          name,
          { arguments: arguments_shape, terminal_random: arguments_shape.some(({ type }) => type === '&Random') },
        ]
      }
    )
  )
}

const source_hash = createHash('sha256')
  .update(source_paths.map((path) => `${path}\0${sources[path]}`).join('\0'))
  .digest('hex')

const fight = sources['packages/move/sources/fight.move']
const combat = sources['packages/move-combat/sources/combat.move']
const api = sources['packages/move/sources/api.move']
const progression = sources['packages/move/sources/progression.move']
const forgemagie = sources['packages/move/sources/forgemagie.move']
const combat_grid = sources['packages/move-math/sources/combat_grid.move']
const spell_effect = sources['packages/move-math/sources/spell_effect.move']
const item_stats = sources['packages/move-math/sources/item_stats.move']
const weapon = sources['packages/move-math/sources/weapon.move']

const selected_structs = {
  Effect: struct_schema(spell_effect, 'Effect'),
  SpellLevel: struct_schema(spell_effect, 'SpellLevel'),
  GridSpec: struct_schema(combat_grid, 'GridSpec'),
  Fight: struct_schema(fight, 'Fight'),
  Fighter: struct_schema(combat, 'Fighter'),
  MobSnapshot: struct_schema(combat, 'MobSnapshot'),
  KitSpell: struct_schema(combat, 'KitSpell'),
  TurnCast: struct_schema(combat, 'TurnCast'),
  ActiveEffect: struct_schema(combat, 'ActiveEffect'),
  Cooldown: struct_schema(combat, 'Cooldown'),
  BoardZone: struct_schema(combat, 'BoardZone'),
  RolledDrop: struct_schema(combat, 'RolledDrop'),
  FightCreated: struct_schema(fight, 'FightCreated'),
  FighterJoined: struct_schema(fight, 'FighterJoined'),
  FightStarted: struct_schema(fight, 'FightStarted'),
  FightEnded: struct_schema(fight, 'FightEnded'),
  TurnSeedUsed: struct_schema(fight, 'TurnSeedUsed'),
  DropsRolled: struct_schema(fight, 'DropsRolled'),
  ItemStatistics: struct_schema(item_stats, 'ItemStatistics'),
}

const integer_widths = Object.fromEntries(
  Object.entries(selected_structs).map(([name, fields]) => [
    name,
    Object.fromEntries(
      fields.flatMap(({ name: field, type }) => {
        const width = type.match(/\bu(8|16|32|64)\b/)
        return width ? [[field, Number(width[1])]] : []
      })
    ),
  ])
)

const contract_constants = {
  ...selected_constants(combat, [
    'BASE_AP',
    'BASE_MP',
    'PLACEMENT_FORCE_MS',
    'TURN_MIN_MS',
    'TURN_MAX_MS',
    'NO_TARGET',
  ]),
  ...selected_constants(spell_effect, ['CHATIMENT_TURNS']),
  ...selected_constants(forgemagie, ['RUNE_UNLOCK_LEVEL']),
  ...selected_constants(combat_grid, [
    'GRID_W',
    'GRID_H',
    'GRID_CELLS',
    'MASK_WORDS',
    'MIN_W',
    'MAX_W',
    'MIN_H',
    'MAX_H',
    'START_CELLS',
    'OBS_MIN',
    'OBS_MAX',
    'HOLE_MIN',
    'HOLE_MAX',
    'BLOCKER_MAX_LEN',
    'N_SHAPES',
    'VARIANT_MIX',
  ]),
  item_stat_shift: integer(required_match(item_stats, /const SHIFT: u16 = ([^;]+);/, 'item stat shift')[1], item_stats),
  base_hp: integer(required_match(progression, /const BASE_HP: u64 = ([^;]+);/, 'BASE_HP')[1], progression),
  hp_per_level: integer(
    required_match(progression, /const HP_PER_LEVEL: u64 = ([^;]+);/, 'HP_PER_LEVEL')[1],
    progression
  ),
}

const literal = (value, move_integers = false) => {
  if (move_integers && typeof value === 'string' && /^\d+$/.test(value)) return `${value}n`
  if (Array.isArray(value)) return `[${value.map((inner) => literal(inner, move_integers)).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .map(([key, inner]) => `${JSON.stringify(key)}:${literal(inner, move_integers)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
const output = `// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GENERATED by scripts/generate_move_contract.mjs — DO NOT EDIT.
/* eslint-disable max-lines -- generated declaration projection; size follows the Move contract */

export const MOVE_SOURCE_HASH = '${source_hash}'

export const EFFECT_KINDS = Object.freeze(${literal(consts(combat, 'K_'), true)})
export const CHANNELS = Object.freeze(${literal(consts(combat, 'STAT_'), true)})
export const AREA_SHAPES = Object.freeze(${literal(shape_values(spell_effect), true)})
export const BOARD_SHAPES = Object.freeze(${literal(consts(combat_grid, 'SHAPE_'), true)})
export const DIRECTIONS = Object.freeze(${literal(direction_values(combat_grid), true)})
export const TARGET_FILTERS = Object.freeze(${literal(target_filters(spell_effect), true)})
export const ACCESS = Object.freeze(${literal(consts(fight, 'ACCESS_'), true)})

export const CONTRACT_CONSTANTS = Object.freeze(${literal(contract_constants, true)})

export const STRUCT_SCHEMAS = Object.freeze(${literal(selected_structs)})
export const INTEGER_WIDTHS = Object.freeze(${literal(integer_widths)})
export const ITEM_STAT_FIELDS = Object.freeze(${literal(selected_structs.ItemStatistics.map(({ name }) => name))})
export const WEAPON_PHYSICS = Object.freeze(${literal(weapon_physics(weapon), true)})
export const CLASS_AFFINITIES = Object.freeze(${literal(affinities(weapon))})
export const API_FIGHT_DOORS = Object.freeze(${literal(fight_doors(api))})

export const MOVE_SOURCES = Object.freeze(${literal(source_paths.map((path) => relative(repo_root, join(repo_root, path))))})
`

const formatted = await prettier.format(output, {
  ...(await prettier.resolveConfig(output_path)),
  parser: 'typescript',
})
const check = process.argv.includes('--check')
if (check) {
  const committed = readFileSync(output_path, 'utf8')
  if (committed !== formatted) throw new Error('move_contract.gen.ts is stale; run bun run generate')
  console.log(`move_contract.gen.ts current — ${source_hash.slice(0, 12)}`)
} else {
  writeFileSync(output_path, formatted)
  console.log(`move_contract.gen.ts written — ${source_hash.slice(0, 12)}`)
}
