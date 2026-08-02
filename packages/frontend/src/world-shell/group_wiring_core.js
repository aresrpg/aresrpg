// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GROUP WIRING CORE (MULTICHAR lane) — dependency-injected orchestration between the pure group loop
// (@aresrpg/party group_loop) and the production edges. The reducer DECIDES; this seam FEEDS it (membership,
// worlds, pose ticks, fight facts) and EXECUTES its effect requests through injected single-character seams
// (join_world_action / join_owned_world_fight / the fight store's ctx door). Transactions opt into the ONE
// shared character-action queue in tx.js; an EXECUTED failure (digest exists) latches the member out via
// `member_blocked` and is never re-fired (tx-retry burn law). Production supplies the deps; tests drive fakes.

import { create_group_store } from '@aresrpg/party/store'

import i18n from '../i18n'
import { humanize_tx_error } from '../game/core/abort_copy.js'

import { error_executed_digest } from './tx_digest_error.js'

/**
 * #614 — name a FOLLOWER's fight-entry refusal. `join_fight` only ever seats OWNED ALTS (group_loop.js's
 * `owned_alts` excludes the leader by construction), so every refusal this door raises is about a character
 * OTHER than whoever the player is actively engaging — the generic "you have…" copy reads as if it's about
 * THEM. Wrap it so the toast says WHO, not just why. `humanize` supplies the reason: it stays the ONE table
 * of honest per-abort-code copy (abort_copy.js) — this never collapses two distinct refusals into one line,
 * it only prefixes whichever line the table already picked with the acting alt's name. The executed-tx
 * digest (burn-law latch — group_wiring_core's own `track()` reads it via `is_executed_failure`) is copied
 * onto the new error unmodified; a pre-flight refusal (no gas spent) carries none, same as the original.
 * @param {unknown} error @param {string|null} character_name
 * @param {{ humanize?: (error: unknown) => string, translate?: (key: string, opts?: any) => string }} [deps]
 * @returns {Error}
 */
export function name_alt_fight_refusal(
  error,
  character_name,
  { humanize = humanize_tx_error, translate = (key, opts) => i18n.t(key, opts) } = {}
) {
  const reason = humanize(error)
  const message = character_name ? translate('fights.alt_entry_refused', { character: character_name, reason }) : reason
  const named = new Error(message)
  const digest = error_executed_digest(error)
  if (digest) named.digest = digest
  return named
}

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
    const spawn = { x: row.x, y: 0, z: row.z }
    // #613 — a with_you follower is a FREE-RUN companion: it carries the pet_follow consumer contract (the
    // leader `follow_anchor` step_pet_follow steers toward). Its spawn seed is the alt's real read/arrival
    // position (steer in from there — never a teleport onto the leader), while target_position rides the anchor
    // so the renderer's range gate keeps it beside the leader (always present, never range-despawned). An
    // in_transit flight row has no anchor: it stays a timer-projected target the renderer eases toward.
    const target_position = row.free_run && row.anchor ? { x: row.anchor.x, y: 0, z: row.anchor.z } : spawn
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
          position: { ...spawn },
          target_position,
          target_yaw: row.yaw,
          action: 'IDLE',
          owned_follow: true,
          free_run: !!row.free_run,
          follow_anchor: row.anchor ? { x: row.anchor.x, z: row.anchor.z, yaw: row.anchor.yaw } : null,
        },
        cache_position: { character_id: row.character_id, world_id: leader_world_id, x: row.x, z: row.z },
      },
    ]
  })
}

/**
 * Pure: WHICH character↔world rows the group loop reconciles against — the leader, its group members and the
 * live follower set, each resolved through `resolve_world` (THE binding book) at decision time. The roster
 * card's `world_id` is a cached snapshot, so it is never the source here (#2007): a leader whose join receipt
 * already settled must not send its followers through a stale-world join. An unknown binding reads as
 * unbound; the set is scoped to the group so no unrelated roster character lands in the loop's mirror.
 * @param {(character_id: string) => string | null | undefined} resolve_world
 * @param {{ leader_character_id: string|null, members: Array<{ character: string }>, follower_character_ids: readonly string[] }} scope
 */
export function group_world_rows(resolve_world, { leader_character_id, members, follower_character_ids }) {
  const ids = [
    leader_character_id,
    ...(members ?? []).map((member) => member?.character),
    ...(follower_character_ids ?? []),
  ]
  return [...new Set(ids.filter(Boolean))].map((character_id) => ({
    character_id,
    world_id: resolve_world(character_id) ?? null,
  }))
}

/**
 * @param {{
 *   join_world: (character_id: string, world_id: string, options: { queued: boolean }) => Promise<any>,
 *   read_checkpoint: (character_id: string, world_id: string) => Promise<{x:number,z:number}|null>|{x:number,z:number}|null,
 *   write_checkpoint: (character_id: string, world_id: string, position: {x:number,z:number}) => Promise<any>,
 *   join_fight: (character_id: string, fight_id: string, options: { queued: boolean }) => Promise<any>,
 *   dragon_fly: (character_id: string, world_id: string, target: {x:number,z:number}) => Promise<any>,
 *   focus_seat: (character_id: string) => void,
 *   apply_follow: (rows: readonly any[]) => void,
 *   is_executed_failure: (error: any) => boolean,
 *   log: (message: string, data?: any) => void,
 * }} deps
 */
export function create_group_wiring(deps) {
  const { store, dispatch } = create_group_store()
  const pending = new Set()
  let last_turn_entity = /** @type {string | null} */ (null)

  /** Track work queued at tx.js without becoming a second lock; an executed failure latches, never re-fires. */
  const track = (scope, character_id, task) => {
    const running = Promise.resolve()
      .then(task)
      .catch((error) => {
        if (deps.is_executed_failure(error)) {
          dispatch({ kind: 'member_blocked', character_id, scope })
          deps.log(`${scope} EXECUTED failure for ${character_id.slice(0, 10)} — latched, never re-fired`, error)
        } else deps.log(`${scope} failed pre-execution for ${character_id.slice(0, 10)} (no latch)`, error)
      })
      .then(() => undefined)
    pending.add(running)
    void running.then(() => pending.delete(running))
  }

  /** Execute one outputs frame at the edges. Every branch is idempotent per the reducer's latches. */
  const execute = (outputs) => {
    for (const row of outputs.join_world)
      track('world_join', row.character_id, async () => {
        await deps.join_world(row.character_id, row.world_id, { queued: true })
        feed({
          kind: 'follow_world_joined',
          character_id: row.character_id,
          world_id: row.world_id,
          checkpoint: await deps.read_checkpoint(row.character_id, row.world_id),
          now: Date.now(),
        })
      })
    // #613 — SAME-WORLD entry: read chain truth ONLY (no world-join tx — that redundant same-world join executes
    // and burns sponsor gas). The checkpoint settles the follower NEAR → with_you or FAR → the in-world catch-up
    // flight inside the reducer. A pure read, so it never latches member_blocked on failure (no gas at stake).
    for (const row of outputs.read_position)
      track('follow_position', row.character_id, async () => {
        const position = await deps.read_checkpoint(row.character_id, row.world_id)
        feed({ kind: 'follow_position_read', character_id: row.character_id, position, now: Date.now() })
      })
    for (const row of outputs.write_checkpoint)
      track('follow_checkpoint', row.character_id, async () => {
        await deps.write_checkpoint(row.character_id, row.world_id, row.position)
        feed({ kind: 'follow_checkpoint_written', character_id: row.character_id })
      })
    for (const row of outputs.join_fight)
      track('fight_join', row.character_id, () => deps.join_fight(row.character_id, row.fight_id, { queued: true }))
    // DRAGON CATCH-UP (#509 §3): fly a far follower to the leader via the EXISTING fast-travel flow (keyed by
    // this follower). When the flight lands, follow_dragon_arrived re-enters as an input — the follower seats
    // beside the leader (its run-in timer is superseded). Switching to it mid-flight shows the pilot flying it.
    for (const row of outputs.fast_travel)
      track('dragon', row.character_id, async () => {
        await deps.dragon_fly(row.character_id, row.world_id, { x: row.x, z: row.z })
        feed({ kind: 'follow_dragon_arrived', character_id: row.character_id })
      })
    if (outputs.hud_focus) deps.focus_seat(outputs.hud_focus)
    // follow_render is null on frames that didn't recompute it; an ARRAY (even empty) is a live render set —
    // apply it so an all-out-of-range or last-follower-removed frame despawns the rigs it no longer names.
    if (outputs.follow_render != null) deps.apply_follow(outputs.follow_render)
    return outputs
  }

  const feed = (input) => execute(dispatch(input))

  return {
    store,
    feed,
    /** Resolves when every transaction handed to the shared queue settled — the test/QA drain door. */
    async settled() {
      while (pending.size) await Promise.all(pending)
    },
    /** Membership + world truth arrive together, then GROUP MEMBERSHIP IS AUTO-FOLLOW (#613 DESIGN COLLAPSE):
     *  reconcile the follower set to the owned group members behind the driven leader. No toggle exists — invite
     *  (a new member) arms it, a kick (a removed member) drops it. Party truth, immune to the toggle desync. */
    sync_group({ my_address, leader_character_id, members, worlds }) {
      feed({ kind: 'group', my_address, leader_character_id, members })
      const now = Date.now()
      for (const row of worlds ?? []) feed({ kind: 'member_world_state', ...row, now })
      return feed({ kind: 'follow_reconcile', leader_character_id, now })
    },
    /** One throttled avatar pose tick. A non-leader active avatar is ignored by the reducer. */
    pose_tick(pose, { character_id = null } = {}, now = Date.now()) {
      // #496 — anchor the formation to the leader AVATAR's heading (facing_yaw), never the camera azimuth
      // (pose.yaw = cam.get_yaw()). Fallback to pose.yaw only when facing_yaw is absent (pre-motion frame).
      const yaw = Number.isFinite(pose.facing_yaw) ? pose.facing_yaw : pose.yaw
      return feed({ kind: 'leader_position', character_id, x: pose.x, z: pose.z, yaw, now })
    },
    /** The timer owns no state: every cadence re-enters through the reducer input door. */
    transit_tick(now = Date.now()) {
      return feed({ kind: 'transit_tick', now })
    },
    /** Dungeon presentation is orthogonal; only the reducer's background modifier changes. */
    dungeon_snapshot(active) {
      const outputs = feed({ kind: 'follow_background', active })
      if (active) deps.apply_follow([])
      return outputs
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
