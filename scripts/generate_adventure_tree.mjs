// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Retain the existing tree's trunk and branches; author a fuller crown in the same voxel format.
import { readFileSync, writeFileSync } from 'node:fs'

const types_path = new URL('../seed/structures/types.json', import.meta.url)
const recipe = JSON.parse(
  readFileSync(new URL('../seed/structures/adventure_ancient_tree.recipe.json', import.meta.url), 'utf8')
)
const original = readFileSync(types_path, 'utf8')
const catalog = JSON.parse(original)
const source = catalog.types[recipe.source]
const [width, height, depth] = source.size
const foliage = source.palette.indexOf('swamp_foliage')
const wood = source.palette.indexOf('swamp_wood')

const decode = (encoded) => {
  const bytes = Buffer.from(encoded, 'base64')
  return Array.from({ length: bytes.length / 5 }, (_, index) => {
    const offset = index * 5
    const start = bytes.readUInt16LE(offset)
    const count = bytes.readUInt16LE(offset + 2)
    const material = bytes[offset + 4]
    return Array.from({ length: count }, (_, index) => [start + index, material])
  }).flat()
}

const in_crown = (index) => {
  const x = index % width
  const z = Math.floor(index / width) % depth
  const y = Math.floor(index / (width * depth))
  const { center, radius, top, bottom, top_curve, bottom_curve, wave } = recipe.canopy
  const radial = ((x - center[0]) / radius[0]) ** 2 + ((z - center[1]) / radius[1]) ** 2
  const ripple = Math.sin(x * 0.43 + z * 0.17) * Math.cos(z * 0.37 - x * 0.13) * wave
  return radial < 1 && y >= bottom + radial * bottom_curve + ripple * 0.5 && y <= top - radial * top_curve + ripple
}

const encode = (voxels) => {
  const runs = []
  for (const [index, material] of [...voxels].sort(([left], [right]) => left - right)) {
    const previous = runs.at(-1)
    if (previous && previous.start + previous.count === index && previous.material === material) previous.count += 1
    else runs.push({ start: index, count: 1, material })
  }
  const bytes = Buffer.alloc(runs.length * 5)
  runs.forEach(({ start, count, material }, index) => {
    bytes.writeUInt16LE(start, index * 5)
    bytes.writeUInt16LE(count, index * 5 + 2)
    bytes[index * 5 + 4] = material
  })
  return bytes.toString('base64')
}

const crown = Array.from({ length: width * height * depth }, (_, index) => index)
  .filter(in_crown)
  .map((index) => [index, foliage])
const retained = decode(source.runs).filter(
  ([index, material]) =>
    material === wood || (material === foliage && Math.floor(index / (width * depth)) >= recipe.retain_foliage_from_y)
)
const branch_leaves = (index) => {
  const x = index % width
  const z = Math.floor(index / width) % depth
  const y = Math.floor(index / (width * depth))
  const { radius, height: vertical } = recipe.branch_canopy
  const span = radius * 2 + 1
  return Array.from({ length: span * span * (vertical * 2 + 1) }, (_, offset) => {
    const dx = (offset % span) - radius
    const dz = (Math.floor(offset / span) % span) - radius
    const dy = Math.floor(offset / (span * span)) - vertical
    return { x: x + dx, y: y + dy, z: z + dz, inside: dx * dx + dz * dz <= radius * radius }
  })
    .filter(
      (point) =>
        point.inside &&
        point.x >= 0 &&
        point.x < width &&
        point.y >= 0 &&
        point.y < height &&
        point.z >= 0 &&
        point.z < depth
    )
    .map((point) => [point.x + width * (point.z + depth * point.y), foliage])
}
const tips = retained
  .filter(
    ([index, material]) => material === wood && Math.floor(index / (width * depth)) >= recipe.branch_canopy.from_y
  )
  .flatMap(([index]) => branch_leaves(index))
const generated = { ...source, runs: encode(new Map([...crown, ...tips, ...retained])) }
if (process.argv.includes('--check')) {
  if (JSON.stringify(catalog.types[recipe.name]) !== JSON.stringify(generated))
    throw new Error('Adventure tree is stale; run bun scripts/generate_adventure_tree.mjs')
  console.log('Adventure tree matches its authored recipe.')
} else {
  const entry = `    "${recipe.name}": {\n      "size": ${JSON.stringify(generated.size)},\n      "anchor": ${JSON.stringify(generated.anchor)},\n      "palette": ${JSON.stringify(generated.palette)},\n      "runs": "${generated.runs}"\n    }`
  const existing = new RegExp(`    "${recipe.name}": \\{[\\s\\S]*?\\n    \\}`)
  const next = catalog.types[recipe.name]
    ? original.replace(existing, entry)
    : original.replace(/\n {2}}\n}\s*$/, `,\n${entry}\n  }\n}\n`)
  writeFileSync(types_path, next)
  console.log(`Generated ${recipe.name} from ${recipe.source}.`)
}
