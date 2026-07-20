// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DISCOVERY prompt sources (S-18, DECISIONS 07-09 pick + addendum) — renderless registrars feeding the
// PromptStack (keys: F search · G gather · R ride; E dungeon lives in NpcPrompt.jsx):
//
//   AUTO-JOIN (no [J] button — auto-join reads as more intuitive): while the selected character's
//       RPC doc has NO `world` (a fresh post-create character, or a legacy unjoined one), this registrar fires
//       the SPONSORED `zones::join_world` ONCE per character per session (world_join.js — a fresh zkLogin
//       wallet owns zero SUI; the S-54 choke dry-runs it, zero sponsor gas on a would-fail). The manual world
//       SWITCHER (S-67 mounts it next to the online-players panel) calls `join_world_action` — self-pay.
//   [F] SEARCH ZONE — shown ONLY while the zone under the avatar is unsearched ("option 3A" pick). Truth via
//       the RPC zones view (UI-DATA LAW short-poll): only discovered zones exist as data (§17.18), so
//       "current (zx,zy) absent from the set" = unsearched. The current world/character resolve off the
//       selected character's RPC doc; the live position is the roam scene's own player_cell (the engine
//       publishes it — local truth, never a display read). Kiosk pair via THE derive-from-character home
//       (kiosk_resolve.js — the first-cap pick was a live borrow_mut/11 trap).
//   [G] GATHER — registered while the roam scene's gather signal is live (`action/gather_target`). The
//       trigger resolves the character kiosk then submits the real `gathering::gather` tx (gather_actions.js,
//       the [F]-search twin) — the yield mints into the personal kiosk. (UI map #9 rewire — LANDED.)
//   [R] RIDE — SIGNAL SEAM ONLY: no mount-possession signal exists in the engine store yet (pets/mounts
//       equip via items; the ride affordance lands with the pet-feed/mount pass). Registering nothing is
//       honest — a pill without a real signal would be a fake affordance.

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { use_game_state, context } from '../../../store.js'
import { use_prompt_stack } from '../../../../world-shell/prompt_stack.js'
import { use_rpc_view } from '../../../../rpc/use_view'
import { get_characters, get_zones } from '../../../../rpc/client'
import {
  push_event_toast,
  push_progress_toast,
  resolve_progress_toast,
  trigger_search_flash,
} from '../../../core/toast.js'
import { search_zone, fetch_world_doc } from '../../../../world-shell/discovery_actions.js'
import { zone_of_world, world_offsets, DEFAULT_ZONE_SIZE } from '@aresrpg/sdk/coords'
import { zone_searchable } from '@aresrpg/world/spawns_reconcile'
import { gather_gate } from '@aresrpg/world/gather_gate'
import { use_spawns, spawns_input } from '../../../../world-shell/spawns_adapter.js'
import { gather } from '../../../../world-shell/gather_actions.js'
import { auto_join_world } from '../../../../world-shell/world_join.js'
import { T62_WORLDS } from '../../../../chain/deployment'
import { kiosk_for_character } from '../../../../world-shell/kiosk_resolve.js'
import { publish_world_binding, session_gate_input } from '../../../../world-shell/session_gate.js'
import { get_sdk } from '../../../../chain/sdk'
import { game_log } from '../../../../core/log.js'
import { report_error } from '../../../../core/report.js'

// The LIVE staking-world roster (deployment.ts) as an id Set — the stale-world heal below tests membership so a
// character stranded on a retired GHOST world (bound before the republish re-point) migrates to a live world.
const LIVE_WORLD_IDS = new Set(T62_WORLDS.map((w) => w.id))

/** The muted-[G] copy for a failed gather_gate (pure reason → localized requirement line). */
function gather_gate_copy(gate, t) {
  return gate.reason === 'tool'
    ? t('discovery.gather_requires_tool', { tool: gate.tool })
    : t('discovery.gather_tier_locked', { job: gate.job, level: gate.level })
}

/**
 * Bounded chain-truth wait for a CONFIRMED search (the [F] pending hold): poll `/v1/zones` until `(zx,zy)`'s
 * row shows a `discovered_at_ms` different from the press baseline `prior_at` (fresh discovery: baseline null →
 * any row reconciles; TTL re-search: the stamp must move). Cadence 2.5s clears the client LRU (3s) and the api
 * max-age (5s); ~12.5s worst case then falls through honestly — never an unbounded pending.
 * @param {string} world_id @param {{zx:number, zy:number} | null} zone @param {number | null} prior_at
 */
async function wait_zone_reconciled(world_id, zone, prior_at) {
  if (!zone) return
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2500))
    const data = await get_zones(world_id).catch(() => null)
    const row = data?.zones?.find((z) => z.zx === zone.zx && z.zy === zone.zy)
    if (row && row.discovered !== false && (row.discovered_at_ms ?? null) !== prior_at) return
  }
  game_log('discovery', 'searched zone not reconciled within the pending window — falling through')
}

/** The DERIVED kiosk pair for the character (kiosk_resolve.js — never a first-cap pick). */
async function character_kiosk_handle(character_id) {
  const sdk = await get_sdk()
  const { use_auth } = await import('../../../../auth')
  return kiosk_for_character(sdk, use_auth.getState().address, character_id)
}

/** @returns {null} */
export function DiscoveryPrompts() {
  const { t } = useTranslation()
  const character_id = use_game_state((s) => s.selected_character_id)
  const player_cell = use_game_state((s) => s.player_cell)
  const gather_target = use_game_state((s) => s.gather_target ?? null)
  const characters = use_game_state((s) => s.sui.characters)

  // Selected character's world (RPC doc) — the zones view is keyed by world id.
  const char_view = use_rpc_view(
    (signal) => (character_id ? get_characters({ ids: [character_id] }, signal) : Promise.resolve([])),
    { interval_ms: 10000, enabled: !!character_id, deps: [character_id] }
  )
  const world_id = char_view.data?.[0]?.world ?? null

  // Discovered-zone set for the current world (short-poll; a search's own confirm refetches next tick).
  const zones_view = use_rpc_view((signal) => (world_id ? get_zones(world_id, signal) : Promise.resolve(null)), {
    interval_ms: 6000,
    enabled: !!world_id,
    deps: [world_id],
  })

  // The world doc (config-grade, one cached read): the zone TTL for the re-search gate (§17.1), plus the
  // zone grid the codec needs — zone_size and the world↔chain offset (bounds/2). [F] arms on a fresh zone
  // even before this loads (an undiscovered zone is searchable regardless).
  const [world_doc, set_world_doc] = useState(null)
  useEffect(() => {
    if (!world_id) return undefined
    let dead = false
    fetch_world_doc(world_id).then((doc) => {
      if (dead) return
      set_world_doc(doc)
      spawns_input({ type: 'world_doc', doc }) // the core folds the same doc facts (idempotent)
    })
    return () => {
      dead = true
    }
  }, [world_id])
  const zone_ttl_ms = world_doc ? Number(world_doc.zone_ttl_ms ?? 0) || null : null
  const zone_size = Number(world_doc?.zone_size ?? 0) || DEFAULT_ZONE_SIZE
  const off = world_offsets(world_doc)

  // The zone under the avatar (chain KEY — data lookups + spawn reads). player_cell is SIGNED WORLD space
  // (.y is the world Z of the 2D cell) → translate world→chain then floor.
  const cell = player_cell ? zone_of_world(player_cell.x, player_cell.y, zone_size, off.x, off.z) : null
  const zones = zones_view.data?.zones
  const zone_row_here = cell && zones ? (zones.find((z) => z.zx === cell.zx && z.zy === cell.zy) ?? null) : null

  // SEARCHABLE = the on-chain refusal gate mirrored (zones.move §17.1): the current cell is undiscovered, OR
  // discovered AND its TTL elapsed (re-search re-arms — the search button appears instead of a dead label;
  // a discovered-but-fresh zone stays un-armed since search would abort EZoneFresh). Re-derives every zones
  // poll, so a TTL that elapses between polls re-arms [F] within the cadence.
  const searchable = !!world_id && !!cell && !!zones && zone_searchable(zone_row_here, zone_ttl_ms, Date.now())
  // Unjoined = the doc LOADED and carries no world (never on a still-loading doc — no false trigger).
  const unjoined = !!character_id && !char_view.loading && !!char_view.data && !world_id
  // STALE-WORLD RESIDENCY (ghost-spawn regression 2026-07-13): a character bound to a world that is NOT in the
  // live T62 roster is stranded on a pre-republish GHOST world (undeletable — World has no burn door) whose spawn
  // table still rolls RETIRED mobs (e.g. Sand Hopper). `world_field` is set ONLY by zones::join_world today (the
  // dungeon flip_world seam is declared-but-unwired, and this roam-scene HUD never mounts in a dungeon), so a
  // loaded bound world ∉ T62 means EXACTLY "stranded on a ghost" — migrate to the live default. Never on a
  // still-loading or unbound doc (world_id null → `unjoined` owns that path).
  const stale_world = !char_view.loading && !!world_id && !LIVE_WORLD_IDS.has(world_id)

  // S-57 spectate-until-joined: this 10s doc poll is the binding's long-term healer — publish every CONFIRMED
  // read into the ONE binding home (session_gate.js) so the scene gate tracks external changes too. Tagged
  // source 'poll' (world-travel binding-clobber fix): during the indexer catch-up window right after a manual
  // travel or auto-join, this poll can still return the PRE-travel world — session_gate.js's stale-poll guard
  // discards that read instead of tearing the fresh write back down, and self-heals the instant a poll agrees.
  useEffect(() => {
    if (!character_id || char_view.loading || !char_view.data) return
    publish_world_binding(character_id, world_id, 'poll')
  }, [character_id, char_view.loading, char_view.data, world_id])

  // AUTO-JOIN + STALE-WORLD MIGRATION (no manual step): a world-less character joins the default
  // world, and a character stranded on a retired ghost world (`stale_world`) is MIGRATED to it — both through the
  // same SPONSORED/self-pay door, once per character per session (world_join.js owns the latch + the no-retry
  // law; auto_join_world defaults to T62_WORLDS[0] = First Shore). The refetch binds `char.world`, which arms the
  // zones poll and [F]. A migration is a FIRST join to First Shore → a fresh spawn roll: the position RESETS to
  // that world's centre and the ghost-world checkpoint is abandoned, so the honest toast fires (never a silent
  // teleport). A level-1 stranded character loses nothing but the ghost's own (retired) zone discoveries.
  useEffect(() => {
    if (!unjoined && !stale_world) return
    const migrating = stale_world // distinguish the ghost heal from the silent post-create create→play join
    void auto_join_world({ character_id })
      .then((fired) => {
        if (!fired) return
        char_view.refetch() // bind char.world NOW (UI-DATA LAW self-heal)
        if (migrating) push_event_toast({ state: 'info', title: t('discovery.world_migrated') })
      })
      .catch((error) => {
        // one honest toast; the S-67 switcher is the manual retry (never auto-refired — tx-retry law).
        // ONE-BOOT create→play: release the loading hold so the binding's own truth surfaces —
        // a still-unbound character falls to the honest D183 spectate backdrop (never a stuck veil), with the
        // toast + the manual world switcher as the retry.
        session_gate_input({ type: 'join_failed', character_id })
        push_event_toast({ state: 'error', title: t('discovery.join_failed') })
        game_log('discovery', 'auto join_world failed', error)
        report_error(error, { area: 'discovery', action: 'auto_join_world' })
      })
  }, [unjoined, stale_world, character_id, t])

  // COLD-BOOT hunt-zone seed (now a CORE input — D770a W2): the atom's hunt zone resets on
  // refresh, so seed it from the INDEXER-served character position (/v1/characters — keyless, already polled
  // here; ZERO chain-direct) whenever it is unknown. The fold's 'indexed' source NEVER clobbers a live
  // receipt/read value (a search/claim this session always wins), and the chain-direct checkpoint read at
  // boot (world_checkpoint.js ferry) now seeds the TRUE zone even when a past search advanced it.
  const hunt_zone_known = use_spawns((s) => s.hunt_zone !== null)
  useEffect(() => {
    if (!world_id || !character_id || hunt_zone_known) return
    const pos = char_view.data?.[0]?.position
    if (!pos) return
    // char.position is the INDEXER-served CHAIN checkpoint (already chain-space) — the fold zones it itself.
    spawns_input({ type: 'checkpoint_resolved', world_id, x: Number(pos.x), z: Number(pos.z), source: 'indexed' })
  }, [world_id, character_id, char_view.data, hunt_zone_known])

  // [F] SEARCH ZONE
  useEffect(() => {
    const { register_prompt, clear_prompt } = use_prompt_stack.getState()
    if (!searchable || !character_id) {
      clear_prompt('search')
      return
    }
    register_prompt({
      id: 'search',
      key: 'F',
      label: t('discovery.search_zone'),
      priority: 80,
      // PENDING IS PER ZONE (fixes a vanish regression): the press latches THIS zone's subject key, so a
      // search in flight over zone A never suppresses [F] over zone B — crossing a boundary re-arms the
      // button instantly for the new zone, and crossing back re-hides it until the press settles.
      pending_key: `search:${world_id}:${cell.zx}:${cell.zy}`,
      // RETURNS the press promise → the PromptStack holds [F] PENDING (hidden, single-flight) until it
      // settles (the optimistic-press law): success holds through on-chain reconciliation so the
      // button never flickers back; any failure settles after its toast → honest re-arm.
      on_trigger: () => {
        // SEARCH-PRESS JUICE (subtly flashing borders and a toast —
        // the reward-beats law fires ON PRESS, optimistic, rollback on failure): the border-flash pulse + the
        // sticky "Searching…" toast both fire HERE, synchronously, before the kiosk resolve below ever awaits
        // — never delayed behind that network hop. Every exit path below resolves THIS SAME toast_id (never
        // a second one-off toast), so the sticky toast always lands on one honest terminal state.
        trigger_search_flash()
        const toast_id = push_progress_toast({ title: t('discovery.searching') })
        // Resolve the character's kiosk + cap at press time via THE derive-from-character home (the first-cap
        // pick was a live borrow_mut/11 trap), then fire the seam.
        const prior_at = zone_row_here?.discovered_at_ms ?? null // this press's reconciliation baseline
        return (async () => {
          // PRE-SEAM stage: the toast is already pending, so a failure here MUST resolve it (no-silent-failure
          // law — the P1 dead-[F] press died in this stage behind a catch that assumed the seam had toasted).
          let handle = null
          try {
            handle = await character_kiosk_handle(character_id)
          } catch (error) {
            resolve_progress_toast(toast_id, { state: 'error', title: t('discovery.search_failed') })
            game_log('discovery', '[F] search press — kiosk resolve failed', error)
            report_error(error, { area: 'discovery', action: 'search_kiosk_resolve' })
            return
          }
          // Upgrade #4: the entry takes the LIVE standing position (x/z block coords, u32) — the zone
          // derivation moved on-chain. Read it at PRESS time from the ENGINE store the prompt gates on
          // (player_cell: engine-published local truth; .y is the world-Z of the 2D cell). use_game_state is
          // the useSyncExternalStore HOOK — no zustand .getState(); press-time reads go via context.get_state().
          const pos = context.get_state().player_cell ?? player_cell
          if (!handle || !pos) {
            resolve_progress_toast(toast_id, { state: 'error', title: t('discovery.search_failed') })
            game_log(
              'discovery',
              `[F] search press refused — ${handle ? 'no player_cell published' : 'character kiosk did not resolve'}`
            )
            return
          }
          try {
            await search_zone({
              world_id,
              x: pos.x,
              z: pos.y,
              character_id,
              kiosk_id: handle.kiosk_id,
              personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
              toast_id,
            })
            // The searched position is now the character's checkpoint — search_zone dispatched the receipt
            // into the spawns core (checkpoint + zone + hunt_zone advanced atomically there); this press
            // only owns the bounded /v1 reconcile wait below.
            const searched = zone_of_world(pos.x, pos.y, zone_size, off.x, off.z)
            // HOLD the press pending until CHAIN TRUTH reconciles: the tx confirmed, but [F]'s own gate
            // (`searchable`) reads the /v1 zones view — poll it (bounded) until this zone's row reflects THIS
            // search (`discovered_at_ms` moved off the press baseline), then refetch the view so the prompt
            // re-derives OFF before pending releases. Timeout falls through honestly (the 6s poll catches up).
            await wait_zone_reconciled(world_id, searched, prior_at)
            zones_view.refetch() // self-heal on interaction (UI-DATA LAW)
          } catch (error) {
            // search_zone() already resolved toast_id to the honest error; keep a console trail only.
            game_log('discovery', 'search_zone failed', error)
          }
        })()
      },
    })
    return () => use_prompt_stack.getState().clear_prompt('search')
  }, [searchable, world_id, cell?.zx, cell?.zy, character_id, t])

  // [G] GATHER — signal-gated; trigger = the rewire seam action + honest interim toast.
  useEffect(() => {
    const { register_prompt, clear_prompt } = use_prompt_stack.getState()
    if (!gather_target) {
      clear_prompt('gather')
      return
    }
    // LOCAL affordance pre-check: missing/wrong tool or too-low job level → render the
    // requirement on a MUTED [G] and toast it on press — never fire a doomed `gathering::gather` (104/105/106).
    const character = characters?.find((c) => c.id === character_id) ?? null
    const gate = gather_gate(character, gather_target)
    if (!gate.ok) {
      const msg = gather_gate_copy(gate, t)
      register_prompt({
        id: 'gather',
        key: 'G',
        label: msg,
        priority: 60,
        busy: true,
        on_trigger: () => push_event_toast({ state: 'info', title: msg }),
      })
      return () => use_prompt_stack.getState().clear_prompt('gather')
    }
    register_prompt({
      id: 'gather',
      key: 'G',
      label: t('discovery.gather'),
      priority: 60,
      // RETURNS the press promise → [G] goes PENDING (hidden, single-flight) until the tx settles; the seam
      // resolves only after confirmation, so a re-armed [G] on a multi-harvest node is post-chain-truth.
      on_trigger: () => {
        // Resolve the character's kiosk + cap at press time (the derive-from-character home), then submit the
        // real `gathering::gather` — the [F] search shape. Pre-seam failures surface themselves (no-silent law).
        return (async () => {
          if (!character_id || !gather_target) {
            push_event_toast({ state: 'error', title: t('discovery.gather_failed') })
            return
          }
          let handle = null
          try {
            handle = await character_kiosk_handle(character_id)
          } catch (error) {
            push_event_toast({ state: 'error', title: t('discovery.gather_failed') })
            game_log('discovery', '[G] gather press — kiosk resolve failed', error)
            report_error(error, { area: 'discovery', action: 'gather_kiosk_resolve' })
            return
          }
          if (!handle) {
            push_event_toast({ state: 'error', title: t('discovery.gather_failed') })
            game_log('discovery', '[G] gather press refused — character kiosk did not resolve')
            return
          }
          try {
            await gather({
              world_id: gather_target.world_id ?? world_id,
              zx: gather_target.zx,
              zy: gather_target.zy,
              spawn_id: gather_target.spawn_id ?? gather_target.node_index,
              template_id: gather_target.template_id,
              character_id,
              kiosk_id: handle.kiosk_id,
              personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
            })
          } catch (error) {
            // gather() already resolved its progress toast to the humanized error; keep a console trail.
            game_log('discovery', 'gather failed', error)
          }
        })()
      },
    })
    return () => use_prompt_stack.getState().clear_prompt('gather')
  }, [gather_target, world_id, character_id, characters, t])

  return null
}
