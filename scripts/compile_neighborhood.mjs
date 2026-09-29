// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import family from '../seed/structures/townhouse.family.json' with { type: 'json' }

import { collapse_layout } from './constraint_layout.mjs'
import { build_townhouse, townhouse_plan } from './townhouse.mjs'
import { validate_connections } from './module_connections.mjs'

const compatible = (a, b) => a.roof !== b.roof && Math.abs(a.floors - b.floors) <= 1 && a.cover !== b.cover

export const plan_neighborhood = ({ seed, rows }) => {
  const parcels = rows.flatMap(({ bays }, row) =>
    bays.map((count, i) => ({
      row,
      bays: count,
      sides: [i ? 'party' : 'exposed', i < bays.length - 1 ? 'party' : 'exposed'],
    }))
  )
  const edges = parcels.flatMap((parcel, i) => (i && parcel.row === parcels[i - 1].row ? [[i - 1, i]] : []))
  const choices = collapse_layout({
    seed,
    edges,
    compatible,
    domains: parcels.map(({ bays, sides }) =>
      family.variants.map((variant) => townhouse_plan({ ...variant, bays, sides }))
    ),
  })
  return { choices, edges }
}

const build_row = (choices, start_index) => {
  let x = 0
  const parts = choices.map((plan, i) => {
    const part = { asset: `townhouse_${i + start_index}`, position: [x, 0, 0], rotation: 0 }
    x += plan.width
    return part
  })
  const connections = choices.slice(1).map((_, i) => [
    [i, 'east'],
    [i + 1, 'west'],
  ])
  return { kind: 'building', parts, connections, width: x }
}

/** Only this compile edge expands architecture. Browser payloads contain no solver or plans. */
export const compile_neighborhood = (recipe) => {
  const { choices } = plan_neighborhood(recipe.neighborhood)
  const houses = Object.fromEntries(choices.map((plan, i) => [`townhouse_${i}`, build_townhouse(plan)]))
  let offset = 0
  const rows = Object.fromEntries(
    recipe.neighborhood.rows.map(({ bays }, i) => {
      const row = build_row(choices.slice(offset, offset + bays.length), offset)
      offset += bays.length
      return [`street_${i}`, row]
    })
  )
  const assets = { ...recipe.assets, ...houses, ...rows }
  Object.values(rows).forEach((row) => validate_connections(assets, row))
  const parts = recipe.neighborhood.rows.map(({ position, rotation }, i) => ({
    asset: `street_${i}`,
    position,
    rotation,
  }))
  parts.push(...recipe.neighborhood.landmarks)
  const pieces = []
  const [x0, z0, x1, z1] = recipe.neighborhood.square
  for (let x = x0; x < x1; x++) {
    for (let z = z0; z < z1; z++)
      pieces.push(['block', [x, -1, z], x === x0 || x === x1 - 1 ? 'stone_dark' : 'stone', 0, 'bottom'])
  }
  const district = { kind: 'building', pieces, parts }
  return {
    ...assets,
    demo_city: district,
    house_1: { kind: 'building', parts: [{ asset: 'townhouse_0', position: [0, 0, 0], rotation: 0 }] },
    house_2: { kind: 'building', parts: [{ asset: 'townhouse_1', position: [0, 0, 0], rotation: 0 }] },
  }
}
