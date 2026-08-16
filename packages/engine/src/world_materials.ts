// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type WorldMaterial = string
export type MaterialRole = 'surface' | 'subsurface' | 'filler' | 'liquid'
export type MaterialUse = Readonly<{
  name: string
  role: MaterialRole
  paired_material?: string
}>
export type CompiledMaterial = Readonly<{
  name: string
  role: MaterialRole
  color: readonly [number, number, number]
  paired_color: readonly [number, number, number]
}>
export type CompiledMaterials = Readonly<{
  entries: readonly CompiledMaterial[]
  colors: readonly (readonly [number, number, number])[]
  id_for: (name: string, role?: MaterialRole, paired_material?: string) => number
}>

const HEX_COLOR = /^#[0-9a-f]{6}$/i

const is_color = (value: unknown): value is string => typeof value === 'string' && HEX_COLOR.test(value)

const linear_channel = (byte: number): number => {
  const value = byte / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

export const material_color = (color: WorldMaterial): readonly [number, number, number] => {
  const value = Number.parseInt(color.slice(1), 16)
  return [linear_channel((value >> 16) & 0xff), linear_channel((value >> 8) & 0xff), linear_channel(value & 0xff)]
}

export const validate_materials = (materials: unknown): readonly string[] => {
  if (materials === null || typeof materials !== 'object' || Array.isArray(materials))
    return ['materials must be an object']
  const errors: string[] = []
  const entries = Object.entries(materials)
  if (entries.length === 0) return ['materials must not be empty']
  entries.forEach(([name, value]) => {
    if (!is_color(value)) errors.push(`materials.${name} must be #rrggbb`)
  })
  return errors
}

const use_key = ({ name, role, paired_material }: MaterialUse): string =>
  `${name}\u0000${role}\u0000${paired_material ?? ''}`

export const compile_materials = (
  materials: Readonly<Record<string, WorldMaterial>>,
  requested_uses: readonly MaterialUse[] = []
): CompiledMaterials => {
  const uses = Object.keys(materials).flatMap((name) => {
    const requested = requested_uses.filter((use) => use.name === name)
    return requested.length > 0 ? requested : [{ name, role: 'filler' as const }]
  })
  const unique_uses = uses.filter(
    (use, index) => uses.findIndex((candidate) => use_key(candidate) === use_key(use)) === index
  )
  const ids = new Map<string, number>()
  const first_ids = new Map<string, number>()
  const empty: CompiledMaterial = Object.freeze({
    name: '',
    role: 'filler',
    color: Object.freeze([0, 0, 0] as const),
    paired_color: Object.freeze([0, 0, 0] as const),
  })
  const entries: CompiledMaterial[] = [empty]

  unique_uses.forEach((use) => {
    const authored = materials[use.name]
    if (authored === undefined) throw new TypeError(`unknown world material "${use.name}"`)
    const paired = materials[use.paired_material ?? use.name]
    if (paired === undefined) throw new TypeError(`unknown paired world material "${use.paired_material ?? ''}"`)
    const entry = Object.freeze({
      name: use.name,
      role: use.role,
      color: Object.freeze(material_color(authored)),
      paired_color: Object.freeze(material_color(paired)),
    })
    const id = entries.length
    ids.set(use_key(use), id)
    if (!first_ids.has(use.name)) first_ids.set(use.name, id)
    entries.push(entry)
  })

  if (entries.length > 0x1000) throw new TypeError('compiled world materials exceed the 4095-entry voxel palette')
  const frozen_entries = Object.freeze(entries)
  return Object.freeze({
    entries: frozen_entries,
    colors: Object.freeze(frozen_entries.map(({ color }) => color)),
    id_for: (name, role, paired_material) => {
      const id = role === undefined ? first_ids.get(name) : ids.get(use_key({ name, role, paired_material }))
      if (id === undefined) throw new TypeError(`unknown world material "${name}"`)
      return id
    },
  })
}
