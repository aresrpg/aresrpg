// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One chain resource pack becomes adjacent visual seats. Every seat keeps the same pack
// identity for gathering; only its ordinal is presentation.

import { mulberry, type ResourceNodeMarker } from '@aresrpg/engine'

import { publish_spawn_tag } from './core/nametag_feed.ts'
import { read_pose } from './core/pose_feed.ts'

const LOAD_RANGE_BLOCKS = 90
const DESPAWN_RANGE_BLOCKS = 120
const PATCH_BUDGET = 48
const TAG_RANGE_BLOCKS = 6

export type WorldResourcePack = Readonly<{
  id: string
  x: number
  z: number
  item_type: string
  job: string
  tier: number
  nodes: number
}>

export const resource_node_id = (pack_id: string, ordinal: number): string => `${pack_id}:n${ordinal}`

export const parse_resource_node_id = (id: string): Readonly<{ pack_id: string; ordinal: number }> | null => {
  const cut = id.lastIndexOf(':n')
  const ordinal = Number(id.slice(cut + 2))
  return cut >= 0 && Number.isInteger(ordinal) && ordinal >= 0 ? { pack_id: id.slice(0, cut), ordinal } : null
}

/** Grid-adjacent seats, rotated per pack. Low ordinals survive consumption, so one gathered
 * node removes only the patch's outermost visual seat. */
export const resource_seats = (pack_id: string, count: number): readonly Readonly<{ dx: number; dz: number }>[] => {
  const hash = [...pack_id].reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16_777_619), 2_166_136_261)
  const quarter_turn = Math.floor(mulberry(hash)() * 4)
  const rotate = (x: number, z: number): Readonly<{ dx: number; dz: number }> => {
    if (quarter_turn === 1) return { dx: -z, dz: x }
    if (quarter_turn === 2) return { dx: -x, dz: -z }
    if (quarter_turn === 3) return { dx: z, dz: -x }
    return { dx: x, dz: z }
  }
  const seats: Readonly<{ dx: number; dz: number }>[] = []
  for (let radius = 0; seats.length < count; radius += 1)
    for (let z = -radius; z <= radius && seats.length < count; z += 1)
      for (let x = -radius; x <= radius && seats.length < count; x += 1)
        if (radius === 0 || Math.max(Math.abs(x), Math.abs(z)) === radius) {
          // eslint-disable-next-line functional/immutable-data -- local construction mutates only this fresh array
          seats.push(rotate(x, z))
        }
  return Object.freeze(seats)
}

export const resident_resource_packs = (
  live: readonly WorldResourcePack[],
  own: Readonly<{ x: number; z: number }>,
  placed: ReadonlySet<string>
): readonly WorldResourcePack[] =>
  live
    .map((row) => ({ row, distance: Math.hypot(row.x - own.x, row.z - own.z) }))
    .filter(({ row, distance }) =>
      placed.has(row.id) ? distance <= DESPAWN_RANGE_BLOCKS : distance <= LOAD_RANGE_BLOCKS
    )
    .sort((a, b) => a.distance - b.distance || a.row.id.localeCompare(b.row.id))
    .slice(0, PATCH_BUDGET)
    .map(({ row }) => row)

export const create_resource_renderer = ({
  submit,
  ground_height,
  label,
}: Readonly<{
  submit: (markers: readonly ResourceNodeMarker[]) => void
  ground_height: (x: number, z: number) => number
  label: (node_id: string, element: Readonly<HTMLElement> | null) => void
}>) => {
  const placed = new Map<string, WorldResourcePack>()
  const tagged = new Set<string>()
  let markers: readonly ResourceNodeMarker[] = Object.freeze([])

  const clear_tag = (id: string): void => {
    if (!tagged.has(id)) return
    tagged.delete(id)
    label(id, null)
    publish_spawn_tag(id, null)
  }

  const build = (): void => {
    markers = Object.freeze(
      [...placed.values()].flatMap((pack) =>
        resource_seats(pack.id, pack.nodes).map(({ dx, dz }, ordinal) => {
          const x = pack.x + dx
          const z = pack.z + dz
          return Object.freeze({
            id: resource_node_id(pack.id, ordinal),
            x,
            y: ground_height(x, z),
            z,
            item_type: pack.item_type,
            job: pack.job,
            tier: pack.tier,
          })
        })
      )
    )
    submit(markers)
  }

  const sync_tags = (): void => {
    const own = read_pose()
    const wanted = new Set(
      own ? markers.filter(({ x, z }) => Math.hypot(x - own.x, z - own.z) <= TAG_RANGE_BLOCKS).map(({ id }) => id) : []
    )
    for (const id of [...tagged]) if (!wanted.has(id)) clear_tag(id)
    for (const id of wanted) {
      if (tagged.has(id) || typeof document === 'undefined') continue
      const element = document.createElement('div')
      tagged.add(id)
      label(id, element)
      publish_spawn_tag(id, element)
    }
  }

  return Object.freeze({
    update: (live: readonly WorldResourcePack[]): void => {
      const own = read_pose()
      const wanted = own ? resident_resource_packs(live, own, new Set(placed.keys())) : []
      const keep = new Set(wanted.map(({ id }) => id))
      let changed = false
      for (const [id] of placed)
        if (!keep.has(id)) {
          for (const marker of markers.filter(({ id: node_id }) => node_id.startsWith(`${id}:n`))) clear_tag(marker.id)
          placed.delete(id)
          changed = true
        }
      for (const row of wanted) {
        const known = placed.get(row.id)
        if (known && known.nodes === row.nodes && known.item_type === row.item_type) continue
        placed.set(row.id, row)
        changed = true
      }
      if (changed) build()
      sync_tags()
    },
    dispose: (): void => {
      for (const id of [...tagged]) clear_tag(id)
      placed.clear()
      markers = Object.freeze([])
      submit(markers)
    },
  })
}
