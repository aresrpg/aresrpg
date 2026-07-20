// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PARTY actions — every membership mutation is keyed by one exact Character ID and proves current custody
// through that character's personal kiosk + PersonalKioskCap. The SDK builders own the Move call shapes and target
// `SOCIAL_LATEST_PACKAGE_ID::party`; this seam owns proof resolution, wallet signing, and receipt handling.

import {
  create_party_ptb,
  party_invite_ptb,
  party_accept_ptb,
  party_invite_accept_own_ptb,
  party_decline_ptb,
  party_kick_ptb,
  party_leave_ptb,
  party_disband_ptb,
} from '@aresrpg/sdk/social'

import { use_auth, sign_and_execute_transaction } from '../auth'
import { get_sdk } from '../chain/sdk'
import { normalize_receipt } from '../chain/receipt'
import { DEMO_NETWORK } from '../chain/deployment'
import { use_toast } from '../toast'
import i18n from '../i18n'
import { tx_error, parse_move_abort } from '../game/core/abort_copy.js'
import { game_log } from '../core/log.js'
import { report_error } from '../core/report.js'

import { kiosk_for_character } from './kiosk_resolve.js'

const CTX = { network: DEMO_NETWORK }

const short_id = (/** @type {string} */ id) => `${id.slice(0, 6)}…${id.slice(-4)}`

async function sign(/** @type {any} */ tx, /** @type {string} */ label, { silent = false } = {}) {
  const { address, wallet_name } = use_auth.getState()
  if (!address || !wallet_name) throw new Error('Not signed in')
  const sdk = await get_sdk()
  const settle = (async () => {
    const { digest } = await sign_and_execute_transaction(wallet_name, address, tx)
    const res = normalize_receipt(
      await sdk.grpc_client.core.waitForTransaction({ digest, include: { effects: true, objectTypes: true } })
    )
    if (res?.effects?.status?.status !== 'success') {
      game_log('party-tx', `failed on-chain (${digest}):`, res?.effects?.status?.error)
      throw tx_error(res?.effects?.status?.error)
    }
    return res
  })()
  // System-initiated party formation (ensure_owned_party at combat entry) runs QUIET: the tx still executes and
  // its failure still throws (the caller humanizes + surfaces it), it just never opens the create toast — that
  // one is reserved for the human's own explicit create click. We silence the TOAST, never the failure
  // TELEMETRY: a create that burned gas and failed still reports to Sentry (dedup-stamped so it never
  // double-sends), matching what the toast path reported at HEAD.
  if (silent)
    return settle.catch((error) => {
      report_error(error, { area: 'party', action: 'auto_create' })
      throw error
    })
  return use_toast.getState().promise(settle, {
    pending: i18n.t('party.tx_pending', { label }),
    success: label,
  })
}

/** Resolve the exact selected/acting character's kiosk proof; never pick a wallet's first kiosk. */
async function character_proof(/** @type {string} */ character_id) {
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not signed in')
  const sdk = await get_sdk()
  const proof = await kiosk_for_character(sdk, address, character_id)
  if (!proof) throw new Error(i18n.t('errors.item_wrong_kiosk'))
  return proof
}

/** Extract the newly shared party id from a create receipt. */
function party_id_from_receipt(/** @type {any} */ receipt) {
  const created = (receipt?.objectChanges ?? []).find(
    (/** @type {any} */ change) =>
      change.type === 'created' && String(change.objectType ?? '').endsWith('::party::Party')
  )
  return created?.objectId ?? null
}

/** Create one party for the exact leader character. `silent` suppresses the create toast for system auto-forms. */
export async function create_party(/** @type {string} */ leader_character_id, { silent = false } = {}) {
  const proof = await character_proof(leader_character_id)
  const tx = create_party_ptb(CTX)({
    ...proof,
    leader_character_id,
  })
  const receipt = await sign(tx, i18n.t('party.action_create'), { silent })
  return { receipt, party_id: party_id_from_receipt(receipt) }
}

/** The exact leader character records an invitation for one exact character + expected owner. */
export async function invite_to_party(
  /** @type {string} */ party_id,
  /** @type {string} */ leader_character_id,
  /** @type {string} */ invited_character_id,
  /** @type {string} */ invited_owner
) {
  const proof = await character_proof(leader_character_id)
  const tx = party_invite_ptb(CTX)({
    party_id,
    leader_kiosk_id: proof.kiosk_id,
    leader_personal_kiosk_cap_id: proof.personal_kiosk_cap_id,
    leader_character_id,
    invited_character_id,
    invited_owner,
  })
  return sign(tx, i18n.t('party.action_invite', { addr: short_id(invited_character_id) }))
}

// EAlreadyInvited self-heal ("Auto follow" repro investigation): party.move's `invite` asserts
// `!contains_invite(&party.pending, invited_character)` — a PENDING invite for this exact character can already
// exist on-chain (a prior single-invite path, e.g. a world right-click "invite to party" on this same alt; or an
// earlier attempt of this same picker flow that reached `invite` and then failed/was abandoned before `accept`).
// `project_party_view` (@aresrpg/party) only ever reads `party.members` — `party.pending` never reaches the
// PartyFrame picker, so it keeps offering this exact character as invitable. Without this, every retry re-runs
// invite+accept and dies at the SAME `invite` assert, FOREVER — no UI path exists to decline the stale invite
// either. SELF-HEAL: the invite already landed, so finish the job with accept-only instead of leaving the
// character permanently stuck on a refusal that never changes.
const PARTY_MODULE = 'party'
const E_ALREADY_INVITED = 203 // aresrpg_social::party::EAlreadyInvited

/**
 * Add distinct same-wallet alts through one sequential invite+accept PTB each. The leader proof is resolved once;
 * every invited character still supplies its own exact kiosk proof, and the first refusal stops the sequence.
 */
export async function join_owned_alts_to_party({
  party_id,
  leader_character_id,
  invited_character_ids = [],
  on_joined,
}) {
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not signed in')
  const leader_proof = await character_proof(leader_character_id)
  const receipts_by_character = new Map()
  for (const invited_character_id of invited_character_ids) {
    if (
      !invited_character_id ||
      invited_character_id === leader_character_id ||
      receipts_by_character.has(invited_character_id)
    )
      continue
    const invited_proof = await character_proof(invited_character_id)
    const tx = party_invite_accept_own_ptb(CTX)({
      party_id,
      leader_kiosk_id: leader_proof.kiosk_id,
      leader_personal_kiosk_cap_id: leader_proof.personal_kiosk_cap_id,
      invited_kiosk_id: invited_proof.kiosk_id,
      invited_personal_kiosk_cap_id: invited_proof.personal_kiosk_cap_id,
      leader_character_id,
      invited_character_id,
      invited_owner: address,
    })
    let receipt
    try {
      receipt = await sign(tx, i18n.t('party.action_invite', { addr: short_id(invited_character_id) }))
    } catch (error) {
      const abort = parse_move_abort(error)
      if (abort?.module === PARTY_MODULE && abort.code === E_ALREADY_INVITED) {
        game_log(
          'party',
          `${invited_character_id.slice(0, 10)} already had a pending invite — accepting it instead of re-inviting`
        )
        receipt = await sign(
          party_accept_ptb(CTX)({ party_id, ...invited_proof, character_id: invited_character_id }),
          i18n.t('party.action_invite', { addr: short_id(invited_character_id) })
        )
      } else {
        let failure = error
        if (error && typeof error === 'object') {
          try {
            error.owned_character_id = invited_character_id
          } catch {
            failure = Object.assign(new Error(String(error?.message ?? error), { cause: error }), {
              owned_character_id: invited_character_id,
            })
          }
        } else
          failure = Object.assign(new Error(String(error?.message ?? error), { cause: error }), {
            owned_character_id: invited_character_id,
          })
        throw failure
      }
    }
    receipts_by_character.set(invited_character_id, receipt)
    await on_joined?.(invited_character_id, receipt)
  }
  return receipts_by_character
}

/** The invited character signs acceptance using its own current custody proof. */
export async function accept_party_invite(/** @type {string} */ party_id, /** @type {string} */ character_id) {
  const proof = await character_proof(character_id)
  const tx = party_accept_ptb(CTX)({ party_id, ...proof, character_id })
  return sign(tx, i18n.t('party.accept_cta'))
}

/** The invited character signs decline using its own current custody proof. */
export async function decline_party_invite(/** @type {string} */ party_id, /** @type {string} */ character_id) {
  const proof = await character_proof(character_id)
  const tx = party_decline_ptb(CTX)({ party_id, ...proof, character_id })
  return sign(tx, i18n.t('party.decline_cta'))
}

/** The exact leader character removes one exact accepted character. */
export async function kick_from_party(
  /** @type {string} */ party_id,
  /** @type {string} */ leader_character_id,
  /** @type {string} */ target_character_id
) {
  const proof = await character_proof(leader_character_id)
  const tx = party_kick_ptb(CTX)({
    party_id,
    leader_kiosk_id: proof.kiosk_id,
    leader_personal_kiosk_cap_id: proof.personal_kiosk_cap_id,
    leader_character_id,
    target_character_id,
  })
  return sign(tx, i18n.t('party.action_kick', { addr: short_id(target_character_id) }))
}

/** Leave by exact character; a multi-member leader transfers leadership to the oldest survivor on-chain. */
export async function leave_party(/** @type {string} */ party_id, /** @type {string} */ character_id) {
  const proof = await character_proof(character_id)
  const tx = party_leave_ptb(CTX)({ party_id, ...proof, character_id })
  return sign(tx, i18n.t('party.action_leave'))
}

/** Delete a solo party after proving current custody of its leader character. */
export async function disband_party(/** @type {string} */ party_id, /** @type {string} */ leader_character_id) {
  const proof = await character_proof(leader_character_id)
  const tx = party_disband_ptb(CTX)({
    party_id,
    leader_kiosk_id: proof.kiosk_id,
    leader_personal_kiosk_cap_id: proof.personal_kiosk_cap_id,
    leader_character_id,
  })
  return sign(tx, i18n.t('party.action_disband'))
}
