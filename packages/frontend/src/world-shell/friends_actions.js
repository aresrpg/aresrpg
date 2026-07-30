// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FRIENDS actions (S-18 Command Roster) — the tx seam over @aresrpg/sdk/social's friend-list builders, funneled
// through the ONE instrumented run_tx choke point (world-shell/tx.js) like every gameplay tx. The builders
// target the STANDALONE `aresrpg_social` package via the SDK's stamp-or-throw deployment home: until the
// publish ceremony stamps the ids (SOCIAL_FRIEND_REGISTRY especially) these REFUSE LOUDLY (honest toast + raw
// console error), and the same code goes live at stamp time with zero frontend changes.
//
// The friend list is a ONE-WAY whitelist (no request / no accept — DECISIONS 07-08): create ONCE (soulbound,
// one per address), then add/remove addresses freely. `create_friend_list` returns the promise so the page can
// resolve the new list id from the tx result and chain the first add.

import { create_friend_list_ptb, add_friend_ptb, get_friend_list, remove_friend_ptb } from '@aresrpg/sdk/social'
import { submit_friend_target } from '@aresrpg/world/friend_target'

import { DEMO_NETWORK } from '../chain/deployment'
import { get_sdk } from '../chain/sdk'
import { use_toast } from '../toast'
import i18n from '../i18n'
import { is_suins_name, resolve_suins_address } from '../utils/suins'

import { friends_input, refresh_friends, use_friends } from './friends_adapter.js'
import { get_owner_by_name } from './friends_reads'
import { backoff_delay_ms } from './spend_guard.js'
import { run_tx } from './tx.js'

const CTX = { network: DEMO_NETWORK }

/** CREATE the caller's soulbound friend list (one per address; a 2nd call aborts on-chain). Returns the run_tx
 *  promise → `{ result, timing }`; the page parses the created FriendList id from `result` to chain the add. */
export function create_friend_list() {
  return run_tx('friends_create', create_friend_list_ptb(CTX)({}))
}

/** ADD `addr` to the caller's `friend_list_id` (signed by the caller on-chain; a duplicate add aborts). */
export function add_friend(friend_list_id, addr) {
  return run_tx('friends_add', add_friend_ptb(CTX)({ friend_list_id, addr }))
}

/** REMOVE `addr` from the caller's `friend_list_id` (signed by the caller; a not-present remove aborts). */
export function remove_friend(friend_list_id, addr) {
  return run_tx('friends_remove', remove_friend_ptb(CTX)({ friend_list_id, addr }))
}

/** Pull the created `FriendList` id out of a create-tx receipt (objectChanges), or null. Lets a first "Add
 *  Friend" on a rosterless account create the list AND add in one gesture (two signatures). */
export function created_friend_list_id(result) {
  const changes = result?.objectChanges ?? result?.effects?.objectChanges ?? []
  const created = changes.find(
    (c) =>
      (c?.type === 'created' || c?.$kind === 'created') &&
      String(c?.objectType ?? c?.type ?? '').includes('::friends::FriendList')
  )
  return created?.objectId ?? null
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Wait until the fullnode can resolve a just-created FriendList before building the add transaction. The SDK
 * create door cannot compose the follow-up: Move returns unit and transfers the list instead of returning it.
 * Reuse the house exponential backoff, but bound this user gesture so a degraded read cannot wait forever.
 */
export async function await_friend_list_indexed(
  friend_list_id,
  { attempts = 4, get_sdk_fn = get_sdk, sleep_fn = sleep } = {}
) {
  const { grpc_client } = await get_sdk_fn()
  const read_list = get_friend_list({ grpc_client })
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await read_list(friend_list_id)) return
    if (attempt < attempts) await sleep_fn(backoff_delay_ms(attempt))
  }
  throw new Error('Friend list creation succeeded, but the list is not readable yet')
}

const _is_addr = (/** @type {string} */ a) => /^0x[0-9a-f]{64}$/.test(a)

/** Optimistic add lifecycle: every async result returns through the friend reducer's correlated input door. */
async function submit_friend_add({ my_address, list_id, friend, toast }) {
  const request_id = Symbol('friend_add')
  friends_input({ type: 'friend_add_started', address: my_address, friend, request_id })
  try {
    await toast.promise(add_friend(list_id, friend), {
      pending: i18n.t('friends.pending_add'),
      success: i18n.t('friends.toast_add'),
    })
    friends_input({
      type: 'friend_add_succeeded',
      address: my_address,
      list_id,
      friend,
      request_id,
    })
    void refresh_friends(my_address)
    return { ok: true }
  } catch (error) {
    friends_input({ type: 'friend_add_failed', address: my_address, friend, request_id })
    /* the toast promise already surfaced the humanized failure */
    return { ok: false, error }
  }
}

/** Enter the existing transaction flow with an already-resolved address. */
async function add_friend_address_flow(my_address, target, toast) {
  const addr = String(target ?? '')
    .trim()
    .toLowerCase()
  if (!_is_addr(addr)) return void toast.add(i18n.t('friends.invalid_address'), 'error')
  if (addr === String(my_address ?? '').toLowerCase()) return void toast.add(i18n.t('friends.cannot_add_self'), 'error')
  await refresh_friends(my_address)
  const roster = use_friends.getState()
  if (roster.rows.some((friend) => String(friend.address).toLowerCase() === addr))
    return void toast.add(i18n.t('friends.already_friend'), 'error')
  try {
    let lid = roster.list_id
    if (!lid) {
      const { result } = await toast.promise(create_friend_list(), {
        pending: i18n.t('friends.pending_create'),
        success: i18n.t('friends.toast_create'),
      })
      lid = created_friend_list_id(result)
      if (lid) {
        friends_input({ type: 'friend_list_created', address: my_address, list_id: lid })
        await await_friend_list_indexed(lid)
      }
    }
    if (!lid) return
    await submit_friend_add({ my_address, list_id: lid, friend: addr, toast })
  } catch {
    /* already surfaced by the humanizing toast */
  }
}

/**
 * ADD a player NAME, SuiNS handle, or `0x` address from any friend surface. Prefix detection routes `0x...`
 * straight into the existing validator/transaction flow; otherwise the shared resolver tries the exact
 * character name FIRST (`/v1/names`) and, only when that misses AND the input looks like a SuiNS display form,
 * falls back to SuiNS (`/v1/suins`). The unique match enters the same flow with its current owner. Canonical
 * character names are globally unique, so multiple matches are a projection integrity failure that never
 * selects an arbitrary wallet. A miss names WHICH lookup failed (character vs SuiNS) through the one toast home.
 * @param {string | null} my_address the signed-in wallet
 * @param {string} target player name, SuiNS handle, or address to whitelist
 */
export async function add_friend_flow(my_address, target) {
  const toast = use_toast.getState()
  let resolution
  try {
    resolution = await submit_friend_target(target, {
      find_by_name: get_owner_by_name,
      find_by_suins: resolve_suins_address,
      looks_like_suins: is_suins_name,
      add_address: (address) => add_friend_address_flow(my_address, address, toast),
    })
  } catch {
    return void toast.add(i18n.t('friends.name_lookup_failed'), 'error')
  }

  if (resolution.kind === 'invalid') return void toast.add(i18n.t('friends.invalid_address'), 'error')
  if (resolution.kind === 'not_found') {
    const key = resolution.via === 'suins' ? 'friends.no_suins_handle' : 'friends.no_character_named'
    return void toast.add(i18n.t(key, { name: String(target ?? '').trim() }), 'error')
  }
  if (resolution.kind === 'ambiguous') return void toast.add(i18n.t('friends.name_lookup_failed'), 'error')
}

/**
 * REMOVE `target` from my roster — needs the list id (the panel that shows the row already has it). Toasts the
 * lifecycle. Salvaged from FriendsPage.do_remove (S-67), minus the window.confirm (the caller owns the prompt).
 * @param {string | null} list_id
 * @param {string} target
 */
export async function remove_friend_flow(list_id, target) {
  if (!list_id) return
  const { address } = use_friends.getState()
  if (!address) return
  try {
    await use_toast.getState().promise(remove_friend(list_id, target), {
      pending: i18n.t('friends.pending_remove'),
      success: i18n.t('friends.toast_remove'),
    })
    friends_input({ type: 'friend_removed', address, list_id, friend: target })
    void refresh_friends(address)
  } catch {
    /* already surfaced by the humanizing toast */
  }
}
