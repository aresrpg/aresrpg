// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import family from '../seed/structures/townhouse.family.json' with { type: 'json' }

export const townhouse_plan = ({ bays, floors, roof, cover, entry, sides = ['exposed', 'exposed'] }) => {
  if (![2, 3, 4].includes(bays) || ![2, 3].includes(floors) || !['gable', 'cross'].includes(roof))
    throw new TypeError('Unsupported townhouse proportions')
  if (![['roof', 'tile_red'].includes(cover), Number.isInteger(entry), entry >= 0, entry < bays].every(Boolean))
    throw new TypeError('Invalid townhouse roof or entrance')
  if (sides.length !== 2 || sides.some((side) => !['party', 'exposed'].includes(side)))
    throw new TypeError('Invalid townhouse side boundary')
  const width = bays * family.bay_width + 1
  return {
    bays,
    floors,
    roof,
    cover,
    entry,
    sides,
    width,
    depth: family.depth,
    levels: Array.from({ length: floors + 1 }, (_, i) => i * family.floor_height),
    entrance: [entry * family.bay_width + 3.5, 0, family.front],
    door_columns: [2, 3, 4].map((x) => x + entry * family.bay_width),
  }
}

const roof_sample = (plan, x, z) => {
  const eave = plan.levels.at(-1) + 1
  const middle = (plan.width - 1) / 2
  if (plan.roof === 'gable') return { y: eave + Math.min(x, plan.width - 1 - x), rotation: x < middle ? 0 : 2 }
  const main = eave + Math.min(z - 1, plan.depth - 2 - z)
  const gable = eave + 5 - Math.abs(x - middle)
  return gable > main && z <= plan.depth / 2
    ? { y: gable, rotation: x < middle ? 0 : 2 }
    : { y: main, rotation: z < plan.depth / 2 ? 1 : 3 }
}

const construction = () => {
  const pieces = new Map()
  const put = (x, y, z, material, shape = 'block', rotation = 0, half = 'bottom') => {
    const key = [x, y, z].join(',')
    if (pieces.has(key)) throw new Error(`Townhouse construction overlap at ${key}`)
    pieces.set(key, [shape, [x, y, z], material, rotation, half])
  }
  return { put, finish: () => [...pieces.values()] }
}

const facade_material = (plan, x, y, entrance) => {
  const course = y % family.floor_height
  const offset = (x % family.bay_width) - 1
  if (entrance && y < 5 && plan.door_columns.includes(x)) return null
  const symbol = offset < 0 ? 'W' : family.window[family.floor_height - 1 - course][offset]
  if (y < family.floor_height && ['p', 'W'].includes(symbol)) return 'stone'
  return family.materials[symbol]
}

const gable_material = (plan, x, y) => {
  const center = (plan.width - 1) / 2
  const rise = y - plan.levels.at(-1)
  if (Math.abs(x - center) <= 1 && rise >= 2 && rise <= 4) return x === center ? 'wood' : 'window_dark'
  return x % family.bay_width === 0 || rise === 1 || rise === 6 ? 'wood' : 'plaster'
}

const side_material = (plan, z, y) => {
  const course = y % family.floor_height
  if (course === 0) return 'wood'
  if (z >= 7 && z <= 11 && y < plan.levels.at(-1))
    return family.materials[family.window[family.floor_height - 1 - course][z - 7]]
  return y < family.floor_height ? 'stone' : 'plaster'
}

const party_material = (z, y) => {
  if (y < family.floor_height) return 'stone'
  return y % family.floor_height === 0 || (z - family.front) % family.bay_width === 0 ? 'wood' : 'plaster'
}

const range = (start, end) => Array.from({ length: Math.max(0, end - start) }, (_, i) => i + start)

const shell = (kit, plan) => {
  const back = plan.depth - 4
  const facades = range(0, plan.width).flatMap((x) =>
    [family.front, back].flatMap((z) => range(0, roof_sample(plan, x, z).y).map((y) => [x, y, z]))
  )
  facades.forEach(([x, y, z]) => {
    const material =
      y <= plan.levels.at(-1) ? facade_material(plan, x, y, z === family.front) : gable_material(plan, x, y)
    if (!material) return
    const direction = z === family.front ? 1 : -1
    const inset = ['window_dark', 'trim'].includes(material) ? direction : 0
    kit.put(x, y, z + inset, material)
  })
  const sides = [0, plan.width - 1].flatMap((x) =>
    range(family.front + 1, back).flatMap((z) => range(0, roof_sample(plan, x, z).y).map((y) => [x, y, z]))
  )
  sides.forEach(([x, y, z]) => {
    const index = x === 0 ? 0 : 1
    const material = plan.sides[index] === 'party' ? party_material(z, y) : side_material(plan, z, y)
    const inset = ['window_dark', 'trim'].includes(material) ? [1, -1][index] : 0
    kit.put(x + inset, y, z, material)
  })
  const floors = plan.levels
    .slice(1)
    .flatMap((y) => range(1, plan.width - 1).flatMap((x) => range(family.front + 2, back - 1).map((z) => [x, y, z])))
  floors.forEach(([x, y, z]) => kit.put(x, y, z, 'wood'))
}

const roof = (kit, plan) => {
  const columns = range(0, plan.width).flatMap((x) => range(1, plan.depth - 1).map((z) => [x, z]))
  columns.forEach(([x, z]) => {
    const { y, rotation } = roof_sample(plan, x, z)
    const boundary = [0, plan.width - 1].includes(x)
    const trim = [1, plan.depth - 2].includes(z)
    const ridge = plan.roof === 'gable' && x === (plan.width - 1) / 2
    const material = boundary ? 'stone' : trim || ridge ? 'wood' : plan.cover
    kit.put(x, y, z, material, ridge ? 'slab' : 'stair', rotation)
    if (trim && !ridge) kit.put(x, y - 1, z, 'wood', 'stair', (rotation + 2) % 4, 'top')
  })
}

const facade_details = (kit, plan) => {
  const parts = [],
    plants = [],
    vines = []
  range(0, plan.bays).forEach((bay) => {
    const center = bay * family.bay_width + 3
    range(1, plan.floors).forEach((floor) => {
      const base = plan.levels[floor]
      for (let x = center - 2; x <= center + 2; x++) {
        kit.put(x, base + 1, 2, 'wood', 'slab', 0, 'top')
        kit.put(x, base + 2, 2, 'leaf')
        kit.put(x, base + 6, 2, 'wood', 'slab')
      }
      for (const x of [center - 2, center + 2]) kit.put(x, base, 2, 'trim', 'stair', 3, 'top')
      plants.push({
        kind: 'bush',
        center: [center + 0.5, base + 3, 2.5],
        scale: 1.7,
        color: [0.07, 0.2, 0.025],
        accent: [0.27, 0.45, 0.08],
      })
      vines.push({ top: [center - 1, base + 3, 1.86], length: 4 + (bay % 3), yaw: 0 })
    })
    if (bay !== plan.entry) {
      for (let x = center - 2; x <= center + 2; x++) kit.put(x, 1, 2, 'stone', 'slab', 0, 'top')
    }
  })
  const door = plan.entry * family.bay_width + 3
  for (let x = door - 2; x <= door + 2; x++) {
    kit.put(x, 5, 2, 'wood', 'slab', 0, 'top')
    kit.put(x, 6, 1, plan.cover, 'stair', 1)
  }
  for (const x of [door - 2, door + 2]) {
    kit.put(x, 4, 2, 'wood', 'stair', 1, 'top')
    parts.push({ asset: 'lantern', position: [x + 0.5, 2, 1.5], rotation: 0 })
  }
  if (plan.sides.includes('exposed'))
    parts.push({ asset: 'banner', position: [plan.width - 2, plan.levels[1] + 2, 1.7], rotation: 0 })
  return { parts, plants, vines }
}

/** Plan-derived construction only; no random placements, renderer or client dependency. */
export const build_townhouse = (input) => {
  const plan = townhouse_plan(input)
  const kit = construction()
  shell(kit, plan)
  roof(kit, plan)
  const dressing = facade_details(kit, plan)
  const contact_height = Math.min(...family.variants.map(({ floors }) => floors)) * family.floor_height
  return {
    kind: 'building',
    pieces: kit.finish(),
    ...dressing,
    module: {
      size: [plan.width, plan.levels.at(-1) + Math.max(plan.width, plan.depth), plan.depth],
      clearances: [{ min: [plan.entrance[0] - 1.5, 0, 0], max: [plan.entrance[0] + 1.5, 4, family.front + 1] }],
      ports: [
        {
          name: 'west',
          position: [0, contact_height / 2, plan.depth / 2],
          span: [0, contact_height, plan.depth - 2 * family.front],
          face: 'x-',
          profile: 'townhouse_party',
          sealed: true,
        },
        {
          name: 'east',
          position: [plan.width, contact_height / 2, plan.depth / 2],
          span: [0, contact_height, plan.depth - 2 * family.front],
          face: 'x+',
          profile: 'townhouse_party',
          sealed: true,
        },
      ].filter((_, i) => plan.sides[i] === 'party'),
    },
  }
}
