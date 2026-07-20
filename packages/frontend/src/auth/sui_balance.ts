// SINGLE home for the wallet-bar SUI balance fetch + the post-tx invalidation trigger (regression: the
// displayed balance was not refreshed fast enough after a tx). The auth store's
// `refresh_sui_balance` — the ONE writer of `sui_balance_mist` — wraps `read_sui_balance_mist`; every
// balance-display surface (wallet bar mount + focus/visibility, characters drawer, send modal) and every
// executed tx routes through that action, so the sidebar can never show a stale figure again. No polling loops.

import { get_sdk as default_get_sdk } from '../chain/sdk'
import { game_log } from '../core/log.js'

/**
 * Read the connected address's TOTAL SUI balance in MIST via the SDK's gRPC Core client (the JSON-RPC
 * `totalBalance` equivalent). Returns null on ANY read failure so the caller KEEPS its last-known value — a
 * transient RPC hiccup must never blank the display. `get_sdk` is injectable so this is unit-testable with a
 * plain fake (no process-global module mock — the bun mock.module collision hazard, 07-10).
 */
export async function read_sui_balance_mist(
  address: string,
  get_sdk: typeof default_get_sdk = default_get_sdk
): Promise<bigint | null> {
  try {
    const { grpc_client } = await get_sdk()
    const { balance } = await grpc_client.core.getBalance({ owner: address })
    return BigInt(balance.balance)
  } catch (e) {
    game_log('wallet', 'balance read failed — keeping last-known', e)
    return null
  }
}

/**
 * Post-tx balance invalidation (trigger b): run the tx executor, then fire `refresh` ONLY after it
 * RESOLVES — a tx actually executed (success OR on-chain failure; gas moved either way). A pre-sign refusal
 * (the S-54 dry-run) REJECTS, so `refresh` never fires (no gas moved, nothing to invalidate). Generic so the
 * three auth tx doors share ONE invalidation seam.
 */
export async function with_post_tx_refresh<T>(run: () => Promise<T>, refresh: () => void): Promise<T> {
  const result = await run()
  refresh()
  return result
}

/**
 * Post-tx balance SETTLE (regression: a standalone Send-SUI transfer's new balance did not show instantly).
 * The fullnode's coin-balance index lags tx EXECUTION by a moment, so the FIRST getBalance after a tx resolves
 * often still returns the PRE-tx figure — a single-shot refresh then paints the stale amount and never re-reads.
 * Fix: re-drive the caller's single-read `refresh` until the observed store value CHANGES from its pre-refresh
 * value (proof the node reflected the tx), bounded, then give up (best-effort — never blanks, never loops
 * forever). Every tx moves gas, so the value ALWAYS changes once indexed; an already-fresh node settles on the
 * FIRST read (zero extra load). Drives `refresh` (the store's SINGLE writer of the balance) — never writes it here.
 * @param get_current reads the current store balance in MIST (or null when signed out / never read)
 * @param refresh     the store's single-read refresh (getBalance → set); awaited once per attempt
 */
export async function settle_balance_after_tx(
  get_current: () => bigint | null,
  refresh: () => Promise<void>,
  { attempts = 6, delay_ms = 500 }: { attempts?: number; delay_ms?: number } = {}
): Promise<void> {
  const before = get_current()
  for (let i = 0; i < attempts; i++) {
    await refresh()
    if (get_current() !== before) return // settled — the store now shows the post-tx balance
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delay_ms))
  }
}
