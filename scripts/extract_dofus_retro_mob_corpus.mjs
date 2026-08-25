// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Regenerates the anonymous mob-grade corpus from the official Retro client's Chromium cache.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo_dir = dirname(dirname(fileURLToPath(import.meta.url)))
const argument = (name) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? null : process.argv[index + 1]
}
const cache_dir = argument('--cache-dir') ?? join(homedir(), 'Library', 'Application Support', 'Dofus Retro', 'Cache')
const output = argument('--output') ?? join(repo_dir, 'packages', 'immutable', 'src', 'dofus_mob_power_corpus.gen.ts')
const server_data_dir = argument('--server-data-dir')
const server_data_revision = argument('--server-data-revision') ?? 'unversioned'
const cache_marker = Buffer.from('/lang/swf/monsters_fr_')

const attribute = (source, name) => new RegExp(`${name}="([^"]*)"`, 'u').exec(source)?.[1]
const element_text = (source, name) =>
  new RegExp(`<${name}(?: [^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'u').exec(source)?.[1]?.trim() ?? ''
const normalized_name = (name) =>
  name
    .normalize('NFKD')
    .replaceAll(/\p{Mark}/gu, '')
    .replaceAll(/[^a-z0-9]/giu, '')
    .toLowerCase()
const direct_damage_stat = Object.freeze({ 91: 3, 92: 0, 93: 4, 94: 2, 95: 0, 96: 3, 97: 0, 98: 4, 99: 2, 100: 0 })

const parse_spell_levels = (source) => {
  const spells = new Map()
  for (const match of source.matchAll(/<spell id="(\d+)"[^>]*>([\s\S]*?)<\/spell>/gu)) {
    const levels = new Map()
    for (const level of match[2].matchAll(/<level id="(\d+)"([^>]*)>([\s\S]*?)<\/level>/gu)) {
      const [, level_id, level_attributes, level_body] = level
      const effects = [...level_body.matchAll(/<effect ([^>]*)\/>/gu)].map((effect) => {
        const [, attrs] = effect
        return Object.freeze({
          type: Number(attribute(attrs, 'type')),
          from: Number(attribute(attrs, 'first')),
          to: Number(attribute(attrs, 'second')),
          turns: Number(attribute(attrs, 'turns')),
          chance: Number(attribute(attrs, 'chance')),
          critical: attribute(attrs, 'critical') === 'true',
        })
      })
      levels.set(Number(level_id), {
        ap: Number(attribute(level_attributes, 'costAP')),
        critical_rate: Number(attribute(level_attributes, 'criticalRate')),
        max_per_turn: Number(attribute(level_attributes, 'maxPerTurn')),
        max_per_target: Number(attribute(level_attributes, 'maxPerPlayer')),
        effects,
      })
    }
    spells.set(Number(match[1]), levels)
  }
  return spells
}

const effect_damage = (effect, statistics, flat_damage, damage_percent) => {
  const stat_index = direct_damage_stat[effect.type]
  if (stat_index === undefined || effect.turns > 0 || effect.from < 0) return 0
  const base = effect.to < 0 ? effect.from : (effect.from + effect.to) / 2
  const chance = effect.chance > 0 ? effect.chance / 100 : 1
  return ((base * (100 + statistics[stat_index] + damage_percent)) / 100) * chance + flat_damage * chance
}

const spell_damage = (level, statistics, flat_damage, damage_percent) => {
  const normal = level.effects
    .filter(({ critical }) => !critical)
    .reduce((sum, effect) => sum + effect_damage(effect, statistics, flat_damage, damage_percent), 0)
  const critical = level.effects
    .filter(({ critical }) => critical)
    .reduce((sum, effect) => sum + effect_damage(effect, statistics, flat_damage, damage_percent), 0)
  const chance = level.critical_rate > 0 && critical > 0 ? 1 / level.critical_rate : 0
  return normal * (1 - chance) + critical * chance
}

const turn_damage = (spell_refs, ap, statistics, flat_damage, damage_percent, spell_levels) => {
  const casts = spell_refs.flatMap((reference) => {
    const [spell_id, spell_level] = reference.split('@').map(Number)
    const level = spell_levels.get(spell_id)?.get(spell_level)
    if (!level || level.ap <= 0 || level.ap > ap) return []
    const unlimited = Math.floor(ap / level.ap)
    const limits = [level.max_per_turn, level.max_per_target].filter((limit) => limit > 0)
    const count = Math.min(unlimited, ...limits, unlimited)
    const damage = spell_damage(level, statistics, flat_damage, damage_percent)
    return Array.from({ length: count }, () => ({ ap: level.ap, damage }))
  })
  const states = casts.reduce(
    (previous, cast) =>
      previous.map((value, spent) =>
        spent < cast.ap ? value : Math.max(value, previous[spent - cast.ap] + cast.damage)
      ),
    Array.from({ length: ap + 1 }, (_, spent) => (spent === 0 ? 0 : -Infinity))
  )
  return Math.round(Math.max(0, ...states))
}

const server_outputs = () => {
  if (!server_data_dir) return new Map()
  const monsters_source = readFileSync(join(server_data_dir, 'monster', 'templates.xml'), 'utf8')
  const spells_source = readFileSync(join(server_data_dir, 'spell', 'spells.xml'), 'utf8')
  const spell_levels = parse_spell_levels(spells_source)
  const outputs = new Map()
  for (const match of monsters_source.matchAll(/<MonsterTemplate id="(\d+)">([\s\S]*?)<\/MonsterTemplate>/gu)) {
    const [, monster_id_source, body] = match
    const monster_id = Number(monster_id_source)
    const monster_name = normalized_name(element_text(body, 'name'))
    const grades = element_text(body, 'grades').replaceAll(/\s/gu, '').split('|')
    const statistics = element_text(body, 'statistics').replaceAll(/\s/gu, '').split('|')
    const spells = element_text(body, 'spells').replaceAll(/\s/gu, '').split('|')
    const points = element_text(body, 'points').replaceAll(/\s/gu, '').split('|')
    const experiences = element_text(body, 'experience').replaceAll(/\s/gu, '').split('|')
    const [flat_damage = 0, damage_percent = 0] = element_text(body, 'statisticsInfo').split(';').map(Number)
    grades.forEach((grade, index) => {
      const level = Number(grade.split('@')[0])
      const stats = (statistics[index] ?? statistics.at(-1) ?? '').split(',').map(Number)
      const ap = Number((points[index] ?? points.at(-1) ?? '0').split(';')[0])
      const spell_refs = (spells[index] ?? spells.at(-1) ?? '').split(';').filter(Boolean)
      const xp = Number(experiences[index] ?? -1)
      outputs.set(`${monster_id}:${level}`, [
        monster_name,
        xp,
        turn_damage(spell_refs, ap, stats, flat_damage, damage_percent, spell_levels),
      ])
    })
  }
  return outputs
}

const cached_monsters = () => {
  for (const name of readdirSync(cache_dir)) {
    const bytes = readFileSync(join(cache_dir, name))
    const marker = bytes.indexOf(cache_marker)
    if (marker < 0) continue
    const swf_start = bytes.indexOf(Buffer.from('CWS'), marker)
    if (swf_start < 0) continue
    const url_end = swf_start
    const url_start = bytes.lastIndexOf(Buffer.from('https://'), marker)
    const url = bytes.subarray(url_start < 0 ? 0 : url_start, url_end).toString('utf8')
    const version = /monsters_fr_(\d+)\.swf/u.exec(url)?.[1]
    if (version) return Object.freeze({ version, bytes: bytes.subarray(swf_start) })
  }
  throw new Error(`Official monsters_fr SWF was not found in ${cache_dir}`)
}

const token_pattern =
  /Lookup(?:16)?:\d+ \("((?:\\.|[^"\\])*)"\)|String:"((?:\\.|[^"\\])*)"|int:(-?\d+)|float:(-?(?:\d+\.?\d*|\.\d+))|double:(-?(?:\d+\.?\d*|\.\d+))|bool:(true|false)|\b(NULL|UNDEFINED|null|undefined)\b/gu
const decode_string = (value) => value.replaceAll('\\"', '"').replaceAll('\\\\', '\\')
const pushed_values = (line) => {
  const source = line.slice(line.indexOf('action: Push ') + 13)
  const values = []
  for (const match of source.matchAll(token_pattern)) {
    if (match[1] !== undefined) values.push(decode_string(match[1]))
    else if (match[2] !== undefined) values.push(decode_string(match[2]))
    else if (match[3] !== undefined) values.push(Number(match[3]))
    else if (match[4] !== undefined) values.push(Number(match[4]))
    else if (match[5] !== undefined) values.push(Number(match[5]))
    else if (match[6] !== undefined) values.push(match[6] === 'true')
    else values.push(match[7]?.toLowerCase() === 'null' ? null : undefined)
  }
  return values
}

const interpret_data_actions = (source) => {
  const stack = []
  const variables = {}
  for (const line of source.split('\n')) {
    const action = /action: (\w+)/u.exec(line)?.[1]
    if (!action || action === 'Constantpool' || action === 'End') continue
    if (action === 'Push') stack.push(...pushed_values(line))
    else if (action === 'InitArray') {
      const count = stack.pop()
      stack.push(stack.splice(stack.length - count, count))
    } else if (action === 'Makehash') {
      const count = stack.pop()
      const entries = stack.splice(stack.length - count * 2, count * 2)
      stack.push(
        Object.fromEntries(Array.from({ length: count }, (_, index) => entries.slice(index * 2, index * 2 + 2)))
      )
    } else if (action === 'NewObject') {
      const name = stack.pop()
      const count = stack.pop()
      const args = stack.splice(stack.length - count, count)
      stack.push(name === 'Object' ? {} : { name, args })
    } else if (action === 'GetVariable') stack.push(variables[stack.pop()])
    else if (action === 'SetVariable') {
      const value = stack.pop()
      variables[stack.pop()] = value
    } else if (action === 'GetMember') {
      const name = stack.pop()
      stack.push(stack.pop()?.[name])
    } else if (action === 'SetMember') {
      const value = stack.pop()
      const name = stack.pop()
      const target = stack.pop()
      if (target && typeof target === 'object') target[name] = value
    } else if (action === 'Pop') stack.pop()
  }
  return variables
}

const cohort_of = (race) => {
  if (race === 'Archi-monstres') return 1
  if (race?.startsWith('Protecteurs des')) return 2
  return race === 'Boss' || race === 'Avis de recherche' ? 3 : 0
}
const excluded_races = new Set([
  'Invocations de classe',
  'Pnjs',
  'Monstres Tutorial',
  'Non classé',
  'Monstres de quête',
  'Monstres des conquêtes de territoires',
  'Gardes',
  'Dopeuls Temple',
  'Village des Dopeuls',
  'Familiers Fantômes',
  'Nowel',
  'Temporis',
  'Gladiatrool',
  "Sanctuaire de Qu'Tan",
  "Belvédère d'Ilyzaelle",
  'Halouines',
  'Ballotins',
])

const generate = () => {
  const cached = cached_monsters()
  const outputs = server_outputs()
  const directory = mkdtempSync(join(tmpdir(), 'aresrpg-retro-mobs-'))
  try {
    const swf = join(directory, 'monsters.swf')
    writeFileSync(swf, cached.bytes)
    const actions = execFileSync('swfdump', ['-a', swf], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    const { M: monsters, MR: races } = interpret_data_actions(actions)
    const grades = Object.entries(monsters)
      .flatMap(([monster_id, monster]) =>
        Object.entries(monster)
          .filter(([key, value]) => /^g\d+$/u.test(key) && value && typeof value === 'object')
          .map(([, grade]) => ({ grade, monster_id, monster_name: monster.n, race: races[monster.b]?.n }))
      )
      .filter(
        ({ grade, race }) =>
          grade.l >= 1 &&
          grade.l <= 255 &&
          grade.lp > 0 &&
          grade.ap >= 0 &&
          grade.mp >= 0 &&
          Array.isArray(grade.r) &&
          grade.r.length >= 5 &&
          !excluded_races.has(race)
      )
      .map(({ grade, monster_id, monster_name, race }) => {
        const [server_name, server_xp, server_damage] = outputs.get(`${monster_id}:${grade.l}`) ?? []
        const names_match = server_name === normalized_name(monster_name)
        const xp = names_match ? server_xp : -1
        const damage = names_match ? server_damage : -1
        return [
          grade.l,
          grade.lp,
          grade.ap,
          grade.mp,
          grade.r[5], // Retro vector: AP dodge, MP dodge, air, water, fire, earth, neutral.
          grade.r[4],
          grade.r[3],
          grade.r[2],
          cohort_of(race),
          xp,
          damage,
        ]
      })
      .sort((left, right) => {
        for (const index of [8, 0, 1, 2, 3, 4, 5, 6, 7, 9, 10])
          if (left[index] !== right[index]) return left[index] - right[index]
        return 0
      })
    const rows = grades.map((grade) => `  [${grade.join(', ')}],`).join('\n')
    writeFileSync(
      resolve(output),
      `// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable max-lines -- generated anonymous grade facts stay in one versioned provenance snapshot. */
// Generated from the official Dofus Retro bank 612 client cache: monsters_fr v${cached.version}.
// Anonymous grade tuple: [level, hp, ap, mp, earth%, fire%, water%, air%, cohort, xp, direct turn damage].
// Cohort: 0 regular · 1 archimonster · 2 resource protector · 3 declared boss/wanted.
// Server-owned XP and spell output use BotanAtomic/GDCore ${server_data_revision}, joined by id + level + name.
// Missing server rows remain -1 and are excluded from reference averages.
// Excludes client-only summons, NPCs, tutorial rows, unclassified rows, and levels outside 1..255.

export const DOFUS_MOB_GRADES = Object.freeze([
${rows}
] as const)

export type DofusMobGrade = (typeof DOFUS_MOB_GRADES)[number]
`
    )
    console.log(`wrote ${grades.length} anonymous grades to ${output}`)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

generate()
