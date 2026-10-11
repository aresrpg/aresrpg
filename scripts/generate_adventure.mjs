// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { validate_world_recipe } from '../packages/engine/src/world_recipe.ts'
import { CHUNK_EDGE } from '../packages/engine/src/voxel_data.ts'

import { build_adventure_scene } from './adventure_scene.ts'
import { encode_voxel_runs } from './encode_voxel_runs.mjs'
import { partition_blocks } from './partition_blocks.mjs'

const PREFIX = 'adventure_scene_'

/** Keep fixed-placement order and explicit air; partition only the source's local coordinates. */
export const pack_adventure_scene = (scene) => {
  const types = {}
  const fixed_structures = scene.world.fixed_structures.flatMap((placement) => {
    const { source, origin, rotation, scale } = placement
    if (typeof source === 'string') return [placement]
    if (rotation !== 0 || (scale ?? 1) !== 1 || source.anchor.some((value) => value !== 0))
      throw new TypeError('Adventure construction requires unrotated, unscaled, origin-anchored sources')
    if (source.blocks.some((block) => block.slice(0, 3).some((value, axis) => value < 0 || value >= source.size[axis])))
      throw new TypeError(`Adventure source ${source.name} has an out-of-bounds voxel`)
    return partition_blocks(source.blocks).map((cell) => {
      const name = `${PREFIX}${source.name.replace(/^adventure_/, '')}_${cell.origin.join('_')}`
      if (Object.hasOwn(types, name)) throw new TypeError(`Duplicate adventure structure ${name}`)
      const palette = [...new Set(cell.blocks.map((block) => block[3]))].toSorted()
      const ids = new Map(palette.map((material, index) => [material, index]))
      types[name] = {
        size: [CHUNK_EDGE, CHUNK_EDGE, CHUNK_EDGE],
        anchor: [0, 0, 0],
        palette,
        runs: encode_voxel_runs(
          cell.blocks.map(([x, y, z, material]) => [x + CHUNK_EDGE * (z + CHUNK_EDGE * y), ids.get(material)])
        ),
      }
      return { source: name, origin: origin.map((value, index) => value + cell.origin[index]), rotation: 0 }
    })
  })
  return { scene: { ...scene, world: { ...scene.world, fixed_structures } }, types }
}

const type_entry = ([name, source]) =>
  `    "${name}": {\n      "size": ${JSON.stringify(source.size)},\n      "anchor": ${JSON.stringify(source.anchor)},\n      "palette": ${JSON.stringify(source.palette)},\n      "runs": "${source.runs}"\n    }`

export const generate_adventure = (check = false) => {
  const raw = build_adventure_scene()
  const validation = validate_world_recipe(raw.world)
  if (!validation.ok) throw new Error(validation.errors.join('\n'))
  const { scene, types } = pack_adventure_scene(raw)
  const types_path = new URL('../seed/structures/types.json', import.meta.url)
  const scene_path = new URL('../seed/scenes/adventure.json', import.meta.url)
  const original = readFileSync(types_path, 'utf8')
  const catalog = JSON.parse(original)
  const existing = Object.fromEntries(Object.entries(catalog.types).filter(([name]) => name.startsWith(PREFIX)))
  const output = `${JSON.stringify(scene)}\n`
  if (check) {
    if (JSON.stringify(existing) !== JSON.stringify(types) || readFileSync(scene_path, 'utf8') !== output)
      throw new Error('Adventure scene is stale; run bun scripts/generate_adventure.mjs')
  } else {
    // Replace only this compiler's generated entries; preserve the authored catalogue byte-for-byte.
    const retained = original.replace(/,\n {4}"adventure_scene_[^"]+": \{[^{}]*\}/g, '')
    const next = retained.replace(/\n {2}}\n}\s*$/, `,\n${Object.entries(types).map(type_entry).join(',\n')}\n  }\n}\n`)
    const inserted = JSON.parse(next).types
    if (Object.entries(types).some(([name, source]) => JSON.stringify(inserted[name]) !== JSON.stringify(source)))
      throw new Error('Generated structures were not inserted into the catalogue')
    writeFileSync(types_path, next)
    writeFileSync(scene_path, output)
  }
  return { structures: Object.keys(types).length, scene_bytes: output.length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(generate_adventure(process.argv.includes('--check')))
