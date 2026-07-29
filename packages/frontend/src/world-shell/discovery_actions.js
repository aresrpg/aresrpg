// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DISCOVERY actions (S-18) — the SEARCH ZONE tx seam + its progress-toast RP beat (search
// plays a progress-bar toast in the REAL top-right .gw-toasts stack — "searching takes a beat").
//
// The tx targets the MERGED `aresrpg` package via the SDK's stamp-or-throw home (same seam law as
// pools/kolizeum): until the ceremony stamps the ids it refuses loudly — the progress toast resolves to an
// honest error, never a silent stall. `search_zone` is a terminal `&Random` entry: it CANNOT be dry-run;
// the SDK builder carries the budget policy, nothing here guesses gas.

import { search_zone_ptb, get_world } from '@aresrpg/sdk/game'
import { chain_to_world, world_offsets, world_to_chain } from '@aresrpg/sdk/coords'
import { subscribe_spawn_beats } from '@aresrpg/world/spawns_zones'
import { SEARCH_PROGRESS_MS } from '@aresrpg/world/spawns_reconcile'

import i18n from '../i18n'
import { DEMO_NETWORK } from '../chain/deployment'
import { get_sdk } from '../chain/sdk'
import { context } from '../game/store.js'
import { update_progress_toast, resolve_progress_toast, reveal_zone } from '../game/core/toast.js'
import { play_discovery_sfx } from '../game/core/audio/sfx.js'
import { pulse_walk_fov } from '../game/core/camera_juice.js'
import { read_zone_searched } from '../game/core/zone_searched.js'
import { humanize_tx_error } from '../game/core/abort_copy.js'
import { zone_rows_chain } from '../game/zone_rows.js'
import { game_log } from '../core/log.js'
import { report_error } from '../core/report.js'

import { run_tx_random } from './tx.js'
import { spawns_store, spawns_input } from './spawns_adapter.js'
import { publish_checkpoint_receipt } from './world_checkpoint.js'

/** True when the OS/browser asks for reduced motion — gates the camera pulse only (banner + sfx still fire). */
const prefers_reduced_motion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ── THE BEAT EXECUTOR (D770a W2): the reveal juice comes back from the spawns CORE as presentation-beat
// DATA rows ({kind, duration, payload}) — this edge only performs them. The chime, the center-screen banner
// (with the on-chain findings count), and the motion-gated FOV punch each map to exactly one beat kind; the
// search progress sweep stays toast-scoped in search_zone below (its duration is the beat's own number).
subscribe_spawn_beats(spawns_store, (beat) => {
  if (beat.kind === 'reveal_chime') play_discovery_sfx()
  else if (beat.kind === 'reveal_banner' && beat.payload) reveal_zone(beat.payload)
  else if (beat.kind === 'fov_pulse' && !prefers_reduced_motion()) pulse_walk_fov()
})

// WORLD JOIN moved to world_join.js (auto-join post-create + the S-67 switcher action) —
// one join home; this module stays the SEARCH seam.

// The zone codec (zone_of / zone_of_world / DEFAULT_ZONE_SIZE + the world↔chain offset) now lives in its
// ONE home — `@aresrpg/sdk/coords` — consumed by both the SDK write path and every client display surface.

// One world-doc read per world per session (zone_size / zone_ttl_ms are config-grade). A failed/empty read is
// NOT cached — a later caller retries. Feeds the [F] SEARCH re-arm (zone_ttl_ms drives the §17.1 TTL readiness
// so a discovered-but-stale zone re-arms search). Mirrors the CompassStrip's own cadence-bound world read.
const _world_docs = new Map()
export function fetch_world_doc(world_id) {
  if (!world_id) return Promise.resolve(null)
  if (!_world_docs.has(world_id)) {
    const read = get_sdk()
      .then((sdk) => get_world({ grpc_client: sdk.grpc_client })(world_id))
      .then((doc) => {
        if (!doc) _world_docs.delete(world_id)
        return doc
      })
      .catch(() => {
        _world_docs.delete(world_id)
        return null
      })
    _world_docs.set(world_id, read)
  }
  return _world_docs.get(world_id)
}

const zone_read_delays_ms = [0, 180, 420]
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Fold the chain-direct rows for a known-executed search through the spawns reducer door. Null is an
 * unconfirmed negative seconds after a write, so the optimistic leg retries reads only; it never retries the tx.
 */
async function fold_zone_rows_after_write({ world_id, zx, zy, at_executed, reconcile = false }) {
  const delays = reconcile ? [0] : zone_read_delays_ms
  for (const delay_ms of delays) {
    if (delay_ms) await sleep(delay_ms)
    const rows = await zone_rows_chain(world_id, zx, zy)
    if (rows === null) continue
    spawns_input({ type: 'zone_rows', zx, zy, proven: true, rows })
    context.events.emit('discovery/zone_rows_ready', {
      world_id,
      zx,
      zy,
      row_count: rows.length,
      at_executed,
      reconcile,
    })
    game_log(
      'discovery',
      `zone ${zx}:${zy} rows folded ${Math.round(performance.now() - at_executed)}ms after execute` +
        (reconcile ? ' (finality reconcile)' : '')
    )
    return rows
  }
  return null
}

/**
 * SEARCH the zone the character occupies: drives the caller's already-pending sticky progress toast (gold
 * bar, ~2.4s RP sweep) → tx → resolves it to found/error. Returns the run_tx promise (callers may await;
 * failures already toasted).
 * SEARCH-PRESS JUICE (reward-beats law — "fires ON PRESS, optimistic"): `toast_id` is now the
 * CALLER's press-time toast (DiscoveryPrompts.jsx pushes it the instant [F] is pressed, before the kiosk
 * resolve even starts) — this seam only DRIVES it (sweep/resolve), never creates it, so the sticky
 * "Searching…" toast is never delayed behind that await.
 * Upgrade #4 (zones search fix): the deployed entry takes the player's LIVE STANDING POSITION — the zone
 * derivation moved on-chain (`pos / zone_size`); callers pass the same SIGNED WORLD position they gate the
 * prompt from. The world↔chain offset (bounds/2) is read off the `World` doc and the SDK builder translates
 * to the CHAIN u32 the Move fn takes (coords.js codec) — no coord ever crosses to chain untranslated.
 * @param {{ world_id:string, x:number, z:number, character_id:string, kiosk_id:string,
 *           personal_kiosk_cap_id:string, toast_id:number }} args
 */
export function search_zone({ world_id, x, z, character_id, kiosk_id, personal_kiosk_cap_id, toast_id }) {
  // The RP beat: sweep to 90% while the tx flies; confirm snaps it full. The DURATION is the core's
  // search_progress beat (presentation as data) — armed by the search_intent dispatched below.
  const started = Date.now()
  let sweep_ms = SEARCH_PROGRESS_MS
  const sweep = setInterval(
    () => update_progress_toast(toast_id, Math.min(0.9, (Date.now() - started) / sweep_ms)),
    120
  )
  /** @type {{zx:number, zy:number} | null} */
  let searched_cell = null
  /** @type {{x:number, z:number} | null} the exact integer block position the PTB commits */
  let searched_position = null

  // The PTB build runs INSIDE the chain: a synchronous builder throw (unstamped ids, bad kiosk arg) must
  // resolve the progress toast to the honest error and clear the sweep — never a forever-90% "searching".
  return Promise.resolve()
    .then(async () => {
      // Per-world offset (bounds/2) off the cached World doc; the builder floors + translates WORLD→CHAIN.
      const doc = await fetch_world_doc(world_id)
      spawns_input({ type: 'world_doc', doc }) // the core folds the same doc facts (idempotent)
      // THE DOOR DECIDES (D770a W2): search_intent latches the per-zone pending (single-flight as data),
      // mirrors the EZoneFresh gate, and emits the search_tx request + progress beat this edge performs.
      spawns_input({ type: 'search_intent', x, z })
      const request = spawns_store.getState().tx_request
      const accepted =
        request?.kind === 'search' &&
        request.payload.x === x &&
        request.payload.z === z &&
        spawns_store.getState().pending.has(`search:${request.payload.zx}:${request.payload.zy}`)
      if (!accepted) throw new Error(i18n.t('discovery.search_failed')) // refused: fresh zone / already in flight
      searched_cell = { zx: request.payload.zx, zy: request.payload.zy }
      sweep_ms = spawns_store.getState().beats.at(-1)?.duration ?? SEARCH_PROGRESS_MS
      const off = world_offsets(doc)
      searched_position = {
        x: chain_to_world(Math.floor(world_to_chain(x, off.x)), off.x),
        z: chain_to_world(Math.floor(world_to_chain(z, off.z)), off.z),
      }
      return search_zone_ptb({ network: DEMO_NETWORK })({
        world_id,
        kiosk_id,
        personal_kiosk_cap_id,
        character_id,
        x, // SIGNED WORLD standing position — translated to chain u32 in the builder via the offset
        z,
        offset_x: off.x,
        offset_z: off.z,
      })
    })
    .then((tx) =>
      run_tx_random('search_zone', tx, undefined, {
        on_executed: ({ at: at_executed }) => {
          if (!searched_cell) return
          void fold_zone_rows_after_write({
            world_id,
            zx: searched_cell.zx,
            zy: searched_cell.zy,
            at_executed,
          }).catch((error) =>
            report_error(error, {
              area: 'discovery',
              action: 'search_zone_executed_projection',
              world: world_id,
            })
          )
        },
      })
    )
    .then((res) => {
      resolve_progress_toast(toast_id, { state: 'success', title: i18n.t('discovery.search_done') })
      const found = read_zone_searched(res?.result)
      const committed = searched_position ?? { x, z }
      // THE SEARCH RECEIPT through the door (one clock): checkpoint + zone + hunt_zone advance atomically in
      // the core, and the reveal juice (chime / banner / FOV punch) comes BACK as beats the module-scope
      // executor above performs — presentation is data now, this seam emits nothing itself.
      void publish_checkpoint_receipt({
        type: 'zone_searched',
        character_id,
        world_id,
        zx: found.zx,
        zy: found.zy,
        x: committed.x,
        z: committed.z,
        time_ms: found.at_ms,
        found,
      })
      // ZoneSearched carries the checkpoint revision itself, while this tx's signed standing position is the
      // exact world-space coordinate the chain translated and committed. Seed that receipt proof immediately;
      // no lagging checkpoint read may make the pre-search local pose look current again.
      // COMPASS REFRESH (UX-latency fix — "the compass takes a bit of time to update after searching a
      // zone"): broadcast the searched zone the instant the tx confirms, off the SAME shared bus every other
      // imperative→reactive signal in this app uses (context.events — the fight_entry/* pattern; zero new
      // concept). The payload carries only what the on-chain ZoneSearched event actually proves (zx/zy —
      // NEVER the spawn rows: the event carries counts only, see zone_searched.js) — CompassStrip owns the
      // bounded reconcile-wait + its own view refetch; world_spawns.js rides the SAME event to ferry the
      // zone's rows CHAIN-DIRECT into the core (bypassing the /v1 indexer/cache lag) and reads at_cert to
      // self-report the cert→visible delta.
      context.events.emit('discovery/zone_searched', {
        world_id,
        zx: found.zx,
        zy: found.zy,
        at_cert: performance.now(),
      })
      // Finality is reconciliation, not the first paint. A direct read re-enters the same reducer door and can
      // enrich/correct the executed projection without delaying the success toast or returned tx result.
      void fold_zone_rows_after_write({
        world_id,
        zx: found.zx,
        zy: found.zy,
        at_executed: performance.now(),
        reconcile: true,
      }).catch((error) =>
        report_error(error, {
          area: 'discovery',
          action: 'search_zone_finality_reconcile',
          world: world_id,
        })
      )
      return res
    })
    .catch((e) => {
      // Humanize through the ONE shared decoder — the SAME path the travel toast uses (2026-07-15 QA: the
      // search path leaked a raw "abort code: 102" while travel showed the plain copy; a checkpoint::102 on
      // search is the identical too-fast case and must read identically). Never the raw chain blob.
      if (searched_cell) spawns_input({ type: 'search_failed', zx: searched_cell.zx, zy: searched_cell.zy })
      resolve_progress_toast(toast_id, {
        state: 'error',
        title: i18n.t('discovery.search_failed'),
        message: humanize_tx_error(e),
      })
      throw e
    })
    .finally(() => clearInterval(sweep))
}
