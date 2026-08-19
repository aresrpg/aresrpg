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

const main = async (): Promise<void> => {
  const input = resolve(process.argv[2] ?? '')
  const output = resolve(process.argv[3] ?? '')
  if (!process.argv[2] || !process.argv[3])
    throw new TypeError('usage: bun scripts/import_schematics.ts <terrain-assets-dir> <types.json>')
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
  const types = Object.fromEntries(
    [...imported, ...Object.entries(generated_ruins())].sort(([a], [b]) => a.localeCompare(b))
  )
  await writeFile(output, `${JSON.stringify({ version: 1, types }, null, 2)}\n`)
  console.log(
    `Imported ${imported.length} schematics and ${Object.keys(generated_ruins()).length} generated ruins into ${output}`
  )
  console.log(`Source: aresrpg/aresrpg-dapp at archived master 07f8c7b`)
  console.log(`Output directory: ${dirname(output)}`)
}

await main()
