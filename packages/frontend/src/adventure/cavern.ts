// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { city_blocks, create_fbm_sampler, type FixedStructure } from '@aresrpg/engine'

import adventure from '../../../../seed/content/adventure.json'
import environment from '../../../../seed/content/adventure_environment.json'

import { adventure_axis, cavern_floor } from './biome.ts'

const plan = environment.descent
const throne = adventure.encounters.at(-1)!.position
const noise = create_fbm_sampler(871, { period: 13, octaves: 2, gain: 0.5 })

/** The same invisible boundary as the opening keeps both heroes off the lava and cliff edges. */
export const cavern_movement_area = (x: number, z: number): boolean =>
  Math.hypot(x - throne.x, z - throne.z) < plan.arena_radius - 1 ||
  (z <= throne.z && Math.abs(x - adventure_axis(z)) < 3.5)

const margin = Math.ceil(plan.chamber_radius * 1.2)
const origin_x = throne.x - margin
const origin_z = plan.start_z
const width = margin * 2 + 1
const depth = throne.z + margin - origin_z + 1
type Fill = Readonly<Parameters<ReturnType<typeof city_blocks>['fill']>>
const vault = (distance: number): number => Math.sqrt(Math.max(0, 1 - distance ** 2))

const cavern_material = (x: number, z: number, radius: number, lava: boolean): string => {
  if (lava) {
    const angle = Math.atan2(z - throne.z, x - throne.x)
    return Math.sin(radius * 1.3 + angle * 5) > 0.8 ? 'lava_hot' : 'lava'
  }
  return Math.abs(radius - plan.arena_radius) < 1 || radius < 4 ? 'cavern_basalt' : 'cavern_slate'
}

const cavern_column = (x: number, z: number): readonly Fill[] => {
  const lateral = Math.abs(x - adventure_axis(z))
  const radial = Math.hypot(x - throne.x, z - throne.z)
  const tunnel = z <= throne.z ? lateral / plan.radius : Infinity
  const chamber = radial / plan.chamber_radius
  const distance = Math.min(tunnel, chamber)
  const ripple = (noise(x, z) - 0.5) * 0.13
  if (distance > 1.13 + ripple) return []
  const floor = cavern_floor(z)
  const ceiling =
    floor + 7 + Math.round(Math.max(vault(tunnel) * plan.vault_height, vault(chamber) * plan.arena_vault_height))
  const lava = radial > plan.arena_radius && radial < plan.lava_radius && tunnel > 4 / plan.radius
  const top = ceiling + plan.roof_thickness + Math.round(noise(x, z) * 4)
  const local_x = x - origin_x
  const local_z = z - origin_z
  const filled: readonly Fill[] = [[local_x, local_x, floor - 9, top, local_z, local_z, 'cavern_basalt']]
  if (distance >= 1 + ripple) return filled
  const surface = (lava ? throne.y : floor) - 1
  return [
    ...filled,
    [local_x, local_x, surface, surface, local_z, local_z, cavern_material(x, z, radial, lava)],
    [local_x, local_x, surface + 1, ceiling, local_z, local_z, 'air'],
  ]
}

/** Open leaves sit against the jambs; the central arch always retains walking and camera clearance. */
const cavern_gate = () => {
  const blocks = city_blocks()
  const x = throne.x - origin_x
  const z = plan.gate.z - origin_z
  const y = cavern_floor(plan.gate.z)
  for (const side of [-1, 1]) {
    const jamb = x + side * plan.gate.half_width
    blocks.fill(jamb - 1, jamb + 1, y, y + plan.gate.height - 3, z - 2, z + 2, 'cavern_basalt')
    blocks.fill(jamb - 2, jamb + 2, y, y + 2, z - 3, z + 3, 'cavern_slate')
    blocks.fill(
      x + side * (plan.gate.half_width - 2),
      x + side * (plan.gate.half_width - 2),
      y,
      y + plan.gate.leaf_height,
      z + 1,
      z + plan.gate.leaf_depth,
      'cavern_basalt'
    )
    blocks.fill(
      x + side * (plan.gate.half_width - 2),
      x + side * (plan.gate.half_width - 2),
      y + plan.gate.leaf_height - 1,
      y + plan.gate.leaf_height - 1,
      z + 1,
      z + plan.gate.leaf_depth,
      'poison_rune'
    )
    for (const height of [4, 8, 12, 16]) blocks.set(jamb, y + height, z - 3, 'poison_rune')
  }
  for (let offset = 1 - plan.gate.half_width; offset < plan.gate.half_width; offset += 1) {
    const crown = y + plan.gate.height - Math.floor(Math.abs(offset) / 2)
    blocks.fill(x + offset, x + offset, crown, crown + 2, z - 2, z + 2, 'cavern_basalt')
    blocks.set(x + offset, crown, z - 3, 'poison_rune')
  }
  blocks.fill(x - 1, x + 1, y + plan.gate.height, y + plan.gate.height + 4, z - 3, z - 1, 'poison_rune')
  return blocks.finish()
}

export const adventure_cavern = (): FixedStructure => {
  const blocks = city_blocks()
  Array.from({ length: width * depth }, (_, index) =>
    cavern_column(origin_x + (index % width), origin_z + Math.floor(index / width))
  )
    .flat()
    .forEach((fill) => blocks.fill(...fill))
  cavern_gate().forEach(([x, y, z, material]) => blocks.set(x, y, z, material))
  return {
    source: { name: 'adventure_cavern', size: [width, 128, depth], anchor: [0, 0, 0], blocks: blocks.finish() },
    origin: [origin_x, 0, origin_z],
    rotation: 0,
  }
}
