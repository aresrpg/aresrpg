// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

type NbtValue = number | bigint | string | Uint8Array | readonly NbtValue[] | Readonly<Record<string, NbtValue>>
type StructureType = Readonly<{
  size: readonly [number, number, number]
  anchor: readonly [number, number, number]
  palette: readonly string[]
  runs: string
}>

const as_record = (value: NbtValue | undefined): Readonly<Record<string, NbtValue>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array)
    throw new TypeError('expected an NBT compound')
  return value
}

const parse_nbt = (bytes: Uint8Array): Readonly<Record<string, NbtValue>> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0
  const u8 = (): number => view.getUint8(offset++)
  const i8 = (): number => view.getInt8(offset++)
  const i16 = (): number => {
    const value = view.getInt16(offset)
    offset += 2
    return value
  }
  const u16 = (): number => {
    const value = view.getUint16(offset)
    offset += 2
    return value
  }
  const i32 = (): number => {
    const value = view.getInt32(offset)
    offset += 4
    return value
  }
  const i64 = (): bigint => {
    const value = view.getBigInt64(offset)
    offset += 8
    return value
  }
  const text = (): string => {
    const length = u16()
    const value = new TextDecoder().decode(bytes.subarray(offset, offset + length))
    offset += length
    return value
  }
  const payload = (type: number): NbtValue => {
    if (type === 1) return i8()
    if (type === 2) return i16()
    if (type === 3) return i32()
    if (type === 4) return i64()
    if (type === 5) {
      const value = view.getFloat32(offset)
      offset += 4
      return value
    }
    if (type === 6) {
      const value = view.getFloat64(offset)
      offset += 8
      return value
    }
    if (type === 7) {
      const length = i32()
      const value = bytes.slice(offset, offset + length)
      offset += length
      return value
    }
    if (type === 8) return text()
    if (type === 9) {
      const child_type = u8()
      const length = i32()
      return Array.from({ length }, () => payload(child_type))
    }
    if (type === 10) {
      const result: Record<string, NbtValue> = {}
      for (let child_type = u8(); child_type !== 0; child_type = u8()) result[text()] = payload(child_type)
      return result
    }
    if (type === 11) {
      const length = i32()
      return Array.from({ length }, i32)
    }
    if (type === 12) {
      const length = i32()
      return Array.from({ length }, i64)
    }
    throw new TypeError(`unsupported NBT tag ${type}`)
  }
  const root_type = u8()
  if (root_type !== 10) throw new TypeError(`schematic root must be a compound, received ${root_type}`)
  text()
  return as_record(payload(root_type))
}

const decode_varints = (bytes: Uint8Array): readonly number[] => {
  const values: number[] = []
  let value = 0
  let shift = 0
  bytes.forEach((byte) => {
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) {
      values.push(value >>> 0)
      value = 0
      shift = 0
      return
    }
    shift += 7
    if (shift > 28) throw new TypeError('schematic palette varint exceeds 32 bits')
  })
  if (shift !== 0) throw new TypeError('schematic palette ends with an incomplete varint')
  return values
}

const biome_of = (name: string): string => name.split('_')[0]!.toLowerCase()
const rock_for = (biome: string): string => {
  if (biome === 'scorched') return 'scorched_stone'
  if (biome === 'desert') return 'limestone'
  return 'stone'
}
const includes_any = (value: string, fragments: readonly string[]): boolean =>
  fragments.some((fragment) => value.includes(fragment))
const AIR_BLOCKS = new Set(['air', 'cave_air', 'void_air', 'water'])

const structure_material = (type_name: string, raw_name: string): string => {
  const biome = biome_of(type_name)
  const name = raw_name.replace(/^minecraft:/, '').replace(/\[.*$/, '')
  if (AIR_BLOCKS.has(name)) return 'air'
  if (includes_any(name, ['leaves', 'vine'])) return `${biome}_foliage`
  if (includes_any(name, ['log', 'wood', 'stem', 'hyphae', 'planks', 'fence'])) return `${biome}_wood`
  if (name.includes('cactus')) return 'cactus'
  if (name.includes('coral')) return 'coral'
  if (name.includes('wool') && type_name.includes('corail')) return 'coral'
  if (name.includes('wool')) return rock_for(biome)
  if (name.includes('snow')) return 'snow'
  if (name.includes('ice')) return 'ice'
  if (includes_any(name, ['magma', 'lava', 'obsidian'])) return 'blackstone'
  if (name.includes('red_sand')) return 'red_sand'
  if (includes_any(name, ['terracotta', 'concrete'])) return 'red_sand'
  if (name.includes('sandstone')) return biome === 'scorched' ? 'red_sand' : 'limestone'
  if (name.includes('sand')) return biome === 'scorched' ? 'red_sand' : 'sand'
  if (includes_any(name, ['mud', 'podzol'])) return 'rich_soil'
  if (name.includes('gravel')) return 'gravel'
  if (name.includes('dirt')) return 'dirt'
  if (includes_any(name, ['grass', 'moss'])) return 'moss'
  if (
    includes_any(name, [
      'stone',
      'cobble',
      'granite',
      'diorite',
      'andesite',
      'basalt',
      'deepslate',
      'bedrock',
      'ore',
      'brick',
    ])
  )
    return rock_for(biome)
  throw new TypeError(`${type_name} uses unmapped Minecraft block ${raw_name}`)
}

const encode_runs = (materials: readonly string[]): Readonly<{ palette: readonly string[]; runs: string }> => {
  const palette = ['air', ...materials.filter((name, index) => name !== 'air' && materials.indexOf(name) === index)]
  const ids = materials.map((name) => palette.indexOf(name))
  const runs: number[] = []
  let index = 0
  while (index < ids.length) {
    if (ids[index] === 0) {
      index += 1
      continue
    }
    const start = index
    const id = ids[index]!
    while (index < ids.length && ids[index] === id) index += 1
    runs.push(start, index - start, id)
  }
  const bytes = new Uint8Array((runs.length / 3) * 5)
  const view = new DataView(bytes.buffer)
  for (let run = 0; run < runs.length; run += 3) {
    const offset = (run / 3) * 5
    if (runs[run]! > 0xffff || runs[run + 1]! > 0xffff || runs[run + 2]! > 0xff)
      throw new TypeError('structure run exceeds the compact JSON encoding')
    view.setUint16(offset, runs[run]!, true)
    view.setUint16(offset + 2, runs[run + 1]!, true)
    view.setUint8(offset + 4, runs[run + 2]!)
  }
  return { palette, runs: Buffer.from(bytes).toString('base64') }
}

const schematic_type = async (path: string): Promise<readonly [string, StructureType]> => {
  const type_name = basename(path, extname(path)).toLowerCase()
  const root = parse_nbt(gunzipSync(await readFile(path)))
  const width = Number(root.Width)
  const height = Number(root.Height)
  const length = Number(root.Length)
  const palette_record = as_record(root.Palette)
  const palette_by_id = Object.entries(palette_record).reduce<Record<number, string>>((result, [name, id]) => {
    result[Number(id)] = structure_material(type_name, name)
    return result
  }, {})
  if (!(root.BlockData instanceof Uint8Array)) throw new TypeError(`${type_name} has no byte-array BlockData`)
  const block_ids = decode_varints(root.BlockData)
  if (block_ids.length !== width * height * length)
    throw new TypeError(`${type_name} has ${block_ids.length} blocks for ${width}×${height}×${length}`)
  const encoded = encode_runs(block_ids.map((id) => palette_by_id[id] ?? 'air'))
  return [
    type_name,
    Object.freeze({
      size: Object.freeze([width, height, length] as const),
      anchor: Object.freeze([Math.floor(width / 2), 0, Math.floor(length / 2)] as const),
      palette: Object.freeze(encoded.palette),
      runs: encoded.runs,
    }),
  ]
}

const generated_type = (
  size: readonly [number, number, number],
  material_at: (x: number, y: number, z: number) => string
): StructureType => {
  const materials = Array.from({ length: size[0] * size[1] * size[2] }, (_, index) => {
    const x = index % size[0]
    const z = Math.floor(index / size[0]) % size[2]
    const y = Math.floor(index / (size[0] * size[2]))
    return material_at(x, y, z)
  })
  const encoded = encode_runs(materials)
  return {
    size,
    anchor: [Math.floor(size[0] / 2), 0, Math.floor(size[2] / 2)],
    palette: encoded.palette,
    runs: encoded.runs,
  }
}

const disc_contains = (x: number, z: number, center_x: number, center_z: number, radius: number): boolean =>
  (x - center_x) ** 2 + (z - center_z) ** 2 <= radius ** 2
const all = (...conditions: readonly boolean[]): boolean => conditions.every(Boolean)
const any = (...conditions: readonly boolean[]): boolean => conditions.some(Boolean)

const horn_contains = (
  x: number,
  y: number,
  z: number,
  base_x: number,
  base_z: number,
  bend_x: number,
  bend_z: number,
  height: number,
  base_radius: number
): boolean => {
  if (y >= height) return false
  const amount = y / height
  const curve = amount * amount
  const center_x = base_x + bend_x * curve
  const center_z = base_z + bend_z * curve
  const radius = Math.max(1, base_radius * (1 - amount) + 0.75)
  return disc_contains(x, z, center_x, center_z, radius)
}

const generated_landmarks = (): Readonly<Record<string, StructureType>> => ({
  nauvis_plains_pandora_gate: generated_type([51, 54, 23], (x, y, z) => {
    const tier = Math.floor(y / 11)
    const pylon_width = Math.max(3, 7 - tier)
    const left = all(y < 47, Math.abs(x - (9 + tier)) <= pylon_width, Math.abs(z - 11) <= pylon_width)
    const right = all(y < 47, Math.abs(x - (41 - tier)) <= pylon_width, Math.abs(z - 11) <= pylon_width)
    const lintel = all(y >= 43, y <= 50, x >= 10, x <= 40, Math.abs(z - 11) <= 6)
    const crown = all(y >= 50, y <= 53, Math.abs(x - 25) <= 8, Math.abs(z - 11) <= 4)
    const terrace = all(y < 4, x >= 1 + y * 2, x <= 49 - y * 2, z >= 3 + y, z <= 19 - y)
    const breach = all(lintel, x >= 27, x <= 32, y >= 47)
    if (breach || !any(left, right, lintel, crown, terrace)) return 'air'
    return (x * 7 + y * 3 + z * 11) % 29 < 4 ? 'stone' : 'limestone'
  }),
  nauvis_plains_ruined_skywatch: generated_type([55, 48, 23], (x, y, z) => {
    const legs = [
      [6, 5, 1, 1],
      [48, 5, -1, 1],
      [6, 18, 1, -1],
      [48, 18, -1, -1],
    ].some(([base_x, base_z, lean_x, lean_z]) => {
      const amount = Math.min(1, y / 30)
      return all(y < 31, disc_contains(x, z, base_x + lean_x * amount * 9, base_z + lean_z * amount * 4, 2.5))
    })
    const platform = all(y >= 28, y <= 31, x >= 10, x <= 44, z >= 3, z <= 19)
    const tower = all(y >= 31, y < 45, Math.abs(x - 27) <= 4, Math.abs(z - 11) <= 4)
    const arms = all(y >= 39, y <= 42, x >= 15, x <= 47, Math.abs(z - 11) <= 2)
    const footings = all(y < 5, any(disc_contains(x, z, 6, 5, 4), disc_contains(x, z, 48, 18, 4)))
    if (!any(legs, platform, tower, arms, footings)) return 'air'
    return footings ? 'stone' : (x + y * 5 + z * 3) % 23 < 3 ? 'moss' : 'grassland_wood'
  }),
  nauvis_forest_fallen_titan: generated_type([61, 32, 31], (x, y, z) => {
    const distance = Math.hypot(y - 14, z - 15)
    const broken_end = 52 + ((y * 7 + z * 11) % 9)
    const doorway = all(x < 13, z >= 11, z <= 19, y >= 8, y <= 18)
    const trunk = all(x >= 4, x <= broken_end, Math.abs(distance - 10) <= 2.3, !doorway)
    const heartwood = all(x >= 53, x <= broken_end, distance <= 10, (y + z) % 5 < 2)
    const branch = all(x >= 18, x <= 38, Math.abs(y - (18 + (x - 18) * 0.45)) <= 2, z >= 22, z <= 27)
    const roots = all(x < 10, y < 7, any(z < 7, z > 23, (x + z) % 7 < 2))
    if (!any(trunk, heartwood, branch, roots)) return 'air'
    return (x * 3 + y + z * 5) % 19 < 3 ? 'moss' : 'temperate_wood'
  }),
  nauvis_forest_hollow_colossus: generated_type([31, 64, 31], (x, y, z) => {
    const dx = x - 15
    const dz = z - 15
    const distance = Math.hypot(dx, dz)
    const radius = 11.5 - y * 0.035
    const crown = 48 + ((x * 7 + z * 11) % 15)
    const doorway = all(z <= 7, Math.abs(dx) <= 3, y < 14)
    const shell = all(y <= crown, Math.abs(distance - radius) <= 2.3, !doorway)
    const roots = all(
      y < 5,
      [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2].some((angle) => {
        const along = dx * Math.cos(angle) + dz * Math.sin(angle)
        const across = Math.abs(dx * Math.sin(angle) - dz * Math.cos(angle))
        return all(along > 7, along < 15, across < 2.5)
      })
    )
    if (!shell && !roots) return 'air'
    return (x * 3 + y + z * 5) % 23 < 3 ? 'moss' : 'temperate_wood'
  }),
  nauvis_rainforest_canopy_temple: generated_type([51, 52, 23], (x, y, z) => {
    const stilts = [7, 17].some((stilt_z) =>
      [8, 25, 42].some((stilt_x) => all(y < 25, disc_contains(x, z, stilt_x, stilt_z, 2.5)))
    )
    const platform = all(y >= 22, y <= 25, x >= 4, x <= 46, z >= 2, z <= 20)
    const shrine = all(y >= 25, y <= 38, x >= 17, x <= 34, z >= 6, z <= 17)
    const doorway = all(shrine, z <= 7, x >= 23, x <= 28, y <= 34)
    const roof_width = Math.max(0, 14 - (y - 38) * 1.2)
    const roof = all(y >= 38, y <= 50, Math.abs(x - 25) <= roof_width, Math.abs(z - 11) <= roof_width * 0.55)
    const hanging = all(y < 38, y >= 8, any(x === 4, x === 46, z === 2, z === 20), (x * 7 + z * 13) % 5 === 0)
    if (doorway || !any(stilts, platform, shrine, roof, hanging)) return 'air'
    if (shrine) return (x + y + z) % 11 < 2 ? 'moss' : 'stone'
    return (x * 3 + y + z * 5) % 17 < 3 ? 'moss' : 'tropical_wood'
  }),
  nauvis_rainforest_root_bridge: generated_type([55, 48, 23], (x, y, z) => {
    const amount = Math.abs(x - 27) / 27
    const arch_y = 8 + 35 * (1 - amount * amount)
    const bridge = all(Math.abs(y - arch_y) <= 3.2, Math.abs(z - 11) <= 4)
    const hanging = all(y < arch_y, y > arch_y - 15, (x * 7 + z * 13) % 17 < 2)
    const feet = all(y < 12, any(x < 8, x > 46), Math.abs(z - 11) < 7)
    if (!any(bridge, hanging, feet)) return 'air'
    return (x + y * 3 + z) % 13 < 3 ? 'moss' : 'tropical_wood'
  }),
  nauvis_highland_shattered_peak: generated_type([41, 68, 23], (x, y, z) => {
    const spires = [
      [8, 6, 66, 7],
      [21, 12, 49, 9],
      [34, 17, 59, 7],
    ].some(([center_x, center_z, height, base_radius]) => {
      const radius = Math.max(1.5, base_radius * (1 - y / height))
      return all(y < height, disc_contains(x, z, center_x, center_z, radius))
    })
    const scree = all(y < 5, (x * 17 + z * 5) % 23 < 4)
    if (!any(spires, scree)) return 'air'
    return any(y < 11, y % 19 === 10) ? 'deep_stone' : 'stone'
  }),
  nauvis_highland_cairn_gate: generated_type([47, 54, 25], (x, y, z) => {
    const left_width = 6 - Math.floor(y / 14)
    const right_width = 7 - Math.floor(y / 12)
    const left = all(y < 48, Math.abs(x - (8 + Math.floor(y / 15))) <= left_width, Math.abs(z - 12) <= left_width)
    const right = all(y < 52, Math.abs(x - (38 - Math.floor(y / 17))) <= right_width, Math.abs(z - 12) <= right_width)
    const lintel = all(y >= 43, y <= 49, x >= 10, x <= 38, Math.abs(z - 12) <= 5)
    const broken_gap = all(lintel, x > 25, x < 31, y > 46)
    const terrace = all(y < 4, x >= 2 + y * 2, x <= 44 - y * 2, z >= 4 + y, z <= 20 - y)
    if (!any(left, right, lintel, terrace) || broken_gap) return 'air'
    return (x * 5 + y * 11 + z) % 31 < 5 ? 'deep_stone' : 'stone'
  }),
  nauvis_desert_colossus_ribs: generated_type([55, 42, 27], (x, y, z) => {
    const ribs = [3, 8, 13, 18, 23].some((rib_z, index) => {
      const half_span = 24 - index
      const height = 40 - index * 2
      const bend = half_span * 0.78
      return any(
        horn_contains(x, y, z, 27 - half_span, rib_z, bend, 0, height, 2.8),
        horn_contains(x, y, z, 27 + half_span, rib_z, -bend, 0, height - 2, 2.8)
      )
    })
    const buried = all(y < 4, (x * 7 + z * 3) % 19 < 3)
    if (!any(ribs, buried)) return 'air'
    return any(buried, y % 14 === 6) ? 'red_sand' : 'limestone'
  }),
  nauvis_desert_buried_skull: generated_type([43, 52, 27], (x, y, z) => {
    const dx = (x - 21) / 19
    const dy = (y - 23) / 25
    const dz = (z - 14) / 12
    const radius = dx * dx + dy * dy + dz * dz
    const eye = all(z < 8, y >= 23, y <= 34, any(Math.abs(x - 13) < 5, Math.abs(x - 29) < 5))
    const maw = all(z < 7, y >= 8, y <= 20, Math.abs(x - 21) < 9)
    const shell = all(radius >= 0.68, radius <= 1, !eye, !maw)
    const jaw = all(y >= 5, y <= 11, z <= 13, Math.abs(x - 21) <= 14, (x + y) % 4 !== 0)
    const dune = all(y < 4, radius <= 1.35, (x * 3 + z * 7) % 9 < 5)
    if (!any(shell, jaw, dune)) return 'air'
    return any(dune, (x + y + z) % 23 < 3) ? 'red_sand' : 'limestone'
  }),
})

const generated_ruins = (): Readonly<Record<string, StructureType>> => ({
  temperate_ruined_arch: generated_type([9, 8, 5], (x, y, z) => {
    const pillar = (x === 1 || x === 7) && z === 2 && y < (x === 1 ? 7 : 5)
    const lintel = z === 2 && y === 6 && x > 0 && x < 5
    const rubble = y === 0 && ((x * 5 + z * 3) % 11 === 0 || (x === 6 && z === 3))
    return pillar || lintel || rubble ? 'stone' : 'air'
  }),
  desert_broken_columns: generated_type([11, 7, 9], (x, y, z) => {
    const base = y === 0 && x > 1 && x < 9 && z > 1 && z < 7
    const column = ((x === 2 && z === 2) || (x === 8 && z === 6) || (x === 2 && z === 6)) && y < 5
    const broken = x === 8 && z === 2 && y < 3
    return base || column || broken ? 'limestone' : 'air'
  }),
  scorched_altar: generated_type([9, 5, 9], (x, y, z) => {
    const dx = x - 4
    const dz = z - 4
    const ring = y === 0 && Math.abs(dx * dx + dz * dz - 12) < 5
    const altar = Math.abs(dx) <= 1 && Math.abs(dz) <= 1 && y < 3
    return ring || altar ? (y === 2 ? 'scorched_stone' : 'blackstone') : 'air'
  }),
  swamp_broken_wall: generated_type([12, 6, 4], (x, y, z) => {
    const wall_height = 2 + ((x * 7) % 5)
    const wall = z === 2 && y < wall_height && x !== 5
    const moss = wall && y === wall_height - 1 && x % 3 === 0
    return moss ? 'moss' : wall ? 'stone' : 'air'
  }),
})

const RETIRED_GENERATED_STRUCTURES = new Set([
  'nauvis_plains_titan_fangs',
  'nauvis_plains_rib_gate',
  'nauvis_forest_root_gate',
  'nauvis_rainforest_tangled_tusks',
  'nauvis_highland_stone_horns',
])

const main = async (): Promise<void> => {
  const input = resolve(process.argv[2] ?? '')
  const output = resolve(process.argv[3] ?? '')
  if (!process.argv[2] || !process.argv[3])
    throw new TypeError('usage: bun scripts/import_schematics.ts <terrain-assets-dir> <types.json>')
  const generated = Object.freeze({ ...generated_ruins(), ...generated_landmarks() })
  if (process.argv[2] === '--generated-only') {
    const current = JSON.parse(await readFile(output, 'utf8')) as Readonly<{
      version: number
      types: Readonly<Record<string, StructureType>>
    }>
    const retained = Object.entries(current.types).filter(([name]) => !RETIRED_GENERATED_STRUCTURES.has(name))
    const types = Object.fromEntries([...retained, ...Object.entries(generated)].toSorted())
    await writeFile(output, `${JSON.stringify({ version: current.version, types }, null, 2)}\n`)
    console.log(`Wrote ${Object.keys(generated).length} generated structures into ${output}`)
    return
  }
  const categories = ['trees', 'rocks'] as const
  const paths = (
    await Promise.all(
      categories.map(async (category) =>
        (await readdir(join(input, category)))
          .filter((file) => extname(file) === '.schem')
          .map((file) => join(input, category, file))
      )
    )
  ).flat()
  const imported = await Promise.all(paths.map(schematic_type))
  const types = Object.fromEntries([...imported, ...Object.entries(generated)].sort(([a], [b]) => a.localeCompare(b)))
  await writeFile(output, `${JSON.stringify({ version: 1, types }, null, 2)}\n`)
  console.log(
    `Imported ${imported.length} schematics and ${Object.keys(generated).length} generated structures into ${output}`
  )
  console.log(`Source: aresrpg/aresrpg-dapp at archived master 07f8c7b`)
  console.log(`Output directory: ${dirname(output)}`)
}

await main()
