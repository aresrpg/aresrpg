// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure world-table planning for reseed_driver.mjs. Kept separate so every driver file stays below 600 LoC.

const fields_of = (value) => value?.fields ?? value ?? {}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const as_number = (value) => Number(value ?? 0)
const id_string = (value) => {
  if (typeof value === 'string') return value
  return String(value?.id ?? value?.bytes ?? value ?? '')
}
const rate_bp = (rate) =>
  Math.min(10_000, Math.max(0, Math.round(as_number(rate) * 10_000)))

const resource_pack = (row) => {
  if (row.min_qty != null && row.max_qty != null)
    return { min: row.min_qty, max: row.max_qty }
  return (
    { 0: { min: 10, max: 20 }, 1: { min: 4, max: 8 }, 2: { min: 2, max: 4 } }[
      row.job
    ] ?? { min: 1, max: 1 }
  )
}

function resolve_world_rows(world, seed_manifest, mob_level_by_key, mob_role_by_key) {
  const blockers = []
  const resources = (world.resources ?? []).map((row) => {
    const template_id = seed_manifest.items?.[row.slug]
    if (!template_id)
      blockers.push(`world ${world.id}: resource ${row.slug} has no item id`)
    const pack = resource_pack(row)
    return {
      template_id,
      rate_bp: rate_bp(row.rate),
      min_qty: as_number(pack.min),
      max_qty: as_number(pack.max),
      job: as_number(row.job ?? 0),
      tier: as_number(row.tier ?? 1),
    }
  })
  const mobs = (world.mobGroups ?? []).map((row) => {
    const template_id = seed_manifest.mobs?.[row.mob]?.id
    if (!template_id)
      blockers.push(`world ${world.id}: mob ${row.mob} has no template id`)
    return {
      template_id,
      rate_bp: rate_bp(row.rate),
      min_group: 2,
      max_group: 3,
    }
  })
  const dungeon_rooms = (world.dungeonRooms ?? []).map((room, room_index) =>
    room.map((mob_key) => {
      const template_id = seed_manifest.mobs?.[mob_key]?.id
      if (!template_id)
        blockers.push(
          `world ${world.id}: room ${room_index + 1} mob ${mob_key} has no template id`
        )
      return template_id
    })
  )
  // DISTANCE DIFFICULTY: `clear_tables` empties the level vector and `add_mob_entry` re-inits every row to 0, so
  // a plan that does not re-emit `set_mob_level` silently erases every authored level on each reseed. The level is
  // the template's authored ceiling — the same projection `seed_full_corpus` writes at fresh authoring.
  const mob_levels = (world.mobGroups ?? []).map((row) => {
    const authored = mob_level_by_key.get(row.mob)
    if (authored === undefined)
      blockers.push(`world ${world.id}: mob ${row.mob} has no authored level`)
    return as_number(authored ?? 1)
  })
  // THE BOSS MASK (#1110): row indexes whose authored role is `boss`. `clear_tables` wipes it alongside the
  // level vector, so a reseed that never re-emits it leaves every format-3 boss group mixable with adds.
  const boss_mask = (world.mobGroups ?? [])
    .map((row, index) => (mob_role_by_key.get(row.mob) === 'boss' ? index : -1))
    .filter((index) => index >= 0)
  return {
    desired: { resources, mobs, mob_levels, boss_mask, dungeon_rooms },
    blockers,
  }
}

/// The World is `{ id, inner: Versioned }` since the republish restructure, and `Versioned` stores the payload
/// as a dynamic field whose JSON nests under `inner.value`. Reading the ROOT yields an empty world, which makes
/// every reseed rewrite everything and never converge. Falls back to the root so a pre-wrap object still reads.
function world_payload(chain) {
  const root = fields_of(chain)
  const inner = fields_of(root.inner)
  const wrapped = fields_of(inner.value)
  return wrapped.mobs || wrapped.resources || wrapped.dungeon_rooms ? wrapped : root
}

function normalize_chain_world(chain) {
  const value = world_payload(chain)
  return {
    resources: (value.resources ?? []).map((entry) => {
      const row = fields_of(entry)
      return {
        template_id: id_string(row.template_id),
        rate_bp: as_number(row.rate_bp),
        min_qty: as_number(row.min_qty),
        max_qty: as_number(row.max_qty),
        job: as_number(row.job),
        tier: as_number(row.tier),
      }
    }),
    mobs: (value.mobs ?? []).map((entry) => {
      const row = fields_of(entry)
      return {
        template_id: id_string(row.template_id),
        rate_bp: as_number(row.rate_bp),
        min_group: as_number(row.min_group),
        max_group: as_number(row.max_group),
      }
    }),
    mob_levels: (value.mob_levels ?? []).map(as_number),
    boss_mask: (value.boss_mask ?? []).map(as_number),
    dungeon_rooms: (value.dungeon_rooms ?? []).map((room) => {
      const row = fields_of(room)
      return (row.mobs ?? []).map(id_string)
    }),
  }
}

function multiset_delta(current, desired) {
  const counts = new Map()
  for (const value of current) {
    const key = JSON.stringify(value)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let added = 0
  for (const value of desired) {
    const key = JSON.stringify(value)
    const count = counts.get(key) ?? 0
    if (count) counts.set(key, count - 1)
    else added += 1
  }
  return {
    removed: [...counts.values()].reduce((sum, count) => sum + count, 0),
    added,
  }
}

function world_calls(world_id, world_key, desired, target) {
  const base = {
    leg: 'worlds',
    target,
    world_key,
    object_id: world_id,
    command_weight: 1,
  }
  const calls = [
    {
      ...base,
      function: 'clear_tables',
      payload: {},
      summary: `${world_key} clear_tables`,
    },
  ]
  desired.resources.forEach((payload, index) =>
    calls.push({
      ...base,
      function: 'add_resource_entry',
      payload,
      summary: `${world_key} add_resource_entry[${index}]`,
    })
  )
  desired.mobs.forEach((payload, index) =>
    calls.push({
      ...base,
      function: 'add_mob_entry',
      payload,
      summary: `${world_key} add_mob_entry[${index}]`,
    })
  )
  // AFTER every add_mob_entry: the level is positional, so the row must exist before it is set.
  desired.mob_levels.forEach((level, index) =>
    calls.push({
      ...base,
      function: 'set_mob_level',
      payload: { template_id: desired.mobs[index]?.template_id, level },
      summary: `${world_key} set_mob_level[${index}]`,
    })
  )
  // AFTER every add_mob_entry, like the level vector: the mask indexes the table BY POSITION.
  if (desired.boss_mask.length)
    calls.push({
      ...base,
      function: 'set_boss_mask',
      payload: { rows: desired.boss_mask },
      summary: `${world_key} set_boss_mask`,
    })
  desired.dungeon_rooms.forEach((mob_ids, index) =>
    calls.push({
      ...base,
      function: 'add_dungeon_room',
      payload: { mob_ids },
      summary: `${world_key} add_dungeon_room[${index}]`,
    })
  )
  return calls
}

export function build_world_leg({
  seed_rows,
  mob_rows,
  seed_manifest,
  chain_state,
  target,
}) {
  const blockers = []
  const transactions = []
  const row_deltas = []
  const role_projection_drift = []
  // the authored eligibility ceiling per mob key — `seed_full_corpus` projects the same value at fresh authoring
  const mob_level_by_key = new Map(
    (mob_rows ?? []).map((mob) => [mob.key, mob.maxLevel ?? mob.minLevel ?? 1])
  )
  const mob_role_by_key = new Map((mob_rows ?? []).map((mob) => [mob.key, mob.role]))

  for (const world of seed_rows) {
    const world_entry = seed_manifest.worlds?.find(
      (entry) => entry.wid === world.id
    )
    if (!world_entry?.id) {
      blockers.push(`world ${world.id}: no object id in seed_manifest.worlds`)
      continue
    }
    if (!chain_state[world_entry.id]) {
      blockers.push(`world ${world.id}: object ${world_entry.id} unreadable`)
      continue
    }
    const { desired, blockers: row_blockers } = resolve_world_rows(
      world,
      seed_manifest,
      mob_level_by_key,
      mob_role_by_key
    )
    blockers.push(...row_blockers)
    if (row_blockers.length) continue
    const current = normalize_chain_world(chain_state[world_entry.id])
    if (!same(current, desired)) {
      row_deltas.push({
        world: world.id,
        resources: multiset_delta(current.resources, desired.resources),
        mob_groups: multiset_delta(current.mobs, desired.mobs),
        rooms: multiset_delta(current.dungeon_rooms, desired.dungeon_rooms),
      })
      const calls = world_calls(world_entry.id, world.id, desired, target)
      transactions.push({
        leg: 'worlds',
        label: `worlds:${world.id}`,
        calls,
        call_count: calls.length,
        ptb_command_count: calls.length,
        atomic_world: true,
      })
    }
  }

  for (const mob of mob_rows) {
    const projected = seed_manifest.mobs?.[mob.key]
    if (projected && projected.role !== mob.role)
      role_projection_drift.push({
        mob: mob.key,
        manifest_role: projected.role,
        seed_role: mob.role,
      })
  }
  const totals = row_deltas.reduce(
    (result, row) => {
      for (const field of ['resources', 'mob_groups', 'rooms']) {
        result[field].removed += row[field].removed
        result[field].added += row[field].added
      }
      return result
    },
    {
      resources: { removed: 0, added: 0 },
      mob_groups: { removed: 0, added: 0 },
      rooms: { removed: 0, added: 0 },
    }
  )
  return {
    seed_rows: seed_rows.length,
    rows_drifted: transactions.length,
    call_count: transactions.reduce(
      (sum, transaction) => sum + transaction.call_count,
      0
    ),
    tx_count: transactions.length,
    row_deltas,
    totals,
    role_projection_drift,
    blockers,
    transactions,
  }
}
