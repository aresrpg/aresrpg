// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure planning core for reseed_driver.mjs. No client, signer, filesystem, or transaction imports live here:
// fixture tests can prove every diff, batch, DRY_RUN guard, and failure-latch rule without network access.
import { encode_effect_value } from './spell_wire.mjs'

export const fixed_gas_budget_mist = 50_000_000
export const max_ptb_commands = 30
export const stat_fields = [
  'vitality',
  'wisdom',
  'strength',
  'intelligence',
  'chance',
  'agility',
  'range',
  'movement',
  'action',
  'critical',
  'raw_damage',
  'critical_chance',
  'critical_outcomes',
  'earth_resistance',
  'fire_resistance',
  'water_resistance',
  'air_resistance',
]

const shift_u16 = 32_768
const kind_phase = { 20: 1, 21: 1 }
// min_char_level + line_of_sight gained an additive setter facet (set_level_targeting, 2026-07-15
// train) — they are TUNABLE now and live in the drift planner below, not here.
const unsupported_spell_fields = [
  'line_launch',
  'free_cell',
  'ends_turn_on_fail',
  'required_states',
  'forbidden_states',
]

const fields_of = (value) => value?.fields ?? value ?? {}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const as_number = (value) => Number(value ?? 0)
const as_integer = (value) => BigInt(value ?? 0).toString()
export const call_package = (entry) => entry?.latest ?? entry?.pkg
export const spell_row_key = (row) => `${row.classType}:${row.unlock}:${row.id}`

export function resolve_mode(environment) {
  const live_value = environment.LIVE
  const dry_value = environment.DRY_RUN
  if (live_value && live_value !== '1')
    throw new Error(`LIVE must be exactly 1 when set (got ${JSON.stringify(live_value)})`)
  if (live_value === '1' && dry_value === '1') throw new Error('LIVE=1 conflicts with DRY_RUN=1')
  if (live_value !== '1' && dry_value === '0') throw new Error('DRY_RUN=0 requires explicit LIVE=1')
  return { live: live_value === '1', dry_run: live_value !== '1' }
}

export function normalize_seed_effect(effect) {
  const kind = as_number(effect.kind)
  // value/flags ride spell_wire.mjs's encode_effect_value (#1250 — CENTERED for alter_stat/alter_resist,
  // magnitude passthrough otherwise) — the ONE home every new_effect PTB encoder shares.
  const { value, flags } = encode_effect_value(kind, as_number(effect.value), as_number(effect.flags ?? 0))
  return {
    kind,
    element: as_number(effect.element ?? 255),
    value: String(value),
    area_shape: as_number(effect.area_shape ?? effect.zone?.shape ?? 0),
    area_size: as_integer(effect.area_size ?? effect.zone?.size ?? 0),
    target_filter: as_number(effect.target_filter ?? 0),
    chance: as_number(effect.chance ?? 100),
    turns: as_number(effect.turns ?? 0),
    stat: as_number(effect.stat ?? 0),
    flags,
    phase: kind_phase[kind] ?? 0,
  }
}

export function normalize_chain_effect(effect) {
  const value = fields_of(effect)
  return {
    kind: as_number(value.kind),
    element: as_number(value.element),
    value: as_integer(value.value),
    area_shape: as_number(value.area_shape),
    area_size: as_integer(value.area_size),
    target_filter: as_number(value.target_filter),
    chance: as_number(value.chance),
    turns: as_number(value.turns),
    stat: as_number(value.stat),
    flags: as_number(value.flags),
    phase: as_number(value.phase),
  }
}

export function normalize_seed_spell_level(level) {
  return {
    min_char_level: as_number(level.min_char_level),
    ap_cost: as_integer(level.ap_cost),
    range_min: as_integer(level.range_min),
    range_max: as_integer(level.range_max),
    modifiable_range: Boolean(level.modifiable_range),
    line_launch: Boolean(level.line_launch),
    line_of_sight: level.line_of_sight !== false,
    free_cell: Boolean(level.free_cell),
    casts_per_turn: as_number(level.casts_per_turn ?? 255),
    casts_per_target: as_number(level.casts_per_target ?? 255),
    cooldown_turns: as_number(level.cooldown_turns ?? 0),
    crit_rate: as_integer(level.crit_rate ?? 0),
    ends_turn_on_fail: Boolean(level.ends_turn_on_fail),
    required_states: (level.required_states ?? []).map(as_number),
    forbidden_states: (level.forbidden_states ?? []).map(as_number),
    effects: (level.effects ?? []).map(normalize_seed_effect),
    crit_effects: (level.crit_effects ?? []).map(normalize_seed_effect),
  }
}

export function normalize_chain_spell_level(level) {
  const value = fields_of(level)
  return {
    min_char_level: as_number(value.min_char_level),
    ap_cost: as_integer(value.ap_cost),
    range_min: as_integer(value.range_min),
    range_max: as_integer(value.range_max),
    modifiable_range: Boolean(value.modifiable_range),
    line_launch: Boolean(value.line_launch),
    line_of_sight: Boolean(value.line_of_sight),
    free_cell: Boolean(value.free_cell),
    casts_per_turn: as_number(value.casts_per_turn),
    casts_per_target: as_number(value.casts_per_target),
    cooldown_turns: as_number(value.cooldown_turns),
    crit_rate: as_integer(value.crit_rate),
    ends_turn_on_fail: Boolean(value.ends_turn_on_fail),
    required_states: (value.required_states ?? []).map(as_number),
    forbidden_states: (value.forbidden_states ?? []).map(as_number),
    effects: (value.effects ?? []).map(normalize_chain_effect),
    crit_effects: (value.crit_effects ?? []).map(normalize_chain_effect),
  }
}

function batch_calls(leg, calls) {
  const transactions = []
  let pending = []
  let weight = 0
  for (const call of calls) {
    if (call.command_weight > max_ptb_commands)
      throw new Error(`${call.summary}: ${call.command_weight} PTB commands exceeds ${max_ptb_commands}`)
    if (pending.length && weight + call.command_weight > max_ptb_commands) {
      transactions.push({
        leg,
        calls: pending,
        call_count: pending.length,
        ptb_command_count: weight,
      })
      pending = []
      weight = 0
    }
    pending.push(call)
    weight += call.command_weight
  }
  if (pending.length)
    transactions.push({
      leg,
      calls: pending,
      call_count: pending.length,
      ptb_command_count: weight,
    })
  return transactions.map((transaction, index) => ({
    ...transaction,
    label: `${leg}:${index + 1}/${transactions.length}`,
  }))
}

function spell_call(base, function_name, payload, command_weight = 1) {
  return {
    ...base,
    function: function_name,
    payload,
    command_weight,
    summary: `${base.row_key} L${base.level} ${function_name}`,
  }
}

export function build_spell_leg({ seed_rows, seed_manifest, chain_state, targets }) {
  const calls = []
  const blockers = []
  let rows_drifted = 0
  let levels_drifted = 0
  const seen = new Set()

  for (const row of seed_rows) {
    const row_key = spell_row_key(row)
    if (seen.has(row_key)) {
      blockers.push(`spell ${row_key}: duplicate seed identity`)
      continue
    }
    seen.add(row_key)
    const object_id = seed_manifest.spells?.[row_key]?.id
    if (!object_id) {
      blockers.push(`spell ${row_key}: no object id in seed_manifest.spells`)
      continue
    }
    const chain = fields_of(chain_state[object_id])
    if (!chain_state[object_id]) {
      blockers.push(`spell ${row_key}: object ${object_id} unreadable`)
      continue
    }
    const identity = [String(chain.class), as_number(chain.unlock_level), String(chain.name)]
    const expected_identity = [String(row.classType), as_number(row.unlock), String(row.id)]
    if (!same(identity, expected_identity)) {
      blockers.push(
        `spell ${row_key}: object identity ${JSON.stringify(identity)} != ${JSON.stringify(expected_identity)}`
      )
      continue
    }
    if (
      !Array.isArray(row.levels) ||
      row.levels.length !== 6 ||
      !Array.isArray(chain.levels) ||
      chain.levels.length !== 6
    ) {
      blockers.push(`spell ${row_key}: expected six seed and chain levels`)
      continue
    }

    const row_calls = []
    const row_unsupported = []
    let row_has_drift = false
    row.levels.forEach((seed_level, level_index) => {
      const desired = normalize_seed_spell_level(seed_level)
      const current = normalize_chain_spell_level(chain.levels[level_index])
      const level = level_index + 1
      const base = {
        leg: 'spells',
        target: targets.spells,
        row_key,
        object_id,
        level,
      }
      const unsupported = unsupported_spell_fields.filter((field) => !same(desired[field], current[field]))
      if (unsupported.length) row_unsupported.push(`L${level} ${unsupported.join(',')}`)

      const level_calls = []
      if (desired.ap_cost !== current.ap_cost)
        level_calls.push(spell_call(base, 'set_level_ap_cost', { ap_cost: desired.ap_cost }))
      if (
        !same(
          [desired.range_min, desired.range_max, desired.modifiable_range],
          [current.range_min, current.range_max, current.modifiable_range]
        )
      )
        level_calls.push(
          spell_call(base, 'set_level_range', {
            range_min: desired.range_min,
            range_max: desired.range_max,
            modifiable_range: desired.modifiable_range,
          })
        )
      if (
        !same(
          [desired.casts_per_turn, desired.casts_per_target, desired.cooldown_turns, desired.crit_rate],
          [current.casts_per_turn, current.casts_per_target, current.cooldown_turns, current.crit_rate]
        )
      )
        level_calls.push(
          spell_call(base, 'set_level_limits', {
            casts_per_turn: desired.casts_per_turn,
            casts_per_target: desired.casts_per_target,
            cooldown_turns: desired.cooldown_turns,
            crit_rate: desired.crit_rate,
          })
        )
      if (!same([desired.min_char_level, desired.line_of_sight], [current.min_char_level, current.line_of_sight]))
        level_calls.push(
          spell_call(base, 'set_level_targeting', {
            min_char_level: desired.min_char_level,
            line_of_sight: desired.line_of_sight,
          })
        )
      if (!same([desired.effects, desired.crit_effects], [current.effects, current.crit_effects])) {
        const effect_commands = desired.effects.length + desired.crit_effects.length + 3
        level_calls.push(
          spell_call(
            base,
            'set_level_effects',
            {
              effects: desired.effects,
              crit_effects: desired.crit_effects,
            },
            effect_commands
          )
        )
      }
      if (level_calls.length || unsupported.length) {
        row_has_drift = true
        levels_drifted += 1
      }
      row_calls.push(...level_calls)
    })
    if (row_has_drift) rows_drifted += 1
    if (row_unsupported.length) blockers.push(`spell ${row_key}: no additive setter for ${row_unsupported.join('; ')}`)
    else calls.push(...row_calls)
  }

  const transactions = batch_calls('spells', calls)
  return {
    seed_rows: seed_rows.length,
    rows_drifted,
    levels_drifted,
    call_count: calls.length,
    tx_count: transactions.length,
    blockers,
    transactions,
  }
}

function centered_stats(stats) {
  return stat_fields.map((field) => {
    const centered = shift_u16 + as_number(stats?.[field] ?? 0)
    if (!Number.isInteger(centered) || centered < 0 || centered > 65_535)
      throw new Error(`${field}: centered stat ${centered} is outside u16`)
    return centered
  })
}

function chain_stats(stats) {
  if (!stats) return null
  const value = fields_of(stats)
  return stat_fields.map((field) => as_number(value[field]))
}

export function build_item_leg({ seed_rows, seed_manifest, chain_state, target }) {
  const calls = []
  const blockers = []
  let rows_drifted = 0
  const seen = new Set()
  const authored_rows = seed_rows.filter((row) => row?.stats?.min && row?.stats?.max)

  for (const row of authored_rows) {
    if (seen.has(row.slug)) {
      blockers.push(`item ${row.slug}: duplicate seed slug`)
      continue
    }
    seen.add(row.slug)
    const object_id = seed_manifest.items?.[row.slug]
    if (!object_id) {
      blockers.push(`item ${row.slug}: no object id in seed_manifest.items`)
      continue
    }
    const current = chain_state[object_id]
    if (!current?.template) {
      blockers.push(`item ${row.slug}: template ${object_id} unreadable`)
      continue
    }
    if ((current.stats_min == null) !== (current.stats_max == null)) {
      blockers.push(`item ${row.slug}: only one of StatsMinKey/StatsMaxKey exists`)
      continue
    }
    try {
      const mins = centered_stats(row.stats.min)
      const maxs = centered_stats(row.stats.max)
      const current_mins = chain_stats(current.stats_min)
      const current_maxs = chain_stats(current.stats_max)
      if (!same([mins, maxs], [current_mins, current_maxs])) {
        rows_drifted += 1
        calls.push({
          leg: 'items',
          target,
          function: 'set_template_stats',
          row_key: row.slug,
          object_id,
          payload: { mins, maxs },
          // 3 PTB commands since #1291: item_stats::new twice, then the door itself
          command_weight: 3,
          summary: `${row.slug} set_template_stats`,
        })
      }
    } catch (error) {
      blockers.push(`item ${row.slug}: ${error.message}`)
    }
  }

  const transactions = batch_calls('items', calls)
  return {
    seed_rows: authored_rows.length,
    rows_drifted,
    call_count: calls.length,
    tx_count: transactions.length,
    blockers,
    transactions,
  }
}

export async function execute_transactions(transactions, { live, execute_transaction }) {
  if (!live) return { executed: 0, failure_latch: null }
  let executed = 0
  let failure_latch = null
  for (const transaction of transactions) {
    if (failure_latch) throw new Error(`failure latch already set at ${failure_latch}`)
    let result
    try {
      result = await execute_transaction(transaction)
    } catch (error) {
      failure_latch = error.digest ?? `before-digest:${transaction.label}`
      throw error
    }
    executed += 1
    if (result.status !== 'success') {
      failure_latch = result.digest || `missing-digest:${transaction.label}`
      const error = new Error(
        `${transaction.label} EXECUTED FAILURE digest=${failure_latch}: ${result.error ?? 'unknown'}`
      )
      error.digest = failure_latch
      throw error
    }
  }
  return { executed, failure_latch }
}
