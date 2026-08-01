// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Roster ENRICHMENT loader (S-53 → roster /v1 cutover). #53/T53.
//
// OWNER BUG (2026-07-10): "[load_roster] read TIMED OUT (10000ms), skipped: getKiosk 0x0dee…" — the OLD
// design DISCOVERED the roster by walking the wallet's personal kiosks (getOwnedKiosks → N × getKiosk,
// each individually timeout-bounded) to find which Character objects existed. A single slow/hung getKiosk
// on ANY one of the wallet's kiosks silently dropped THAT kiosk's characters from the dispatched roster,
// clobbering a perfectly good roster with a partial one — characters could vanish. That whole walk (and its
// with_timeout scaffolding around getOwnedKiosks/getKiosk/read_character-for-discovery) is DELETED.
//
// NEW: character IDENTITY (which characters exist, id/name/class/level/world) comes EXCLUSIVELY from the
// RPC read-API's owner-index — `/v1/characters?owner=` via rpc/client.ts's get_characters, the SAME call
// boot_roster.js already uses for the <1s fast paint, mapped through the SAME rpc_to_card (one home, no
// drift). That Redis index is populated once at CharacterCreated/CharacterMinted and NEVER pruned by
// escrow/kiosk-trade (packages/rpc/indexer/src/handlers/ares/project.rs `k_char_owner` — sadd only, no
// srem anywhere in the handler), so it can never "hide" a character the way a live kiosk scan could — an
// escrowed (in-dungeon) character is ALWAYS present. One atomic HTTP call, no partial-branch ambiguity, no
// per-kiosk timeout to silently skip.
//
// This loader is now purely an ENRICHMENT pass over that identity list, run in the background after
// boot_roster's fast dispatch (and after every gameplay tx — equip/consume/shop/mint/dungeon):
//   (1) full on-chain stats (vitality, current_hp, spell_levels, …) per character, via the SAME
//       read_character() embed.js uses for the entered character — needed by the Characters companion page
//       (pages/characters.tsx's CharactersDrawer variant="page") for WHATEVER roster character is
//       previewed, not only the one actually embodied in the 3D world.
//   (2) the loose item bag (chain-direct union of the Items locked across the wallet's personal kiosks).
//   (3) the live additional-character price.
// Every enrichment branch is independently timeout+catch bounded: a slow/failed one degrades that
// character/field back to its thin /v1 shape — it can never blank the roster, because the /v1 identity
// list is dispatched regardless of how enrichment lands.
//
// DECLARED GAP (roster /v1 cutover): the deleted kiosk walk also counted OLDER-lineage Character objects
// (a returning player's pre-republish characters, by kiosk item-type scan) to drive the create screen's
// "welcome back, new era" notice. The indexer only tracks the CURRENT package's mint events, so a prior-era
// character is genuinely invisible to /v1 — this notice can no longer be computed client-side without
// reintroducing the exact kiosk walk this rewrite deletes. `has_prior_era_characters` is hardcoded false
// below; consumer: game/screens/hud/world/CharacterMenu.jsx (`show_new_era_notice`). Purely cosmetic (a
// returning owner with ONLY prior-era characters just won't see the notice) — flagged, not silently dropped.

import { aresrpg_id } from '@aresrpg/sdk/deployment/aresrpg'
import { fight_store } from '@aresrpg/fight/store'

import { context } from '../game/core/game.js'
import { use_auth } from '../auth'
import { read_dungeon_session } from '../world-shell/dungeon_session.js'
import { get_characters } from '../rpc/client'
import { with_timeout } from '../utils/with_timeout'
import { game_log } from '../core/log.js'
import { report_error } from '../core/report.js'
import { get_sdk } from '../chain/sdk'
import { DEMO_NETWORK } from '../chain/deployment'
import { read_character } from '../chain/read_character.js'
import { get_owned_items, get_owned_items_from_kiosks } from '../chain/read_staking.js'
import { merge_character_enrichment } from '../chain/fight_character_reconcile.js'
// Loot-box open-latch self-clear (D1): this loader's kiosk-union item read IS the "fresh read" data input —
// a box still present in a read that STARTED after its open promise settled is proven unconsumed, so the
// session latch releases (pure predicate in the guard; no timer, no poll). One-way import (guard is a leaf).
import { release_settled_box_latches } from '../game/screens/hud/lootbox-retry-guard.js'
// #1495 duplicate-stack sweep — the orchestrator is dependency-injected (it reads and writes nothing itself),
// so this loader, the edge that already owns the bag read, wires its fight predicate / submit / fold doors.
import { sweep_duplicate_stacks } from '../world-shell/auto_merge_stacks.js'
import { stack_sweep_refusals } from '../world-shell/stack_sweep_refusals.js'
import { world_fight_active } from '../world-shell/fight_session_scope.js'
import { apply_stack_merge_receipt } from '../world-shell/store_patch.js'
import { submit_stack_merges } from '../chain/write/write_stack_merge.js'

import { rpc_to_card } from './roster_projection.js'

// The items package scope for the loose-bag read. get_owned_items unions the Items locked across the wallet's
// personal kiosks (every item is kiosk-locked — see read_staking.js); this is a DIFFERENT walk from the
// character-discovery kiosk scan deleted above (that one drove roster IDENTITY, now served by /v1).
const PACKAGE_ID = aresrpg_id(DEMO_NETWORK, 'PACKAGE_ID')

/**
 * Bounds a chain-direct ENRICHMENT read via the shared utils/with_timeout (the SAME primitive the
 * marketplace + scribe loaders use — extracted from this file's own original guard) and degrades to
 * `fallback` instead of throwing: a slow/failed branch must degrade ONLY its own character/field, never
 * block or blank the roster identity already dispatched from /v1.
 * @template T @param {Promise<T>} promise @param {string} label @param {T} fallback @param {number} [ms]
 * @returns {Promise<T>}
 */
const bounded = (promise, label, fallback, ms = 10000) =>
  with_timeout(promise, ms, label).catch((/** @type {any} */ error) => {
    game_log('load_roster', `read failed/timed out, skipped: ${label}`, error)
    return fallback
  })

// Concurrency guard: a re-trigger (navigation re-fires the GameWorldHost effect, or a rapid tx sequence)
// while a load is in flight is dropped — the in-flight load dispatches the up-to-date roster when it lands.
let loading = false

/**
 * Fetch the roster's IDENTITY from `/v1/characters?owner=` (never a chain walk), then enrich it (full
 * stats, item bag, creation price) via bounded chain-direct reads, and merge the result onto the engine
 * store (`action/sui_data`) so CharactersDrawer/CharacterSwitcher/the companion page render it. Auto-selects
 * the first character when none is selected. Idempotent and safe to call repeatedly (boot + every entry to
 * a roster surface + after every gameplay tx).
 * @returns {Promise<void>}
 */
export async function load_roster() {
  const { address } = use_auth.getState()
  if (!address || loading) return
  loading = true
  try {
    // (1) ROSTER IDENTITY — /v1 ONLY. One atomic call: either it resolves the definitive owner-scoped list,
    // or it throws — no partial/ambiguous state to reconcile (unlike the old N-branch kiosk walk). A failure
    // mirrors boot_roster's degraded law: never dispatch a false-empty roster over a good one — leave
    // whatever is on screen and surface Retry only before the first successful load ever lands.
    let rpc_chars
    try {
      rpc_chars = await get_characters({ owner: address })
    } catch (error) {
      game_log('load_roster', '/v1 characters read failed', error)
      if (!context.get_state().sui.loaded)
        context.dispatch('action/sui_data', { load_error: 'Could not load your characters. Retry.' })
      return
    }
    const identity = rpc_chars.map(rpc_to_card)

    // (2) ENRICHMENT — full per-character stats + the loose item bag + the live creation price. Every branch
    // is a chain-direct read that CAN hang/fail; each is independently with_timeout-bounded so one slow
    // branch degrades only its own data, never the identity list dispatched above. SDK init is ALSO bounded
    // (15s) — a stalled SDK degrades every enrichment branch to its fallback; the identity list still renders.
    const sdk = await Promise.race([
      get_sdk(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('sdk init timed out (15s)')), 15000)),
    ]).catch((/** @type {any} */ error) => {
      game_log('load_roster', 'sdk init failed — roster stays thin (id/name/class/level only)', error)
      return null
    })

    const read_started_at = Date.now() // freshness anchor for the loot-box latch self-clear below
    const [full_reads, owned_items, creation] = sdk
      ? await Promise.all([
          // ONE getObject per KNOWN character id (no discovery, no kiosk enumeration) — a slow/failed read
          // for ONE character (e.g. it's currently escrowed in a live dungeon fight, so getObject can't see
          // the wrapped struct) degrades only that character back to its thin identity shape.
          Promise.all(
            identity.map((c) => bounded(read_character(sdk.grpc_client, c.id), `read_character ${c.id}`, null))
          ),
          // 25s: the union walks EVERY personal kiosk (some wallets hold 11+) through the public
          // rate-limited endpoint — 10s starved it live (2026-07-11). Interim until /v1/owner-items lands;
          // still bounded, still degrades to an empty bag on true failure.
          bounded(get_owned_items(sdk, address, PACKAGE_ID), 'get_owned_items', [], 25000),
          bounded(sdk.get_creation_state(), 'get_creation_state', null),
        ])
      : [identity.map(() => null), [], null]

    // D1 self-clear: hand the fresh item feed to the loot-box latch predicate BEFORE dispatch, so the same
    // render that paints the new bag already sees any released latch. Presence-only releases make every
    // degraded read (timeout → [] / partial union) safe by construction — absence proves nothing.
    const released = release_settled_box_latches({
      live_box_ids: new Set(owned_items.map((item) => String(item?.id ?? ''))),
      read_started_at,
    })
    if (released.length)
      game_log('lootbox', `open latch self-cleared (box proven still sealed): ${released.join(', ')}`)

    // Progression XP no longer lives in the base Character object: preserve `/v1`'s projected experience/level
    // while layering the chain-direct stats/cosmetics enrichment. A plain spread here reset every earned-XP row
    // to the immutable genesis experience returned by read_character.
    const characters = identity.map((c, i) => merge_character_enrichment(c, full_reads[i]))

    // D245 (in-dungeon tag): a character LIVE in a dungeon fight is escrowed, so its stats read above can
    // legitimately degrade — that's fine, it just keeps its thin identity. What must never be lost is the
    // `in_dungeon` tag CharacterSwitcher.tsx / Inventory.jsx / NpcPrompt.jsx read to show/gate the resume
    // affordance. /v1's identity list already includes the character (the index is keyed by owner and permanent), so
    // this is now a find-and-patch — the old "missing from the scan → push a stale clone back in" recovery
    // no longer applies (identity can't go missing the way a kiosk-scan miss could), but is kept as a
    // defensive fallback for the one remaining edge (indexer lag before the create event is processed).
    try {
      const { in_session, character_id, session_address } = read_dungeon_session()
      if (in_session && character_id && session_address === address) {
        const idx = characters.findIndex((/** @type {any} */ c) => c.id === character_id)
        if (idx !== -1) characters[idx] = { ...characters[idx], in_dungeon: true }
        else {
          const prior = context.get_state().sui?.characters?.find((/** @type {any} */ c) => c.id === character_id)
          if (prior) {
            characters.push({ ...prior, in_dungeon: true })
            game_log('load_roster', 'merged the live-session escrowed char — roster never empties mid-fight (D245)')
          }
        }
      }
    } catch {
      /* dungeon store not initialised yet (boot) — nothing to merge */
    }

    // M5 (audit row #3): the roster/bag SNAPSHOT. The sui_session reducer now owns the merge law — it FLOORS
    // XP (a fresh fight's receipt-proven XP can never be regressed by a lagging /v1 read) and runs `items`
    // through the consumable/bought pending ledgers (D307: mask in-flight consumes so the bag count never
    // bounces, and KEEP a just-bought row on omit until the indexer projects its id). Dispatch RAW `owned_items`
    // — the ledger merge is single-homed in @aresrpg/inventory (reduce.js) now, not pre-applied here.
    context.dispatch('action/sui_data', {
      kind: 'snapshot',
      characters,
      items: owned_items,
      has_claimed_free_character: characters.length > 0,
      has_prior_era_characters: false, // declared gap — see file header
      // MIST → SUI for the paid-create DISPLAY price (the mint reads the exact MIST on-chain). null read → the
      // consumer falls back to ADDITIONAL_CHARACTER_PRICE_SUI (never a doomed-mint risk: the mint is authoritative).
      character_price_sui: creation ? Number(creation.price) / 1e9 : null,
      loaded: true,
      load_error: null,
    })

    // #1495 — the DUPLICATE-STACK SWEEP. Every stackable acquisition mints a NEW Item of amount 1, so a bag
    // silently accumulates same-template singletons. Fire ONCE per session, right after the bag has been
    // dispatched: the sweep owns its own laws (never mid-fight, never retried, receipt-folded — see
    // world-shell/auto_merge_stacks.js), and this call site owns only the WIRING of its three doors.
    // Fire-and-forget by design: a tidy-up must never delay, block or fail the roster load.
    // The ONE live-custody read behind both sweep doors: the kiosk-union walk threads each item's TRUE
    // source kiosk onto its row (read_staking.js), which is what makes a merge's kiosk id signable (#1802).
    const live_custody = () => get_owned_items_from_kiosks(sdk, address, PACKAGE_ID)
    sweep_duplicate_stacks({
      items: owned_items,
      // The mirror bag above says WHETHER to tidy; chain custody says WHAT to sign — an indexer row whose
      // item→kiosk edge lags would otherwise list a stack against a kiosk that does not hold it (abort 11).
      custody: live_custody,
      // Cross-load memory of a plan the chain already refused — a failing sweep surfaces once instead of
      // re-signing the same transaction on every app load (#1802 rider).
      refusals: stack_sweep_refusals,
      fight_active: () => world_fight_active(fight_store.getState()),
      submit: submit_stack_merges,
      fold: apply_stack_merge_receipt,
      // The merge deletes every source object. Re-derive the bag from fresh kiosk custody, then send that
      // snapshot through the same action/sui_data reducer door as every other roster read.
      refresh: async () => {
        context.dispatch('action/sui_data', { kind: 'snapshot', items: await live_custody() })
      },
    }).catch((error) => game_log('load_roster', 'stack sweep threw (never fatal)', error))

    // auto-select the first character if none is selected (chat/HUD need a valid id)
    if (!context.get_state().selected_character_id && characters[0]?.id)
      context.dispatch('action/select_character', characters[0].id)
  } catch (error) {
    game_log('load_roster', 'roster load failed', error)
    report_error(error, { area: 'roster', action: 'load_roster' })
    // Surface a terminal error so the roster shows "couldn't load + Retry" instead of an endless
    // spinner (boot-routing 3-states law). Only before the first success — once loaded is true the
    // existing roster stays on screen (a transient re-scan hiccup must not blow it away).
    if (!context.get_state().sui.loaded)
      context.dispatch('action/sui_data', { load_error: 'Could not load your characters. Retry.' })
  } finally {
    loading = false
  }
}
