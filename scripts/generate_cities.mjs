// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { format, resolveConfig } from 'prettier'

import { compile_world_recipe, parse_world_recipe, WORLD_HEIGHT } from '../packages/engine/src/world_recipe.ts'
import { map_the_ruins, plan_the_ruins, terrain_the_ruins } from '../packages/engine/src/cities/the_ruins/generate.ts'
import { map_fuwage, plan_fuwage, terrain_fuwage } from '../packages/engine/src/cities/fuwage/generate.ts'
import { map_thebes, plan_thebes, terrain_thebes } from '../packages/engine/src/cities/thebes/generate.ts'
import { world_terrain } from '../packages/engine/src/world_catalog.ts'

const ROOT = resolve(import.meta.dir, '..')
const CHUNK_EDGE = 32
const GENERATORS = Object.freeze([
  Object.freeze({ id: 'thebes', world: 'nauvis', plan: plan_thebes, map: map_thebes, terrain: terrain_thebes }),
  Object.freeze({
    id: 'the_ruins',
    world: 'nauvis',
    plan: plan_the_ruins,
    map: map_the_ruins,
    terrain: terrain_the_ruins,
  }),
  Object.freeze({ id: 'fuwage', world: 'nauvis', plan: plan_fuwage, map: map_fuwage, terrain: terrain_fuwage }),
])

const source_paths = async (id) => {
  const city_sources = [...new Bun.Glob(`packages/engine/src/cities/${id}/**/*.ts`).scanSync({ cwd: ROOT })]
  return [
    'scripts/generate_cities.mjs',
    'seed/content/worlds.json',
    'packages/engine/src/bounded_memo.ts',
    'packages/engine/src/cities/city_structure.ts',
    'packages/engine/src/cities/city_terrain.ts',
    'packages/engine/src/cities/registry.ts',
    'packages/engine/src/cities/types.ts',
    'packages/engine/src/cities/tiled_wfc.ts',
    'packages/engine/src/world_recipe.ts',
    'packages/engine/src/world_noise.ts',
    'packages/engine/src/world_materials.ts',
    'packages/engine/src/world_catalog.ts',
    ...city_sources,
  ].toSorted()
}

const source_hash = async (id) => {
  const hash = createHash('sha256')
  for (const path of await source_paths(id)) {
    hash.update(path)
    hash.update(await readFile(resolve(ROOT, path)))
  }
  return hash.digest('hex')
}

const chunk_coordinate = (value) => Math.floor(value / CHUNK_EDGE)
const chunk_key = (x, y, z) => `${x}:${y}:${z}`

const city_voxel_chunks = (world, drafts) => {
  const chunks = new Map()
  for (const draft of [...drafts].sort((left, right) => left.id.localeCompare(right.id))) {
    const [anchor_x, anchor_y, anchor_z] = draft.type.anchor
    if (draft.rotation !== 0 || draft.y === undefined)
      throw new TypeError(`Generated city placement ${draft.id} is not an absolute unrotated structure`)
    draft.type.packed_voxels.forEach((packed) => {
      const x = draft.x + (packed & 0xff) - anchor_x
      const z = draft.z + ((packed >>> 8) & 0xff) - anchor_z
      const y = draft.y + ((packed >>> 16) & 0xff) - anchor_y
      if (y < 0 || y >= WORLD_HEIGHT) return
      const material_id = packed >>> 24
      const material = material_id === 0 ? 'air' : world.materials.entries[material_id]?.name
      if (!material) throw new TypeError(`Generated city placement ${draft.id} uses an unknown material`)
      const chunk_x = chunk_coordinate(x)
      const chunk_y = chunk_coordinate(y)
      const chunk_z = chunk_coordinate(z)
      const key = chunk_key(chunk_x, chunk_y, chunk_z)
      let chunk = chunks.get(key)
      if (!chunk) {
        chunk = { x: chunk_x, y: chunk_y, z: chunk_z, voxels: new Map() }
        chunks.set(key, chunk)
      }
      const local_x = x - chunk_x * CHUNK_EDGE
      const local_y = y - chunk_y * CHUNK_EDGE
      const local_z = z - chunk_z * CHUNK_EDGE
      chunk.voxels.set(local_x + local_z * CHUNK_EDGE + local_y * CHUNK_EDGE * CHUNK_EDGE, material)
    })
  }
  return [...chunks.values()].sort((left, right) => left.y - right.y || left.z - right.z || left.x - right.x)
}

const encoded_runs = (voxels, palette) => {
  const material_index = new Map(palette.map((material, index) => [material, index]))
  const entries = [...voxels].sort(([left], [right]) => left - right)
  const runs = []
  for (const [linear, material] of entries) {
    const palette_index = material_index.get(material)
    const previous = runs.at(-1)
    if (previous && previous.start + previous.count === linear && previous.material === palette_index)
      previous.count += 1
    else runs.push({ start: linear, count: 1, material: palette_index })
  }
  const bytes = new Uint8Array(runs.length * 5)
  const view = new DataView(bytes.buffer)
  runs.forEach(({ start, count, material }, index) => {
    view.setUint16(index * 5, start, true)
    view.setUint16(index * 5 + 2, count, true)
    view.setUint8(index * 5 + 4, material)
  })
  return Buffer.from(bytes).toString('base64')
}

const serialized_chunk = ({ x, y, z, voxels }) => {
  const palette = [...new Set(voxels.values())].toSorted()
  return Object.freeze({ x, y, z, palette, runs: encoded_runs(voxels, palette), voxels: voxels.size })
}

const generate_city = async (generator) => {
  const terrain = world_terrain(generator.world)
  if (!terrain) throw new TypeError(`${generator.world} terrain is missing`)
  const world = compile_world_recipe(parse_world_recipe(terrain), { city_terrain: false })
  const city = world.structures.cities.find(({ id }) => id === generator.id)
  if (!city) throw new TypeError(`${generator.id} city area is missing`)
  const drafts = generator.plan(world, city)
  const chunks = city_voxel_chunks(world, drafts).map(serialized_chunk)
  return Object.freeze({
    version: 2,
    id: city.id,
    source_hash: await source_hash(city.id),
    area: city.area,
    chunks,
    map: generator.map(world, city),
    terrain: generator.terrain(world, city),
    placements: drafts.length,
    voxels: chunks.reduce((total, chunk) => total + chunk.voxels, 0),
  })
}

const json_output = async (value, filepath) =>
  format(JSON.stringify(value), { ...(await resolveConfig(filepath)), filepath, parser: 'json' })

const generated = await Promise.all(GENERATORS.map(generate_city))
const outputs = await Promise.all(
  generated.map(async (city) => {
    const output_path = resolve(ROOT, `packages/engine/src/cities/generated/${city.id}.json`)
    const map_path = resolve(ROOT, `packages/engine/src/cities/generated/${city.id}_map.json`)
    return Object.freeze({
      output_path,
      map_path,
      output: await json_output({ ...city, map: undefined }, output_path),
      map_output: await json_output(
        {
          version: city.version,
          id: city.id,
          source_hash: city.source_hash,
          area: city.area,
          map: city.map,
          terrain: city.terrain,
        },
        map_path
      ),
    })
  })
)
if (process.argv.includes('--check')) {
  const stale = (
    await Promise.all(
      outputs.map(async ({ output_path, map_path, output, map_output }) => {
        const current = await readFile(output_path, 'utf8').catch(() => '')
        const current_map = await readFile(map_path, 'utf8').catch(() => '')
        return current === output && current_map === map_output ? [] : [output_path]
      })
    )
  ).flat()
  if (stale.length > 0) throw new Error(`Generated city artifacts are stale: ${stale.join(', ')}`)
} else {
  await Promise.all(
    outputs.flatMap(({ output_path, map_path, output, map_output }) => [
      mkdir(dirname(output_path), { recursive: true }).then(() => writeFile(output_path, output)),
      mkdir(dirname(map_path), { recursive: true }).then(() => writeFile(map_path, map_output)),
    ])
  )
}
