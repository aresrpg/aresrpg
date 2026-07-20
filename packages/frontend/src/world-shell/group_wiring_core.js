// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GROUP WIRING CORE (MULTICHAR lane) — dependency-injected orchestration between the pure group loop
// (@aresrpg/party group_loop) and the production edges. The reducer DECIDES; this seam FEEDS it (membership,
// worlds, pose ticks, fight facts) and EXECUTES its effect requests through injected single-character seams
// (join_world_action / join_owned_world_fight / the fight store's ctx door). Transactions run on ONE
// sequential queue; an EXECUTED failure (digest exists) latches the member out via `member_blocked` and is
// never re-fired (tx-retry burn law). Production supplies the deps in group_wiring.js; tests drive fakes.

import { create_group_store } from '@aresrpg/party/store'

/** Pure: extract the group-loop fight facts from one memoized engine view (fight_view()). */
export function fight_facts_of(view) {
  if (!view?.fight_id) return null
  return {
    fight_id: view.fight_id,
    placement: !!view.placement,
    over: Number(view.winner ?? -1) !== -1,
    active_entity_id: view.active_entity_id ?? null,
    seated: [...(view.fighters?.keys() ?? [])].filter((id) => !String(id).startsWith('mob-')),
  }
}

/**
 * Pure: turn follow_move rows into the presence entries the remote-player renderer consumes, enriched with
 * the roster card's visual identity (the exact shape the retired owned_follow derivation produced). Rows
 * without a resolved card are skipped — never a fallback-identity ghost.
 * @param {Array<{ character_id: string, x: number, z: number, yaw: number }>} rows
 * @param {Map<string, any>} cards_by_id roster card per character id
 * @param {string | null} leader_world_id
 */
export function build_follow_entries(rows, cards_by_id, leader_world_id) {
  if (!leader_world_id) return []
  return rows.flatMap((row) => {
    const card = cards_by_id.get(row.character_id)
    if (!card) return []
    const target_position = { x: row.x, y: 0, z: row.z }
    return [
      {
        id: row.character_id,
        entry: {
          id: row.character_id,
          name: card.name ?? '',
          classe: card.classe ?? 'senshi',
          male: card.male ?? true,
          color_1: Number(card.color_1 ?? 0),
          color_2: Number(card.color_2 ?? 0),
          color_3: Number(card.color_3 ?? 0),
          position: { ...target_position },
          target_position,
          target_yaw: row.yaw,
          action: 'IDLE',
          owned_follow: true,
        },
        cache_position: { character_id: row.character_id, world_id: leader_world_id, x: row.x, z: row.z },
      },
    ]
  })
}

/**
 * @param {{
 *   join_world: (character_id: string, world_id: string) => Promise<any>,
 *   join_fight: (character_id: string, fight_id: string) => Promise<any>,
 *   focus_seat: (character_id: string) => void,
 *   apply_follow: (rows: readonly any[]) => void,
 *   is_executed_failure: (error: any) => boolean,
 *   log: (message: string, data?: any) => void,
 *   config?: { snap_distance?: number, stuck_ms?: number, arrive_eps?: number },
 * }} deps
 */
export function create_group_wiring(deps) {
  const { store, dispatch } = create_group_store(deps.config ?? {})
  let queue = Promise.resolve()
  let last_turn_entity = /** @type {string | null} */ (null)

  /** Sequential tx lane: one owned-member transaction at a time; a failure latches, never re-fires. */
  const enqueue = (scope, character_id, task) => {
    queue = queue
      .then(task)
      .catch((error) => {
        if (deps.is_executed_failure(error)) {
          dispatch({ kind: 'member_blocked', character_id, scope })
          deps.log(`${scope} EXECUTED failure for ${character_id.slice(0, 10)} — latched, never re-fired`, error)
        } else deps.log(`${scope} failed pre-execution for ${character_id.slice(0, 10)} (no latch)`, error)
      })
      .then(() => undefined)
  }

  /** Execute one outputs frame at the edges. Every branch is idempotent per the reducer's latches. */
  const execute = (outputs) => {
    for (const row of outputs.join_world)
      enqueue('world_join', row.character_id, () => deps.join_world(row.character_id, row.world_id))
    for (const row of outputs.join_fight)
      enqueue('fight_join', row.character_id, () => deps.join_fight(row.character_id, row.fight_id))
    if (outputs.hud_focus) deps.focus_seat(outputs.hud_focus)
    return outputs
  }

  const feed = (input) => execute(dispatch(input))

  return {
    store,
    feed,
    /** Resolves when every enqueued transaction settled — the test/QA drain door. */
    settled: () => queue,
    /** Membership + world truth arrive together (both derive from the same party/roster resync). */
    sync_group({ my_address, leader_character_id, members, worlds }) {
      feed({ kind: 'group', my_address, leader_character_id, members })
      for (const row of worlds ?? []) feed({ kind: 'member_world_state', ...row })
      // no members (party cleared / character switched) → drop any still-rendered followers NOW
      if (!members?.length) deps.apply_follow([])
    },
    /** One throttled leader pose tick → formation rows applied to the presence layer. `blocked` (fight or
     *  dungeon session live) suppresses roaming followers without disturbing the core's other domains. */
    pose_tick(pose, { blocked = false } = {}, now = Date.now()) {
      if (blocked) return deps.apply_follow([])
      const outputs = feed({ kind: 'leader_position', x: pose.x, z: pose.z, yaw: pose.yaw, now })
      deps.apply_follow(outputs.follow_move)
    },
    /** Fold one fight view change: arm/join/focus per the reducer's latches. `join_open` = the chain's join
     *  window is provably open AND this session's joins ride the world-fight seam (never the RunPass path). */
    fight_snapshot(facts, { join_open } = { join_open: false }) {
      if (!facts) {
        if (store.getState().fight) feed({ kind: 'fight_ended' })
        last_turn_entity = null
        return
      }
      if (facts.over) {
        if (store.getState().fight) feed({ kind: 'fight_ended' })
        last_turn_entity = null
        return
      }
      feed({ kind: 'fight_started', fight_id: facts.fight_id, seated: facts.seated, join_open })
      if (facts.active_entity_id && facts.active_entity_id !== last_turn_entity) {
        last_turn_entity = facts.active_entity_id
        feed({ kind: 'turn_started', character_id: facts.active_entity_id })
      }
    },
    reset() {
      feed({ kind: 'reset' })
      last_turn_entity = null
      deps.apply_follow([])
    },
  }
}
