// Parse each worlds-study spec from its markdown and run the engine's validator on it.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { sample_biome_grid } from '../packages/engine/src/index.ts'
import { MAX_SURFACE_Y, validate_world_recipe } from '../packages/engine/src/world_recipe.ts'

type SourceWorld = Readonly<{
  world: string
  mobs?: Readonly<Record<string, number>> | readonly Readonly<{ mob_type: string }>[]
  resources?: readonly Readonly<{ item_type: string }>[]
}>

type Knot = {
  x: number
  y: number
  land?: { surface: string; subsurface: string; filler: string }
  variance?: number
}

const study_dir = fileURLToPath(new URL('../worlds-study', import.meta.url))
const worlds = JSON.parse(
  readFileSync(new URL('../seed/content/worlds.json', import.meta.url), 'utf8')
) as readonly SourceWorld[]
const slots = [
  'low_low',
  'low_mid',
  'low_high',
  'mid_low',
  'mid_mid',
  'mid_high',
  'high_low',
  'high_mid',
  'high_high',
] as const
const cell = (value: string): string => value.trim().replace(/\*\*/g, '').replace(/`/g, '')
let failures = 0
const fail = (world: string, message: string): void => {
  console.log(`  ✗ ${world}: ${message}`)
  failures += 1
}

for (const file of readdirSync(study_dir)
  .filter((name) => /^(0[1-9]|1\d|20)-/.test(name))
  .sort()) {
  const markdown = readFileSync(`${study_dir}/${file}`, 'utf8')
  const lines = markdown.split('\n')
  const world_number = file.slice(0, 2)
  const source = worlds.find(({ world }) => world.startsWith(world_number))
  if (!source) {
    fail(file, 'has no matching world in seed/content/worlds.json')
    continue
  }
  const { world } = source
  const sea_level = Number(markdown.match(/^> .*sea level (\d+)/m)?.[1])
  if (!Number.isFinite(sea_level)) {
    fail(world, 'has no sea level in its header')
    continue
  }

  const biome_slots: Record<string, string> = {}
  for (const temperature of ['low', 'mid', 'high']) {
    const row = lines.find((line) => line.startsWith(`| **temp ${temperature}**`))
    if (!row) {
      fail(world, `has no biome grid row for temperature ${temperature}`)
      continue
    }
    const columns = row.split('|').slice(2, 5).map(cell)
    for (const [index, humidity] of ['low', 'mid', 'high'].entries())
      biome_slots[`${temperature}_${humidity}`] = columns[index] ?? ''
  }

  const biomes: { name: string; landscape: Knot[] }[] = []
  const declared_slots = new Map<string, readonly string[]>()
  lines.forEach((line, index) => {
    const header = line.match(/^### \d+\. `([a-z_]+)` — (.+)$/)
    if (!header) return
    const name = header[1]!
    declared_slots.set(
      name,
      [...header[2]!.matchAll(/(low|mid|high)_(low|mid|high)/g)].map(([slot]) => slot)
    )
    const landscape: Knot[] = []
    for (let line_index = index + 1; line_index < lines.length; line_index += 1) {
      const candidate = lines[line_index]!
      if (/^#{2,3} /.test(candidate)) break
      if (!candidate.startsWith('|')) continue
      const cells = candidate.split('|').slice(1, -1).map(cell)
      if (cells.length !== 4 || !/^[\d.]+$/.test(cells[0]!) || !/^\d+$/.test(cells[1]!)) continue
      const knot: Knot = { x: Number(cells[0]), y: Number(cells[1]) }
      if (cells[2]) {
        const materials = cells[2].split('/').map((material) => material.trim())
        if (materials.length !== 3) fail(world, `${name} has an invalid land row: "${cells[2]}"`)
        knot.land = { surface: materials[0]!, subsurface: materials[1]!, filler: materials[2]! }
      }
      if (cells[3]) knot.variance = Number(cells[3])
      landscape.push(knot)
    }
    if (landscape.length < 2) fail(world, `${name} has only ${landscape.length} parsed knots`)
    biomes.push({ name, landscape })
  })

  const materials: Record<string, { color: string; preset: string }> = {}
  for (const line of lines) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map(cell)
    if (cells.length !== 4) continue
    const names = cells[0]!.split('/').map((name) => name.trim())
    const colors = cells[1]!.split('/').map((color) => color.trim())
    const presets = cells[2]!.split('/').map((preset) => preset.trim())
    if (!colors.every((color) => /^#[0-9a-f]{6}$/i.test(color))) continue
    if (names.length !== colors.length || names.length !== presets.length) {
      fail(world, `has an invalid material row: ${line}`)
      continue
    }
    names.forEach((name, index) => {
      materials[name] = { color: colors[index]!, preset: presets[index]! }
    })
  }

  const mob_rows = [
    ...markdown.matchAll(/\{ "mob_type": "([a-z_0-9]+)",\s*"weight_bp": (\d+),\s*"biomes": \[([^\]]*)\] \}/g),
  ].map((match) => ({
    mob_type: match[1]!,
    biomes: match[3]!
      .split(',')
      .map((name) => name.trim().replace(/"/g, ''))
      .filter(Boolean),
  }))
  const resource_rows = [...markdown.matchAll(/\{ "item_type": "([a-z_0-9]+)",[^}]*"biomes": \[([^\]]*)\] \}/g)].map(
    (match) => ({
      item_type: match[1]!,
      biomes: match[2]!
        .split(',')
        .map((name) => name.trim().replace(/"/g, ''))
        .filter(Boolean),
    })
  )
  const roster = Array.isArray(source.mobs)
    ? source.mobs.map(({ mob_type }) => mob_type)
    : Object.keys(source.mobs ?? {})
  const spec_mobs = new Set(mob_rows.map(({ mob_type }) => mob_type))
  for (const mob_type of roster) if (!spec_mobs.has(mob_type)) fail(world, `roster mob ${mob_type} has no biome`)
  for (const mob_type of spec_mobs) if (!roster.includes(mob_type)) fail(world, `invents mob ${mob_type}`)
  const real_resources = (source.resources ?? []).map(({ item_type }) => item_type)
  const spec_resources = new Set(resource_rows.map(({ item_type }) => item_type))
  for (const item_type of real_resources)
    if (!spec_resources.has(item_type)) fail(world, `resource ${item_type} has no biome`)
  for (const item_type of spec_resources)
    if (!real_resources.includes(item_type)) fail(world, `invents resource ${item_type}`)

  const biome_names = new Set(biomes.map(({ name }) => name))
  for (const slot of slots) {
    const name = biome_slots[slot]
    if (!name) fail(world, `biome slot ${slot} is empty`)
    else if (!biome_names.has(name)) fail(world, `biome slot ${slot} names unknown biome "${name}"`)
  }
  for (const [name, claims] of declared_slots)
    for (const slot of claims)
      if (biome_slots[slot] !== name) fail(world, `${name} claims ${slot}, but the grid names "${biome_slots[slot]}"`)
  for (const { name } of biomes)
    if (!slots.some((slot) => biome_slots[slot] === name)) fail(world, `${name} holds no biome slot`)
  for (const row of [...mob_rows, ...resource_rows])
    for (const name of row.biomes)
      if (!biome_names.has(name))
        fail(world, `${'mob_type' in row ? row.mob_type : row.item_type} names unknown biome "${name}"`)

  const roof = Math.max(...biomes.flatMap(({ landscape }) => landscape.map(({ y }) => y)))
  if (roof !== MAX_SURFACE_Y) fail(world, `roof ${roof} does not use the full height ${MAX_SURFACE_Y}`)
  const terrain = {
    seed: `ares-${world}`,
    sea_level,
    liquid: 'water',
    materials,
    biomes,
    biome_slots,
  }
  const result = validate_world_recipe(terrain)
  if (!result.ok) for (const error of result.errors) fail(world, `recipe: ${error}`)
  else {
    const grid = sample_biome_grid(terrain, { world_size: 100_000, world_center: 50_000, cell_size: 512 })
    const tally = new Map<number, number>()
    for (const id of grid.cells) tally.set(id, (tally.get(id) ?? 0) + 1)
    const spread = [...tally]
      .sort((left, right) => right[1] - left[1])
      .map(([id, count]) => `${biomes[id]!.name} ${((count / grid.cells.length) * 100).toFixed(0)}%`)
      .join(' · ')
    console.log(`  ✓ ${world.padEnd(22)} ${biomes.length} biomes · roof ${roof} · ${spread}`)
  }
}

console.log(failures === 0 ? '\nALL SPECS VALID' : `\n${failures} FAILURES`)
if (failures > 0) process.exitCode = 1
