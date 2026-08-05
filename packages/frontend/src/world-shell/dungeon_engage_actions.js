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
  create_member_fight_ptb,
  compose_mob_group_proof,
  get_zone_group_commitment,
  mint_rolled_ptb,
  burn_result_ptb,
} from '@aresrpg/sdk/fight'
import { get_zone_state } from '@aresrpg/sdk/game'
import { aresrpg_id } from '@aresrpg/sdk/deployment/aresrpg'
import { group_engage_blocked } from '@aresrpg/world/nearby_fights'

import { use_auth } from '../auth'
import { get_sdk } from '../chain/sdk'
import { DEMO_NETWORK } from '../chain/deployment'
import { mark_engage_ptb_built, note_engage_fight_id, time_engage_leg } from '../core/engage_timing.js'
import i18n from '../i18n'
import { tx_error } from '../game/core/abort_copy.js'
import { clear_budget_cache } from '../tx/budget_cache.js'
import { clear_gas_coin_cache } from '../tx/gas_coin_cache.js'
import { clear_fight_ref_cache } from '../tx/fight_ref_cache.js'
import { get_config, get_fights } from '../rpc/client'
import { rows_from_state, zone_world_doc } from '../game/zone_rows.js'

import { kiosk_for_character, any_personal_kiosk } from './kiosk_resolve.js'
import { use_fight_cost } from './fight_gas_ledger.js'
// #1206 — the F-07 half the client owes the chain: a fight snapshots ONLY the spell ids its PTB names.
import { raised_spell_ids_for } from './raised_spells.js'
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
 * WHICH claim door this engage takes, as DATA — the one place the choice is decoded (no silent second path).
 * - `proof`: the witness `zones::*_with_proof` accepts, locally replayed against the chain commitment.
 * - `derivation`: the proofless door is the LEGAL one here — an occupied-zone claim (no zx/zy), an unstamped
 *   deployment (create_fight_ptb ignores witnesses by law there), a zone searched before commitments existed,
 *   or a FORMAT-3 member-roster group, whose claim door takes no witness at all (see below).
 * - `blocked`: we could not prove what we are about to claim. That is a refusal, never a quieter door.
 * A resolved door also NAMES the row it is about to claim (`index`): that number is the group's identity for
 * `fight::release_group`, so a lost fight can give the group back (#609). The occupied-zone door names no row,
 * and records none — an unnamed group is never released rather than releasing the wrong one.
 * @typedef {{ door:'proof', proof:any, index:number } | { door:'derivation', reason:string, index?:number }
 *   | { door:'blocked', reason:string, cause?:unknown }} WorldGroupDoor
 */

/**
 * Fail-closed join of chain commitment + the FULL sim-derived row stream. Exported for the scoped call-site
 * regression test; production obtains each input immediately before composing the fight PTB below.
 * @param {{ world_id:string, spawn_id:number|string, mob_template_id:string, member_template_ids?:string[],
 *   zx:number, zy:number, zone:any, commitment:any, groups:any[] }} input
 *   `member_template_ids` is the roster this engage is about to seat (empty on a mono-spec group).
 * @returns {WorldGroupDoor}
 */
export function world_group_door({
  world_id,
  spawn_id,
  mob_template_id,
  member_template_ids = [],
  zx,
  zy,
  zone,
  commitment,
  groups,
}) {
  if (!zone || !Array.isArray(groups) || !groups.length) return { door: 'blocked', reason: 'zone_unreadable' }
  // A zone searched before the commitment upgrade has nothing to prove against: the derivation door is its ONLY
  // door, and taking it is a deliberate branch — not a swallowed failure.
  if (!commitment) return { door: 'derivation', reason: 'uncommitted_zone' }
  const matches = groups.filter((group) => same_unsigned(group.spawn_id, spawn_id))
  if (matches.length !== 1) return { door: 'blocked', reason: 'stale_stream' }
  const [target] = matches
  if (!same_object_id(target.template_id, mob_template_id)) return { door: 'blocked', reason: 'stale_stream' }
  // FORMAT 3 — the ROSTER gets the same cross-check the primary template already gets: the freshly derived stream
  // must agree, member for member and in order, with the roster we are about to feed `add_member`. A disagreement
  // (a rerolled zone, a stale render) means we are naming a pack that no longer exists — a refusal, not a door.
  const roster = Array.isArray(member_template_ids) ? member_template_ids : []
  const derived_roster = Array.isArray(target.members) ? target.members : []
  if (
    roster.length !== derived_roster.length ||
    roster.some((template_id, slot) => !same_object_id(template_id, derived_roster[slot]))
  )
    return { door: 'blocked', reason: 'stale_stream' }
  const index = Number(target.index)
  if (!Number.isSafeInteger(index) || index < 0) return { door: 'blocked', reason: 'stale_stream' }
  // Consumption is MONOTONIC on chain and the served bitmap can only lag BEHIND it, so a set bit is always true:
  // refusing here is the same outcome the claim door would abort with (108), minus the burned gas.
  const consumed = ((Number(zone.mob_bitmap?.[index >> 3] ?? 0) >> (index & 7)) & 1) !== 0
  if (consumed) return { door: 'blocked', reason: 'consumed' }
  // The member claim door takes NO witness: a format-3 commitment covers the whole derived set, so the chain's own
  // re-derivation IS the proof (`create_member_fight_ptb` has no `group_proof` parameter). Composing one here would
  // also be impossible — the commitment preimage carries the RAW rolled roster while a `derive_zone` row carries the
  // team-bound-TRIMMED one — so the digest could never reproduce and every format-3 engage would refuse.
  if (roster.length) return { door: 'derivation', reason: 'member_roster_door', index }
  const proof = compose_mob_group_proof({
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
  if (!proof) return { door: 'blocked', reason: 'commitment_mismatch' }
  return { door: 'proof', proof, index }
}

/** @returns {Promise<WorldGroupDoor>} */
async function load_world_group_door({ sdk, world_id, spawn_id, mob_template_id, member_template_ids, zx, zy }) {
  // No zone coordinates ⇒ the occupied-zone claim door, which takes no witness at all.
  if (zx == null || zy == null) return { door: 'derivation', reason: 'occupied_zone_door' }
  // DOOR POLARITY (the SDK's law): on a deployment whose ceremony never stamped the ZoneGroupRootKey origin,
  // create_fight_ptb ignores a supplied witness — so composing one there would be theatre, and failing on it
  // would refuse an engage the chain accepts.
  if (!aresrpg_id(DEMO_NETWORK, 'ZONE_GROUP_ROOT_PACKAGE_ID'))
    return { door: 'derivation', reason: 'unstamped_network' }
  try {
    const read_context = { grpc_client: sdk.grpc_client, network: DEMO_NETWORK }
    const [zone, commitment, world, config] = await Promise.all([
      get_zone_state(read_context)(world_id, zx, zy),
      get_zone_group_commitment(read_context)(world_id, zx, zy),
      zone_world_doc(world_id),
      get_config().catch(() => null),
    ])
    if (!zone || !world) return { door: 'blocked', reason: 'zone_unreadable' }
    // Commitments cover EVERY search-time group, including consumed siblings. Clear only the mob bitmap before
    // calling the existing sim mirror; world_group_door checks that the selected target is still live. The zone
    // state carries the commitment root, which selects WHICH derivation the zone was searched under — a stream
    // derived without it is a different world than the chain's.
    const groups = rows_from_state(
      { ...zone, mob_bitmap: [] },
      zx,
      zy,
      world,
      config?.dials?.team_size_bound != null ? Number(config.dials.team_size_bound) : 6
    ).filter((row) => row.kind === 'mob')
    return world_group_door({
      world_id,
      spawn_id,
      mob_template_id,
      member_template_ids,
      zx,
      zy,
      zone,
      commitment,
      groups,
    })
  } catch (cause) {
    // A read that threw is a refusal with a reason, not a quieter door.
    return { door: 'blocked', reason: 'zone_unreadable', cause }
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
 *
 * WHICH door composes is DERIVED from `member_template_ids` — the roster the zone row carried into the claim
 * request (`derive_zone` row `.members`, format 3 / #1110). A roster means the pack is a real member list, so
 * the `*_members` claim door seats it one `add_member` at a time; no roster is the mono-spec door, unchanged.
 * There is no flag: a format-1/2 row has no roster to carry, and that absence IS the signal.
 * @param {{ world_id:string, spawn_id:number|string, zx?:number|null, zy?:number|null, mob_template_id:string,
 *           member_template_ids?:string[], character_id:string, is_public?:boolean,
 *           party_id?:string|null }} args
 * @returns {Promise<{ receipt:any, fight_id:string|null, group:{ world_id:string, zx:number, zy:number,
 *   index:number }|null }>} `group` NAMES the claimed group for the #609 defeat release (null when the door
 *   named no row — then a defeat releases nothing rather than guessing).
 */
export async function create_world_fight({
  world_id,
  spawn_id,
  zx = null,
  zy = null,
  mob_template_id,
  member_template_ids = [],
  character_id,
  is_public = true,
  party_id = null,
}) {
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not connected')
  const sdk = await time_engage_leg('sdk', () => get_sdk())
  const [handle, group_door, live_fights, raised_spell_ids] = await Promise.all([
    time_engage_leg('kiosk', () => kiosk_for_character(sdk, address, character_id)),
    time_engage_leg('group_door', () =>
      load_world_group_door({ sdk, world_id, spawn_id, mob_template_id, member_template_ids, zx, zy })
    ),
    // TOCTOU SHRINK (leg ③): the SAME /v1 fight truth the engage affordance gates on, read FRESH here (parallel
    // with the kiosk/proof reads — zero added latency) so the residual poll-lag window between the affordance's
    // 6s snapshot and this press collapses to one read. A claimed spawn shows a live fight here even when the
    // client's polled set was still stale (the exact regression TOCTOU SHRINK addresses).
    time_engage_leg('live_fights', () => get_fights({ world: world_id }).catch(() => null)),
    // #1206: the seat's LEARNED spell levels are snapshotted for EXACTLY the ids this PTB names — an unnamed
    // spell casts at the free baseline 1 whatever the character invested. Read in the same parallel leg.
    time_engage_leg('raised_spells', () => raised_spell_ids_for(character_id)),
  ])
  // A CHARACTER-scoped refusal: this seat cannot claim ANY group anywhere until its character is back in the
  // kiosk, so the throw declares that scope itself (it never reaches the chain, so it carries no abort to
  // decode). #1263 — a scan that re-learns this fact once per candidate spends its whole ceiling on one fact.
  if (!handle) throw Object.assign(new Error('That character is not in your kiosk'), { refusal_scope: 'character' })
  // A live fight already holds this spawn ⇒ refuse PRE-SIGN (zero gas, no digest) with the structured zones-108
  // shape, IMMEDIATELY before compose/sign. The throw propagates to engage()'s catch, which reads the 108 and
  // reconciles (ghost-drop the row + re-poll) — identical to the on-chain claim race, minus the burned gas.
  if (group_engage_blocked(live_fights, spawn_id)) throw tx_error(GROUP_CLAIMED_ABORT, { preflight: true })
  // The DOOR, decided honestly (issue #810). A group we cannot prove is a refusal PRE-SIGN: a quiet proofless
  // submit would name a group on the strength of a stream we just failed to reconcile with the chain, and
  // surface as a misleading downstream abort. A target the bitmap shows consumed refuses with the SAME 108
  // shape the claim race produces, so engage() reconciles it exactly like the on-chain loss.
  if (group_door.door === 'blocked') {
    if (group_door.reason === 'consumed') throw tx_error(GROUP_CLAIMED_ABORT, { preflight: true })
    throw new Error(i18n.t('errors.group_proof_unavailable'), { cause: group_door.cause ?? group_door.reason })
  }
  const entry = {
    world_id,
    kiosk_id: handle.kiosk_id,
    personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
    character_id,
    raised_spell_ids,
    spawn_id,
    zx,
    zy,
    is_public,
    party_id,
  }
  const tx = time_engage_leg('ptb', () =>
    member_template_ids.length
      ? create_member_fight_ptb(ctx_of(sdk))({ ...entry, member_template_ids })
      : create_fight_ptb(ctx_of(sdk))({
          ...entry,
          group_proof: group_door.door === 'proof' ? group_door.proof : null,
          mob_template_id,
        })
  )
  // #609 — the claimed group's IDENTITY, carried out of the claim so a LOST fight can give it back at
  // settlement (`fight::release_group`). Only a VICTORY consumes a group; a defeat that forgets which group it
  // took drains the world's mob population by one, permanently. Known only where the door named a row.
  const group =
    group_door.index != null && zx != null && zy != null ? { world_id, zx, zy, index: group_door.index } : null
  mark_engage_ptb_built(tx)
  use_fight_cost.getState().reset() // FRESH fight entry — its own gas is the first line of the new total
  clear_budget_cache() // and drop any prior fight's cached act budgets (a new fight = new shapes)
  clear_fight_ref_cache() // + the prior fight's pinned shared-ref (a new fight = a new object)
  clear_gas_coin_cache() // + the prior fight's chained gas-coin pin (a new fight re-selects + re-chains)
  const receipt = await sign(tx, i18n.t('fights.action_engage'))
  const fight_id = remember_created_fight(receipt) // + cache its pinned shared ref (zero-read)
  note_engage_fight_id(tx, fight_id)
  return { receipt, fight_id, group }
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
