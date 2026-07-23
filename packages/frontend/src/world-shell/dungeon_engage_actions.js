// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SIZE-LAW SPLIT (2026-07-20) of dungeon_actions.js (785 LoC, over the house ≤600 cap). This sibling holds the
// pieces with ZERO cycle-embedded consumer: create_world_fight (+ its exclusive claim/proof helpers) and the
// standalone mint_rolled / burn_result doors. Everything else stayed put on purpose — owned_team_actions.js,
// dungeon_settlement.js, fight-liquidation.js, and dungeon_run_store.js are ALL already inside the pre-existing
// baselined `auth`-rooted import cycle (.dependency-cruiser-known-violations.json) and import the REST of
// dungeon_actions.js's doors from that exact path; redirecting any of THOSE imports here would close a NEW,
// unbaselined cycle (verified with `bash scripts/depcruise-gate.sh`) — this is why the cut isn't the full
// WORLD-FIGHT/DUNGEON-RUN "engagement" grouping the size-law ticket first expected. `sign` / `ctx_of` /
// `remember_created_fight` stay defined in dungeon_actions.js (exported) and are imported back here — the
// shared tx choke, one home, reused one-directionally (this file depends on dungeon_actions.js; never reverse).

import {
  create_fight_ptb,
  compose_mob_group_proof,
  get_zone_group_commitment,
  mint_rolled_ptb,
  burn_result_ptb,
} from '@aresrpg/sdk/fight'
import { get_zone_state } from '@aresrpg/sdk/game'
import { group_engage_blocked } from '@aresrpg/world/nearby_fights'

import { use_auth } from '../auth'
import { get_sdk } from '../chain/sdk'
import { DEMO_NETWORK } from '../chain/deployment'
import { mark_engage_ptb_built, note_engage_fight_id } from '../core/engage_timing.js'
import i18n from '../i18n'
import { tx_error } from '../game/core/abort_copy.js'
import { clear_budget_cache } from '../tx/budget_cache.js'
import { clear_gas_coin_cache } from '../tx/gas_coin_cache.js'
import { clear_fight_ref_cache } from '../tx/fight_ref_cache.js'
import { get_config, get_fights } from '../rpc/client'
import { rows_from_state, zone_world_doc } from '../game/zone_rows.js'

import { kiosk_for_character, any_personal_kiosk } from './kiosk_resolve.js'
import { use_fight_cost } from './fight_gas_ledger.js'
// The shared tx choke: BOTH files sign through the same money-safety logic (gas ledger, digest handling, the
// tx-retry-burn law) — one home, imported back. dungeon_actions.js exports these for exactly this reuse.
import { sign, ctx_of, remember_created_fight } from './dungeon_actions.js'

// ╔════════════════ [ WORLD FIGHT — mob-group click → claim + create (ONE PTB) ] ═ ]

const same_unsigned = (left, right) => {
  try {
    return BigInt(left) === BigInt(right)
  } catch {
    return false
  }
}

const same_object_id = (left, right) => {
  try {
    return BigInt(left) === BigInt(right)
  } catch {
    return false
  }
}

/**
 * Fail-closed join of chain commitment + the FULL sim-derived row stream. Exported for the scoped call-site
 * regression test; production obtains each input immediately before composing the fight PTB below.
 * @param {{ world_id:string, spawn_id:number|string, mob_template_id:string, zx:number, zy:number,
 *   zone:any, commitment:any, groups:any[] }} input
 */
export function verified_world_group_proof({ world_id, spawn_id, mob_template_id, zx, zy, zone, commitment, groups }) {
  if (!zone || !commitment || !Array.isArray(groups)) return null
  const matches = groups.filter((group) => same_unsigned(group.spawn_id, spawn_id))
  if (matches.length !== 1) return null
  const [target] = matches
  if (!same_object_id(target.template_id, mob_template_id)) return null
  const index = Number(target.index)
  if (!Number.isSafeInteger(index) || index < 0) return null
  const consumed = ((Number(zone.mob_bitmap?.[index >> 3] ?? 0) >> (index & 7)) & 1) !== 0
  if (consumed) return null
  return compose_mob_group_proof({
    world_id,
    zx,
    zy,
    zone_seed: zone.seed,
    discovered_at_ms: zone.discovered_at_ms,
    group_root: commitment.root,
    group_count: commitment.count,
    groups,
    index,
  })
}

async function load_world_group_proof({ sdk, world_id, spawn_id, mob_template_id, zx, zy }) {
  if (zx == null || zy == null) return null
  try {
    const read_context = { grpc_client: sdk.grpc_client, network: DEMO_NETWORK }
    const [zone, commitment, world, config] = await Promise.all([
      get_zone_state(read_context)(world_id, zx, zy),
      get_zone_group_commitment(read_context)(world_id, zx, zy),
      zone_world_doc(world_id),
      get_config().catch(() => null),
    ])
    if (!zone || !world || !commitment) return null
    // Commitments cover EVERY search-time group, including consumed siblings. Clear only the mob bitmap before
    // calling the existing sim mirror; verified_world_group_proof checks that the selected target is still live.
    const groups = rows_from_state(
      { ...zone, mob_bitmap: [] },
      zx,
      zy,
      world,
      config?.dials?.team_size_bound != null ? Number(config.dials.team_size_bound) : 6
    ).filter((row) => row.kind === 'mob')
    return verified_world_group_proof({
      world_id,
      spawn_id,
      mob_template_id,
      zx,
      zy,
      zone,
      commitment,
      groups,
    })
  } catch {
    return null
  }
}

// The structured zones::ESpawnNotFound(108) shape parse_move_abort + the decoder + engage()'s ghost-drop all
// read (module + code) — so a PRE-SIGN liveness refusal (leg ③ below) humanizes to the honest "already taken"
// copy AND reconciles the view EXACTLY like the on-chain claim race (drop the row + re-poll), never a burn.
const GROUP_CLAIMED_ABORT = { MoveAbort: { abortCode: 108, location: { module: 'zones' } } }

/**
 * CREATE a Fight over a LIVE discovered mob group: the CLAIM door (GroupTicket hot potato) + `fight::create`
 * compose in ONE PTB (the ONLY provenance create accepts). First-come on the spawn. Passing the GROUP's zone
 * `zx`/`zy` uses the global-search door `zones::claim_mob_group_in_zone` (2026-07-10 — claim any searched
 * zone's group in reach); omitting them falls back to the occupied-zone `zones::claim_mob_group`.
 * @param {{ world_id:string, spawn_id:number|string, zx?:number|null, zy?:number|null, mob_template_id:string,
 *           character_id:string, raised_spell_ids?:string[], is_public?:boolean, party_id?:string|null }} args
 * @returns {Promise<{ receipt:any, fight_id:string|null }>}
 */
export async function create_world_fight({
  world_id,
  spawn_id,
  zx = null,
  zy = null,
  mob_template_id,
  character_id,
  raised_spell_ids = [],
  is_public = true,
  party_id = null,
}) {
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not connected')
  const sdk = await get_sdk()
  const [handle, group_proof, live_fights] = await Promise.all([
    kiosk_for_character(sdk, address, character_id),
    load_world_group_proof({ sdk, world_id, spawn_id, mob_template_id, zx, zy }),
    // TOCTOU SHRINK (leg ③): the SAME /v1 fight truth the engage affordance gates on, read FRESH here (parallel
    // with the kiosk/proof reads — zero added latency) so the residual poll-lag window between the affordance's
    // 6s snapshot and this press collapses to one read. A claimed spawn shows a live fight here even when the
    // client's polled set was still stale (the exact regression TOCTOU SHRINK addresses).
    get_fights({ world: world_id }).catch(() => null),
  ])
  if (!handle) throw new Error('That character is not in your kiosk')
  // A live fight already holds this spawn ⇒ refuse PRE-SIGN (zero gas, no digest) with the structured zones-108
  // shape, IMMEDIATELY before compose/sign. The throw propagates to engage()'s catch, which reads the 108 and
  // reconciles (ghost-drop the row + re-poll) — identical to the on-chain claim race, minus the burned gas.
  if (group_engage_blocked(live_fights, spawn_id)) throw tx_error(GROUP_CLAIMED_ABORT, { preflight: true })
  const tx = create_fight_ptb(ctx_of(sdk))({
    world_id,
    kiosk_id: handle.kiosk_id,
    personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
    character_id,
    raised_spell_ids,
    spawn_id,
    zx,
    zy,
    group_proof,
    mob_template_id,
    is_public,
    party_id,
  })
  mark_engage_ptb_built(tx)
  use_fight_cost.getState().reset() // FRESH fight entry — its own gas is the first line of the new total
  clear_budget_cache() // and drop any prior fight's cached act budgets (a new fight = new shapes)
  clear_fight_ref_cache() // + the prior fight's pinned shared-ref (a new fight = a new object)
  clear_gas_coin_cache() // + the prior fight's chained gas-coin pin (a new fight re-selects + re-chains)
  const receipt = await sign(tx, i18n.t('fights.action_engage'))
  const fight_id = remember_created_fight(receipt) // + cache its pinned shared ref (zero-read)
  note_engage_fight_id(tx, fight_id)
  return { receipt, fight_id }
}

// ╔════════════════ [ SETTLEMENT — the two standalone, no-cycle-embedded-consumer doors ] ══ ]

/** MINT the rolled loot owed for ONE template into my kiosk (`results::mint_rolled` — once per owed template). */
export async function mint_rolled(/** @type {string} */ result_id, /** @type {string} */ item_template_id) {
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not connected')
  const sdk = await get_sdk()
  const handle = await any_personal_kiosk(sdk, address)
  if (!handle) throw new Error('No personal kiosk found')
  const tx = mint_rolled_ptb(ctx_of(sdk))({
    result_id,
    item_template_id,
    kiosk_id: handle.kiosk_id,
    personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
  })
  return sign(tx, i18n.t('dungeons.action_mint_loot'), true) // background — the card is the surface
}

/** BURN an OPENED, EMPTIED FightResult for the storage rebate (aborts while rolled loot remains). */
export async function burn_result(/** @type {string} */ result_id) {
  const sdk = await get_sdk()
  const tx = burn_result_ptb(ctx_of(sdk))({ result_id })
  return sign(tx, i18n.t('dungeons.action_burn'), true) // rides the settlement chain, never its own toast
}
