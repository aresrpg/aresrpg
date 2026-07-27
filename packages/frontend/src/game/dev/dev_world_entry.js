// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DEV-ONLY WORLD-ENTRY SEAM (#1100 coop, #1184 search leg) — the second seat's door and the scouting doors,
// and the reason they are their OWN module.
//
// WHY NOT IN dev_bot_seam.js. That module is registered by BOTH surfaces (the simulator's dev_seams.js and the
// world HUD), which is exactly what makes one bot drive both. Putting a JOIN door there imported the world's
// chain entry — `world_fight.js`, `dungeon_actions.js`, `fight_engage.js` — into the SIMULATOR's module
// closure, and scripts/zero-drift-gate.mjs reds that on sight: its world-only ratchet is one row, the chain
// entry, and "it must stay one". The gate is right. The simulator is the fight engine on mocked receipts and
// must not be able to reach a transaction composer at all, not even through a door it never calls.
//
// So this file is WORLD-ONLY BY CONSTRUCTION: nothing the simulator loads may ever import it.
//
// REGISTRATION. The world registers its DEV seams from GameWorldHud's mount effect, beside dev_cast /
// dev_probe / dev_synth_fight / dev_bot_seam:
//
//     import('../../../dev/dev_world_entry.js').then((m) => {
//       if (!cleared) m.register_dev_world_entry()
//     })
//
// Same DEV gate, same dynamic import, same tree-shake, and the `__ARES_DEV_` name keeps it fenced out of every
// production bundle by scripts/assert_clean_bundle.mjs.

import { zone_of_world } from '@aresrpg/sdk/coords'
import { zone_row_of, zone_searchable } from '@aresrpg/world/spawns_reconcile'

import { use_dungeon } from '../../world-shell/dungeon_store.js'
import { use_prompt_stack } from '../../world-shell/prompt_stack.js'
import { spawns_store } from '../../world-shell/spawns_adapter.js'
import { context } from '../store.js'

/**
 * window.__ARES_DEV_WORLD_JOIN(fight_id) — seat MY selected character in an OPEN PUBLIC world fight and mount
 * it. Every leg is the production one, in the production order (FightsModal's `on_join`, world branch): the
 * entry reducer wraps the join tx, one settlement recovery is allowed for the first refusal, and the join
 * receipt itself is what authorises the mount. `party_id` is null on purpose — a public fight discards it.
 *
 * This is what makes a COOP bot possible at all: the creator's door (`__dev_start_world_fight`,
 * embed_voxel_dev.js) seats exactly one character, and a second seat has no headless door anywhere else.
 * @param {string} fight_id the Fight object id the creator's engage published
 * @returns {Promise<{ ok: boolean, error?: string, fight_id?: string, status?: number|null }>}
 */
async function dev_world_join(fight_id) {
  if (!fight_id) return { ok: false, error: 'join needs the fight object id' }
  const character_id = context.get_state().selected_character_id
  if (!character_id) return { ok: false, error: 'no selected character' }
  const [
    { join_world_fight },
    { enter_world_fight },
    { enter_after_world_join_receipt },
    { run_fight_entry },
    { recover_fight_entry_refusal },
  ] = await Promise.all([
    import('../../world-shell/dungeon_actions.js'),
    import('../../world-shell/world_fight.js'),
    import('../../world-shell/world_fight_receipt.js'),
    import('../fight_engage.js'),
    import('../../world-shell/dungeon_settlement.js'),
  ])
  // A stale session owns the shared store until it is dropped, and `enter_world_fight` refuses to stomp one.
  if (use_dungeon.getState().fight_id || use_dungeon.getState().run_pass_id) use_dungeon.getState().reset_local()
  try {
    await enter_after_world_join_receipt({
      execute: () =>
        run_fight_entry({
          submit: () => join_world_fight({ fight_id, character_id, party_id: null }),
          // The first refusal may be an unopened FightResult from a previous fight; the recovery opens it and
          // the reducer releases exactly ONE more entry. A second refusal surfaces untouched — never a loop.
          recover_refusal: (error) => recover_fight_entry_refusal(use_dungeon, character_id, error),
        }),
      enter: enter_world_fight,
      fight_id,
      character_id,
    })
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
  await use_dungeon.getState().refresh()
  return { ok: true, fight_id, status: use_dungeon.getState().dungeon?.status ?? null }
}

// ── THE SEARCH LEG (#1184). A coop drive that depends on zone freshness is not repeatable: the night's play
//    consumes the checkpoint zone's groups and the next run dead-ends at "no claimable mob group in reach".
//    So the drive SELF-PROVISIONS — scout, pull the same [F] lever a human presses, rescan, walk one zone over.
//
//    WHY THESE ARE SEAMS AND NOT A SCRIPT'S OWN page.evaluate. A Playwright-side `import('/src/…')` binds a
//    SECOND Vite module instance whose stores are frozen at init (the documented dev_probe trap, dev_bot_seam's
//    header). Every fact the leg plans over — the standing position, the zone grid, the [F] registry, the
//    per-zone search pending — lives in exactly those module singletons, so the leg has to run INSIDE the app's
//    own graph. It invents nothing: the lever is `trigger_prompt('search')` and the steering is the
//    `map/auto_run` point target, the SAME two seams the landed auto-search scouter performs
//    (game/dev/auto_search_adapter.js `perform`).

/**
 * window.__ARES_DEV_WORLD_SCOUT() — ONE plain-JSON snapshot of everything the search leg plans over: where the
 * body stands, the zone grid it stands on, which zones are still TTL-fresh (a search there is refused by the
 * chain), and whether the [F] lever is armed right here. Reads only.
 * @returns {object}
 */
function dev_world_scout() {
  const spawns = spawns_store.getState()
  const cell = context.get_state().player_cell ?? null
  // player_cell is SIGNED WORLD space and its `.y` is the world Z of the 2-D cell (the [F] gate's own read).
  const player = cell ? { x: Number(cell.x), z: Number(cell.y) } : null
  const now = Date.now()
  const zone =
    player && spawns.zone_size > 0
      ? zone_of_world(player.x, player.z, spawns.zone_size, spawns.offset_x, spawns.offset_z)
      : null
  // FRESH = NOT searchable: the chain's own EZoneFresh gate, read through the core's one predicate so the leg
  // never re-derives the TTL rule it would then disagree with.
  const fresh_keys = [...spawns.zones.keys()].filter((key) => {
    const [zx, zy] = key.split(':').map(Number)
    return !zone_searchable(zone_row_of(spawns.zones, zx, zy), spawns.zone_ttl_ms, now)
  })
  return {
    ok: !!player,
    world_id: spawns.world_id,
    character_id: context.get_state().selected_character_id ?? null,
    player,
    zone,
    zone_size: spawns.zone_size,
    offset_x: spawns.offset_x,
    offset_z: spawns.offset_z,
    zone_ttl_ms: spawns.zone_ttl_ms,
    hunt_zone: spawns.hunt_zone,
    fresh_keys,
    // the LEVER's own truth (not a second gate): [F] is registered exactly when this zone accepts a search
    prompt_armed: !!use_prompt_stack.getState().prompts.search,
    search_pending: [...spawns.pending.keys()].some((key) => key.startsWith('search:')),
  }
}

/**
 * window.__ARES_DEV_WORLD_SEARCH() — pull the [F] SEARCH lever ONCE and answer with what the chain did.
 *
 * NO RETRY, by law: `search_zone` is a terminal `&Random` entry that cannot be dry-run, so a press either never
 * signed (free) or executed (paid) — both are reported, neither is pressed twice. The receipt comes off the
 * spawns core's own pending map, exactly as the auto-search adapter reads it: a search subject that leaves
 * `pending` while the zones map was REBUILT is a receipt; one that leaves with the map untouched is a failure.
 * The digest of whichever transaction this fired is on `window.__TX_TIMINGS` (world-shell/tx.js).
 * @param {{ timeout_ms?: number }} [options]
 * @returns {Promise<{ ok: boolean, zx?: number, zy?: number, error?: string }>}
 */
function dev_world_search({ timeout_ms = 240_000 } = {}) {
  if (!use_prompt_stack.getState().prompts.search)
    return Promise.resolve({
      ok: false,
      error: 'the [F] SEARCH lever is not armed here — this zone is TTL-fresh, or the world/character is unbound',
    })
  const settled = new Promise((resolve) => {
    let done = false
    const finish = (outcome) => {
      if (done) return
      done = true
      unsubscribe()
      clearTimeout(timer)
      resolve(outcome)
    }
    const timer = setTimeout(
      () => finish({ ok: false, error: `the zone search did not settle in ${timeout_ms / 1000}s` }),
      timeout_ms
    )
    const unsubscribe = spawns_store.subscribe((state, prev) => {
      if (state.pending === prev.pending) return
      for (const key of prev.pending.keys()) {
        if (state.pending.has(key) || !key.startsWith('search:')) continue
        const [, zx, zy] = key.split(':')
        finish({ ok: state.zones !== prev.zones, zx: Number(zx), zy: Number(zy) })
        return
      }
    })
  })
  use_prompt_stack.getState().trigger_prompt('search')
  return settled
}

/**
 * window.__ARES_DEV_WORLD_WALK(target) — steer the body to a bare world point, or cancel an in-flight leg with
 * `null`. The SAME `map/auto_run` seam a big-map marker click drives, asked for a 'point' target so arriving
 * triggers no interaction. Arrival is the CALLER's read (`__ARES_DEV_WORLD_SCOUT().player`) — this door only
 * steers, exactly as the scouter's `walk` command row does.
 * @param {{ x: number, z: number } | null} target
 */
function dev_world_walk(target) {
  if (target === null) {
    context.events.emit('map/auto_run', { type: 'cancel' })
    return { ok: true, cancelled: true }
  }
  if (!Number.isFinite(target?.x) || !Number.isFinite(target?.z))
    return { ok: false, error: 'walk takes { x, z } in signed world space, or null to cancel' }
  context.events.emit('map/auto_run', { type: 'point', position: { x: target.x, z: target.z } })
  return { ok: true, x: target.x, z: target.z }
}

/** Register the world-entry doors (idempotent; dev builds only — the caller gates on import.meta.env.DEV). */
export function register_dev_world_entry() {
  if (typeof window === 'undefined') return
  const w = /** @type {any} */ (window)
  w.__ARES_DEV_WORLD_JOIN = dev_world_join
  w.__ARES_DEV_WORLD_SCOUT = dev_world_scout
  w.__ARES_DEV_WORLD_SEARCH = dev_world_search
  w.__ARES_DEV_WORLD_WALK = dev_world_walk
}
