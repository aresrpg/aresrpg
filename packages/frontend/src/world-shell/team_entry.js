// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { ITEM_CATEGORY } from '@aresrpg/sdk/items'

const MAX_PARTY_MEMBERS = 6

const member_character_id = (member) => member?.character_id ?? member?.character ?? member?.id ?? null
const distinct_character_ids = (members) =>
  new Set((Array.isArray(members) ? members : []).map(member_character_id).filter(Boolean))

const eligible_owned_character = (member, my_address, world_id) =>
  member?.owner === my_address && member?.world === world_id && !member?.blocked_reason

function eligible_owned_alt_ids({
  owned_characters,
  party_members,
  my_address,
  active_character_id,
  active_world_id,
  membership,
}) {
  if (!my_address || !active_character_id || !active_world_id) return []
  const rows = Array.isArray(owned_characters) ? owned_characters : []
  const active = rows.find((member) => member_character_id(member) === active_character_id)
  const party_character_ids = distinct_character_ids(party_members)
  if (!eligible_owned_character(active, my_address, active_world_id) || !party_character_ids.has(active_character_id))
    return []

  const selected = []
  const seen = new Set([active_character_id])
  for (const member of rows) {
    const character_id = member_character_id(member)
    if (!character_id || seen.has(character_id)) continue
    seen.add(character_id)
    if (!eligible_owned_character(member, my_address, active_world_id)) continue
    if (membership(party_character_ids, character_id)) selected.push(character_id)
  }
  return selected
}

/** Owned alts that may join the active character's Party without exceeding its six-character chain cap. */
export function select_owned_party_join_ids({
  owned_characters,
  party_members,
  my_address,
  active_character_id,
  active_world_id,
  max_party_size = MAX_PARTY_MEMBERS,
}) {
  const party_character_ids = distinct_character_ids(party_members)
  const available_slots = Math.max(0, Math.floor(Number(max_party_size)) - party_character_ids.size)
  return eligible_owned_alt_ids({
    owned_characters,
    party_members,
    my_address,
    active_character_id,
    active_world_id,
    membership: (party_ids, character_id) => !party_ids.has(character_id),
  }).slice(0, available_slots)
}

/** Rebuild a same-wallet team RunPass map from the `/v1/dungeon-runs` projection on reload. */
export function select_owned_run_pass_ids({ runs, owned_character_ids, world_id, room, fight_id = null }) {
  const owned = new Set(Array.isArray(owned_character_ids) ? owned_character_ids.filter(Boolean) : [])
  const selected = {}
  for (const run of Array.isArray(runs) ? runs : []) {
    const character_id = run?.character ?? run?.character_id ?? null
    const pass_id = run?.pass_id ?? run?.pass ?? null
    const run_fight_id = run?.fight_id ?? run?.fight ?? null
    if (
      !character_id ||
      !pass_id ||
      !owned.has(character_id) ||
      run?.world !== world_id ||
      Number(run?.room) !== Number(room) ||
      String(run_fight_id ?? '') !== String(fight_id ?? '') ||
      selected[character_id]
    )
      continue
    selected[character_id] = pass_id
    if (Object.keys(selected).length === MAX_PARTY_MEMBERS) break
  }
  return selected
}

/** Exact-character RunPass bound to one fight; same-wallet sibling passes must never be substituted. */
export function character_run_pass_id(runs, fight_id, character_id) {
  const run = (Array.isArray(runs) ? runs : []).find(
    (row) =>
      (row?.character ?? row?.character_id) === character_id &&
      String(row?.fight_id ?? row?.fight ?? '') === String(fight_id ?? '')
  )
  return run?.pass_id ?? run?.pass ?? null
}

/**
 * Owned-only entry eligibility with a separate blocked verdict. Missing identity, another world, or an explicit
 * lock blocks the team action instead of silently shrinking it; non-owned members remain untouched.
 */
export function owned_team_entry_eligibility({ members, my_address, leader_character_id, leader_world_id }) {
  if (!my_address || !leader_character_id || !leader_world_id)
    return { eligible_character_ids: [], blocked_owned_members: [] }

  const rows = members ?? []
  const leader = rows.find(
    (member) => member_character_id(member) === leader_character_id && member?.owner === my_address
  )
  if (!leader)
    return {
      eligible_character_ids: [],
      blocked_owned_members: [],
    }
  if (leader.world !== leader_world_id || leader.blocked_reason)
    return {
      eligible_character_ids: [],
      blocked_owned_members: [leader],
    }

  const eligible_character_ids = [leader_character_id]
  const blocked_owned_members = []
  const seen = new Set([leader_character_id])
  for (const member of rows) {
    if (member?.owner !== my_address) continue
    const character_id = member_character_id(member)
    if (!character_id) {
      blocked_owned_members.push(member)
      continue
    }
    if (seen.has(character_id)) continue
    seen.add(character_id)
    if (member.world !== leader_world_id || member.blocked_reason) {
      blocked_owned_members.push(member)
      continue
    }
    if (eligible_character_ids.length < 6) eligible_character_ids.push(character_id)
  }
  return { eligible_character_ids, blocked_owned_members }
}

export function required_team_key_count(input) {
  return owned_team_entry_eligibility(input).eligible_character_ids.length
}

/**
 * Key stacks the activation ABI can consume one unit at a time through `extract_one_for_burn`.
 * @param {any[]} items
 * @returns {any[]}
 */
export function usable_team_entry_keys(items) {
  return (Array.isArray(items) ? items : []).filter(
    (item) =>
      item?.item_category === ITEM_CATEGORY.KEY &&
      Number.isFinite(Number(item.amount ?? 1)) &&
      Math.floor(Number(item.amount ?? 1)) >= 1 &&
      item.id &&
      item.kiosk_id &&
      item.kiosk_cap_id
  )
}

/** @param {any[]} items @param {number} required */
export function has_team_entry_keys(items, required) {
  const units = usable_team_entry_keys(items).reduce((total, item) => total + Math.floor(Number(item.amount ?? 1)), 0)
  return required > 0 && units >= required
}

/** Assign one real key unit to each distinct character without collapsing character identities. */
export function assign_team_entry_keys(character_ids, items) {
  const remaining_characters = [...new Set((Array.isArray(character_ids) ? character_ids : []).filter(Boolean))]
  const assignments = []
  let character_index = 0
  for (const item of usable_team_entry_keys(items)) {
    const units = Math.floor(Number(item.amount ?? 1))
    for (let unit = 0; unit < units && character_index < remaining_characters.length; unit += 1) {
      assignments.push({
        character_id: remaining_characters[character_index],
        key_item_id: item.id,
        key_kiosk_id: item.kiosk_id,
        key_kiosk_cap_id: item.kiosk_cap_id,
      })
      character_index += 1
    }
    if (character_index === remaining_characters.length) break
  }
  return assignments
}

export function derive_team_entry_plan(input, items) {
  const eligibility = owned_team_entry_eligibility(input)
  const required_keys = eligibility.eligible_character_ids.length
  const key_assignments = assign_team_entry_keys(eligibility.eligible_character_ids, items)
  return {
    ...eligibility,
    required_keys,
    usable_keys: usable_team_entry_keys(items),
    key_assignments,
    can_enter: eligibility.blocked_owned_members.length === 0 && key_assignments.length === required_keys,
  }
}
