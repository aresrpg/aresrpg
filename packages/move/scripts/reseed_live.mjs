// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// gRPC reads and PTB composition for reseed_driver.mjs. The pure diff/latch contract stays in reseed_plan.mjs.

import { bcs } from '@mysten/sui/bcs'
import { Transaction as transaction_class } from '@mysten/sui/transactions'
import { deriveDynamicFieldID as derive_dynamic_field_id } from '@mysten/sui/utils'

import { normalizeReceipt as normalize_receipt } from './ceremony_lib.mjs'
import { fixed_gas_budget_mist, spell_row_key } from './reseed_plan.mjs'

const object_page_size = 50
const empty_struct_key = Uint8Array.of(0)
const fields_of = (value) => value?.fields ?? value ?? {}
const uid_string = (value) => fields_of(value)?.id ?? value

async function get_objects_json(client, object_ids) {
  const objects_by_id = {}
  for (let index = 0; index < object_ids.length; index += object_page_size) {
    const page_ids = object_ids.slice(index, index + object_page_size)
    const { objects } = await client.getObjects({
      objectIds: page_ids,
      include: { json: true },
    })
    objects.forEach((object, page_index) => {
      const requested_id = page_ids[page_index]
      objects_by_id[requested_id] =
        object instanceof Error ? null : (object?.json ?? null)
    })
  }
  return objects_by_id
}

function required_spell_ids(seed_rows, seed_manifest) {
  return seed_rows.map((row) => {
    const key = spell_row_key(row)
    const object_id = seed_manifest.spells?.[key]?.id
    if (!object_id)
      throw new Error(`spell ${key}: no object id in seed_manifest.spells`)
    return object_id
  })
}

function required_item_ids(seed_rows, seed_manifest) {
  return seed_rows
    .filter((row) => row?.stats?.min && row?.stats?.max)
    .map((row) => {
      const object_id = seed_manifest.items?.[row.slug]
      if (!object_id)
        throw new Error(`item ${row.slug}: no object id in seed_manifest.items`)
      return object_id
    })
}

function required_world_ids(seed_rows, seed_manifest) {
  return seed_rows.map((world) => {
    const object_id = seed_manifest.worlds?.find(
      (entry) => entry.wid === world.id
    )?.id
    if (!object_id)
      throw new Error(`world ${world.id}: no object id in seed_manifest.worlds`)
    return object_id
  })
}

async function fetch_item_state(client, object_ids, type_package) {
  const templates = await get_objects_json(client, object_ids)
  const min_key_type = `${type_package}::item_stats::StatsMinKey`
  const max_key_type = `${type_package}::item_stats::StatsMaxKey`
  const field_requests = []
  for (const object_id of object_ids) {
    field_requests.push({
      template_id: object_id,
      field: 'stats_min',
      field_id: derive_dynamic_field_id(
        object_id,
        min_key_type,
        empty_struct_key
      ),
    })
    field_requests.push({
      template_id: object_id,
      field: 'stats_max',
      field_id: derive_dynamic_field_id(
        object_id,
        max_key_type,
        empty_struct_key
      ),
    })
  }
  const fields = await get_objects_json(
    client,
    field_requests.map((request) => request.field_id)
  )
  const state = Object.fromEntries(
    object_ids.map((object_id) => [
      object_id,
      {
        template: templates[object_id],
        stats_min: null,
        stats_max: null,
      },
    ])
  )
  for (const request of field_requests)
    state[request.template_id][request.field] =
      fields[request.field_id]?.value ?? null
  return state
}

/// Resolve each World's `Versioned` payload. `Versioned` stores its value in a dynamic field on its OWN id,
/// keyed by the u64 version (the pinned sui-framework `versioned.move`) — never inline in the parent JSON. A
/// fetch that stops at the outer shell therefore reports every world as EMPTY: the planner then rewrites all of
/// them and the required post-run dry-run can never converge. Returns the shell with `inner.value` populated,
/// which is exactly the shape `reseed_world_plan`'s payload reader expects.
export async function fetch_world_state(client, object_ids) {
  const shells = await get_objects_json(client, object_ids)
  const child_requests = []
  for (const object_id of object_ids) {
    const inner = fields_of(fields_of(shells[object_id]).inner)
    const versioned_id = uid_string(inner.id)
    if (!versioned_id) continue // pre-wrap object (or unreadable) — the reader falls back to the root
    child_requests.push({
      world_id: object_id,
      field_id: derive_dynamic_field_id(
        versioned_id,
        'u64',
        bcs.u64().serialize(Number(inner.version ?? 0)).toBytes()
      ),
    })
  }
  const children = await get_objects_json(
    client,
    child_requests.map((request) => request.field_id)
  )
  const state = { ...shells }
  for (const request of child_requests) {
    const shell = fields_of(shells[request.world_id])
    state[request.world_id] = {
      ...shell,
      inner: {
        ...fields_of(shell.inner),
        value: fields_of(children[request.field_id]).value ?? null,
      },
    }
  }
  return state
}

export async function fetch_chain_state({
  client,
  selected_legs,
  seeds,
  seed_manifest,
  manifest,
}) {
  const chain_state = { spells: {}, items: {}, worlds: {} }
  if (selected_legs.includes('spells')) {
    const object_ids = required_spell_ids(seeds.spells, seed_manifest)
    chain_state.spells = await get_objects_json(client, object_ids)
  }
  if (selected_legs.includes('items')) {
    const object_ids = required_item_ids(seeds.items, seed_manifest)
    chain_state.items = await fetch_item_state(
      client,
      object_ids,
      manifest.aresrpg.pkg
    )
  }
  if (selected_legs.includes('worlds')) {
    const object_ids = required_world_ids(seeds.worlds, seed_manifest)
    chain_state.worlds = await fetch_world_state(client, object_ids)
  }
  return chain_state
}

function build_effect(transaction, effect, foundation_target) {
  return transaction.moveCall({
    target: `${foundation_target}::spell_effect::new_effect`,
    arguments: [
      transaction.pure.u8(effect.kind),
      transaction.pure.u8(effect.element),
      transaction.pure.u64(effect.value),
      transaction.pure.u8(effect.area_shape),
      transaction.pure.u64(effect.area_size),
      transaction.pure.u8(effect.target_filter),
      transaction.pure.u8(effect.chance),
      transaction.pure.u8(effect.turns),
      transaction.pure.u8(effect.stat),
      transaction.pure.u8(effect.flags),
      transaction.pure.u8(effect.phase),
    ],
  })
}

function build_spell_call(transaction, call, context) {
  const common = [
    transaction.object(context.spells_admin),
    transaction.object(call.object_id),
    transaction.pure.u8(call.level),
  ]
  let payload_arguments
  if (call.function === 'set_level_ap_cost')
    payload_arguments = [transaction.pure.u64(call.payload.ap_cost)]
  else if (call.function === 'set_level_range')
    payload_arguments = [
      transaction.pure.u64(call.payload.range_min),
      transaction.pure.u64(call.payload.range_max),
      transaction.pure.bool(call.payload.modifiable_range),
    ]
  else if (call.function === 'set_level_limits')
    payload_arguments = [
      transaction.pure.u8(call.payload.casts_per_turn),
      transaction.pure.u8(call.payload.casts_per_target),
      transaction.pure.u8(call.payload.cooldown_turns),
      transaction.pure.u64(call.payload.crit_rate),
    ]
  else if (call.function === 'set_level_targeting')
    payload_arguments = [
      transaction.pure.u16(call.payload.min_char_level),
      transaction.pure.bool(call.payload.line_of_sight),
    ]
  else if (call.function === 'set_level_effects') {
    const effects = call.payload.effects.map((effect) =>
      build_effect(transaction, effect, context.foundation_target)
    )
    const critical = call.payload.crit_effects.map((effect) =>
      build_effect(transaction, effect, context.foundation_target)
    )
    payload_arguments = [
      transaction.makeMoveVec({ type: context.effect_type, elements: effects }),
      transaction.makeMoveVec({
        type: context.effect_type,
        elements: critical,
      }),
    ]
  } else throw new Error(`unknown spell setter ${call.function}`)
  transaction.moveCall({
    target: `${call.target}::spell_template::${call.function}`,
    arguments: [
      ...common,
      ...payload_arguments,
      transaction.pure.u64(10),
      transaction.pure.u64(9),
      transaction.object(context.spells_version),
    ],
  })
}

function build_item_call(transaction, call, context) {
  // The door takes two ItemStatistics values now (#1291) instead of 34 loose u16s, so the stat block is built
  // in-PTB by the same `item_stats::new` constructor the Move tests use and threaded in as a result.
  const stat_block = values =>
    transaction.moveCall({
      target: `${call.target}::item_stats::new`,
      arguments: values.map(value => transaction.pure.u16(value)),
    })
  transaction.moveCall({
    target: `${call.target}::admin::set_template_stats`,
    arguments: [
      transaction.object(context.aresrpg_admin),
      transaction.object(call.object_id),
      stat_block(call.payload.mins),
      stat_block(call.payload.maxs),
      transaction.object(context.aresrpg_version),
    ],
  })
}

function build_world_call(transaction, call, context) {
  const common = [
    transaction.object(context.aresrpg_admin),
    transaction.object(call.object_id),
  ]
  let payload_arguments = []
  if (call.function === 'add_resource_entry')
    payload_arguments = [
      transaction.pure.id(call.payload.template_id),
      transaction.pure.u16(call.payload.rate_bp),
      transaction.pure.u16(call.payload.min_qty),
      transaction.pure.u16(call.payload.max_qty),
      transaction.pure.u8(call.payload.job),
      transaction.pure.u8(call.payload.tier),
    ]
  else if (call.function === 'add_mob_entry')
    payload_arguments = [
      transaction.pure.id(call.payload.template_id),
      transaction.pure.u16(call.payload.rate_bp),
      transaction.pure.u16(call.payload.min_group),
      transaction.pure.u16(call.payload.max_group),
    ]
  else if (call.function === 'add_dungeon_room')
    payload_arguments = [transaction.pure.vector('id', call.payload.mob_ids)]
  // `clear_tables` wipes the level vector and the boss mask alongside the tables, so the planner re-emits both
  // after the rows exist. Both take (cap, world, ..payload.., version) — the same shape the adders use.
  else if (call.function === 'set_mob_level')
    payload_arguments = [
      transaction.pure.id(call.payload.template_id),
      transaction.pure.u16(call.payload.level),
    ]
  else if (call.function === 'set_boss_mask')
    payload_arguments = [transaction.pure.vector('u16', call.payload.rows)]
  else if (call.function !== 'clear_tables')
    throw new Error(`unknown world authoring call ${call.function}`)
  transaction.moveCall({
    target: `${call.target}::world::${call.function}`,
    arguments: [
      ...common,
      ...payload_arguments,
      transaction.object(context.aresrpg_version),
    ],
  })
}

export function build_transaction(transaction_plan, context) {
  const transaction = new transaction_class()
  for (const call of transaction_plan.calls) {
    if (call.leg === 'spells') build_spell_call(transaction, call, context)
    else if (call.leg === 'items') build_item_call(transaction, call, context)
    else if (call.leg === 'worlds') build_world_call(transaction, call, context)
    else throw new Error(`unknown reseed leg ${call.leg}`)
  }
  transaction.setGasBudget(fixed_gas_budget_mist)
  return transaction
}

export async function execute_live_transaction({
  client,
  signer,
  transaction_plan,
  context,
}) {
  const transaction = build_transaction(transaction_plan, context)
  const raw = await client.signAndExecuteTransaction({
    signer,
    transaction,
    include: { effects: true, objectTypes: true, events: true },
  })
  const receipt = normalize_receipt(raw)
  if (receipt.digest)
    await client.waitForTransaction({ digest: receipt.digest })
  return {
    digest: receipt.digest,
    status: receipt.effects.status.status,
    error: receipt.effects.status.error,
  }
}
