// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { detail_builder } from '../packages/engine/src/detail_builder.ts'

import { building_kit } from './building_kit.mjs'
import { module_transform } from './module_transform.mjs'
import { validate_module, validate_connections } from './module_connections.mjs'

const PROPS = new Set(['banner', 'lantern', 'rope', 'chain', 'chain_link', 'campfire', 'fence'])

const apply_operations = (writer, operations) => {
  for (const [operation, ...args] of operations) {
    if (!Object.hasOwn(writer, operation)) throw new TypeError(`Unknown schematic operation: ${operation}`)
    writer[operation](...args)
  }
}

const validate_reachable = (assets, id, seen = new Set()) => {
  const asset = assets[id]
  if (!asset || seen.has(id)) return
  seen.add(id)
  if (asset.module) validate_module(asset)
  if (asset.connections) validate_connections(assets, asset)
  asset.parts?.forEach(({ asset }) => validate_reachable(assets, asset, seen))
}

/** Reusable asset data → the existing voxel, detail-cell and flora formats. Offline only. */
export const bake_schematic = (assets, id, origin = [0, 0, 0], external_details) => {
  validate_reachable(assets, id)
  const details = external_details ?? detail_builder()
  const plants = []
  const fires = []
  const vines = []
  const kit = building_kit()
  const names = Object.keys(assets)
  const allowed = new Set(
    assets[id]?.kind === 'building' ? [...PROPS, ...names.filter((name) => assets[name].kind === 'building')] : names
  )
  const visit = (name, transform, ancestors, mirrored) => {
    if (!Object.hasOwn(assets, name)) throw new TypeError(`Unknown schematic: ${name}`)
    if (ancestors.includes(name)) throw new TypeError(`Cyclic schematic: ${[...ancestors, name].join(' → ')}`)
    const authored = assets[name]
    const source = {
      pieces: [],
      details: [],
      plants: [],
      vines: [],
      fires: [],
      parts: [],
      module: { clearances: [] },
      ...authored,
    }
    if (!allowed.has(name)) throw new TypeError(`Unapproved building ingredient: ${name}`)
    if (source.kind === 'building' && Object.hasOwn(authored, 'details'))
      throw new TypeError(`Building ${name} must use only block, slab and stair pieces`)
    if (Object.hasOwn(authored, 'voxels'))
      throw new TypeError('Legacy voxel operations are not supported; use building pieces')
    ;(source.module.clearances ?? []).forEach((clearance) => kit.reserve(clearance, transform, name))
    source.pieces.forEach((piece) => kit.add(piece, transform, name))
    apply_operations(details.transformed(transform, mirrored), source.details)
    source.plants.forEach((plant) => plants.push({ ...plant, center: transform(plant.center) }))
    source.vines.forEach((vine) => {
      const zero = transform([0, 0, 0])
      const direction = transform([Math.cos(vine.yaw), 0, Math.sin(vine.yaw)])
      vines.push({ ...vine, top: transform(vine.top), yaw: Math.atan2(direction[2] - zero[2], direction[0] - zero[0]) })
    })
    source.fires.forEach((fire) => fires.push({ ...fire, center: transform(fire.center) }))
    source.parts.forEach((part) => {
      const placement = module_transform(part)
      visit(
        part.asset,
        (point) => transform(placement.point(point)),
        [...ancestors, name],
        mirrored !== placement.mirrored
      )
    })
  }
  visit(id, (point) => point.map((value, axis) => value + origin[axis]), [], false)
  const blocks = kit.finish(details)
  return { blocks, details: external_details ? null : details.finish(), plants, fires, vines }
}
