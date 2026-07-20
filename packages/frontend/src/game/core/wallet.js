// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// zkLogin (Enoki) wallet helpers. The fork keeps ONE Enoki registration owned by the companion shell
// (src/auth/index.ts): it does the single wallet-standard Enoki registration. The game receives the
// authenticated session via the one-way session bridge (action/sui_login) and reads the chain through the
// SDK's shared gRPC Core client (get_sui_balance below). The game's own 2nd Enoki registration +
// single-fullnode SuiClient were dev-hatches (flag c), stripped. The wallet-standard registry is a
// window-global singleton, so any lookup here still resolves the companion's single registration.

import { isEnokiWallet } from '@mysten/enoki'
import { getWallets } from '@mysten/wallet-standard'

// #23/D79: this module's OWN read (get_sui_balance) goes through the SDK's gRPC Core API client.
import { get_sdk } from '../../chain/sdk'
import { game_log } from '../../core/log.js'

/** @returns {import('@mysten/wallet-standard').Wallet | null} */
const find_enoki_google_wallet = () => {
  const wallets = getWallets().get().filter(isEnokiWallet)
  return wallets.find((w) => w.name.toLowerCase().includes('google')) ?? wallets[0] ?? null
}

/**
 * @typedef {{
 *   address: string,
 *   wallet: import('@mysten/wallet-standard').Wallet,
 *   account: import('@mysten/wallet-standard').WalletAccount,
 * }} Session
 */

/** @type {Session | null} */
let session = null

/** @returns {Session | null} */
export const current_session = () => session
/** @returns {string | null} */
export const current_address = () => session?.address ?? null
/** Install a session directly (the companion's dev-login is the sole dev native-wallet). @param {Session} s */
export const set_session = (s) => {
  session = s
}

/**
 * Force the zkLogin gate (Enoki Google popup). Resolves with the session once connected.
 * @returns {Promise<Session>}
 */
export const ensure_login = async () => {
  if (session) return session
  const wallet = find_enoki_google_wallet()
  if (!wallet) throw new Error('Enoki Google wallet not available')
  const connect = /** @type {any} */ (wallet.features)['standard:connect']
  const { accounts } = await connect.connect()
  const account = accounts[0]
  if (!account?.address) throw new Error('zkLogin returned no account')
  session = { address: account.address, wallet, account }
  return session
}

/**
 * Silently restore a persisted Enoki session on boot — NO Google popup. Enoki keeps the zkLogin
 * session (ephemeral key + proof) in storage across reloads, so an already-signed-in player can
 * reconnect and auto-sign the server challenge without re-authenticating. Returns the session if one
 * is restorable, else null (→ the login modal is shown). Resolves quietly on any failure.
 * @returns {Promise<Session | null>}
 */
export const restore_session = async () => {
  if (session) return session
  const wallet = find_enoki_google_wallet()
  if (!wallet) return null
  // A valid stored session surfaces as an already-authorized account after re-registration; if not
  // yet populated, a silent connect resolves it without a popup (and no-ops if there's no session).
  let account = wallet.accounts?.[0]
  if (!account?.address) {
    try {
      const connect = /** @type {any} */ (wallet.features)['standard:connect']
      const { accounts } = await connect.connect({ silent: true })
      account = accounts?.[0]
    } catch {
      return null
    }
  }
  if (!account?.address) return null
  session = { address: account.address, wallet, account }
  return session
}

/**
 * The connected player's spendable SUI balance in WHOLE SUI (not MIST), or null if there's no
 * session or the read failed. Single source for both the account chip and the paid-character
 * affordability gate so they never disagree. 1 SUI = 1e9 MIST.
 * @returns {Promise<number | null>}
 */
export const get_sui_balance = async () => {
  const address = current_address()
  if (!address) return null
  try {
    // gRPC Core API — `balance.balance` is the total MIST (JSON-RPC `totalBalance` equivalent).
    const { grpc_client } = await get_sdk()
    const { balance } = await grpc_client.core.getBalance({ owner: address })
    return Number(balance.balance) / 1e9
  } catch (error) {
    game_log('wallet', 'balance read failed', error)
    return null
  }
}

export const logout = () => {
  session = null
  // DEV-only: drop the sticky dev-login marker so the in-world "Log out" (which reloads right after)
  // actually signs a dev out instead of the persisted ?dev session re-authenticating on boot.
  // Build-stripped in prod (DEV branch + dev_wallet is dynamically imported, so it stays tree-shaken).
  if (import.meta.env.DEV) void import('../../auth/dev_wallet').then((m) => m.clear_dev_login()).catch(() => {})
  const wallet = find_enoki_google_wallet()
  const disconnect = /** @type {any} */ (wallet?.features)?.['standard:disconnect']
  // best-effort: clear the persisted Enoki session so the next boot prompts a fresh login
  return disconnect?.disconnect?.().catch?.(() => {})
}
