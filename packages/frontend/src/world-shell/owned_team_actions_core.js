// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
const member_character_id = (member) => (typeof member === 'string' ? member : member?.character_id)

const annotate_owned_failure = (error, character_id) => {
  if (error && typeof error === 'object')
    try {
      error.owned_character_id = character_id
      return error
    } catch {
      /* wrap frozen errors below; their digest remains discoverable through cause */
    }
  return Object.assign(new Error(String(error?.message ?? error), { cause: error }), {
    owned_character_id: character_id,
  })
}

function distinct_members(members) {
  const selected = []
  const seen = new Set()
  for (const member of Array.isArray(members) ? members : []) {
    const character_id = member_character_id(member)
    if (!character_id || seen.has(character_id)) continue
    seen.add(character_id)
    selected.push(typeof member === 'string' ? { character_id } : member)
  }
  return selected
}

/** Dependency-injected sequential orchestration; production supplies the existing self-pay character actions. */
export function create_owned_team_actions({ join_world_fight, activate_run, join_room_fight, settle_run_and_open }) {
  async function join_owned_world_fight({ fight_id, party_id = null, members = [] }) {
    const receipts_by_character = new Map()
    for (const member of distinct_members(members)) {
      const receipt = await join_world_fight({
        fight_id,
        character_id: member.character_id,
        party_id,
        raised_spell_ids: member.raised_spell_ids ?? [],
      })
      receipts_by_character.set(member.character_id, receipt)
    }
    return receipts_by_character
  }

  async function activate_owned_dungeon_runs({ world_id, assignments = [], on_activated }) {
    const receipts_by_character = new Map()
    const run_pass_ids_by_character = new Map()
    for (const assignment of distinct_members(assignments)) {
      let result
      try {
        result = await activate_run({
          world_id,
          character_id: assignment.character_id,
          key_item_id: assignment.key_item_id,
          key_kiosk_id: assignment.key_kiosk_id,
          key_kiosk_cap_id: assignment.key_kiosk_cap_id,
        })
      } catch (error) {
        throw annotate_owned_failure(error, assignment.character_id)
      }
      receipts_by_character.set(assignment.character_id, result.receipt)
      run_pass_ids_by_character.set(assignment.character_id, result.run_pass_id)
      await on_activated?.(assignment.character_id, result)
    }
    return { receipts_by_character, run_pass_ids_by_character }
  }

  async function join_owned_dungeon_room_fight({ fight_id, creator_pass_id, members = [] }) {
    const receipts_by_character = new Map()
    for (const member of distinct_members(members)) {
      const receipt = await join_room_fight({
        fight_id,
        creator_pass_id,
        run_pass_id: member.run_pass_id,
        character_id: member.character_id,
        raised_spell_ids: member.raised_spell_ids ?? [],
      })
      receipts_by_character.set(member.character_id, receipt)
    }
    return receipts_by_character
  }

  async function settle_owned_dungeon_runs({
    world_id,
    leader_character_id,
    run_pass_ids_by_character = {},
    outcome_ids_by_character = new Map(),
    on_settled,
  }) {
    const passes =
      run_pass_ids_by_character instanceof Map
        ? [...run_pass_ids_by_character]
        : Object.entries(run_pass_ids_by_character ?? {})
    const outcome_of = (character_id) =>
      outcome_ids_by_character instanceof Map
        ? outcome_ids_by_character.get(character_id)
        : outcome_ids_by_character?.[character_id]
    const pending = passes
      .filter(([character_id]) => character_id && character_id !== leader_character_id)
      .map(([character_id, run_pass_id]) => ({ character_id, run_pass_id, outcome_id: outcome_of(character_id) }))

    // Validate the whole confirmed receipt before spending any alt gas. A missing event blocks the room boundary;
    // it never permits a partial blind settle or fabricates an outcome object id.
    if (!settle_run_and_open || pending.some((row) => !row.run_pass_id || !row.outcome_id))
      throw new Error('owned dungeon settlement receipt is incomplete')

    const opened_by_character = new Map()
    for (const row of pending) {
      const opened = await settle_run_and_open({ world_id, ...row })
      opened_by_character.set(row.character_id, opened)
      await on_settled?.(row.character_id, opened)
    }
    return opened_by_character
  }

  return {
    join_owned_world_fight,
    activate_owned_dungeon_runs,
    join_owned_dungeon_room_fight,
    settle_owned_dungeon_runs,
  }
}
