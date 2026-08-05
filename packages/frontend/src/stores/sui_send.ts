// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// sui_send.ts — client-side P2P SUI transfer store (no backend).
//
// The whole send flow lives here: recipient resolution (address or player-name), PTB build, and
// sign+execute. It replaces the hand-rolled `_send_listeners` pub/sub that used to sit in ws/index.ts
// with a plain Zustand store — the single source of truth for the send modal's state machine.
//
// State machine (`send.phase`): null (IDLE) → BUILDING → AWAITING_SIGNATURE → EXECUTING →
//                               (SUCCESS | FAILED).
//
// TWO SEND SHAPES, one composer (`@aresrpg/sdk/sui-transfer`): a typed amount splits off the gas coin; MAX
// (`drain`) transfers the gas coin ITSELF so the fee comes out of the transfer and the wallet lands on exact
// zero. Both legs — the dry-run estimate and the signature — compose through the same call, so nothing can
// drift between what the player is quoted and what they sign.
//
// NAME → ADDRESS resolution used the WS player-search (retired with the backend); there is no chain-direct
// player-name lookup yet, so the name branch fails fast with RECIPIENT_NOT_FOUND. Address-mode sends are fully
// live. When a live on-chain name registry exists, only the name branch below changes.

import { create } from 'zustand'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { Transaction } from '@mysten/sui/transactions'
import { sui_transfer_ptb } from '@aresrpg/sdk/sui-transfer'

import { use_auth, sign_and_execute_self_pay_transaction } from '../auth'
import { get_sdk } from '../chain/sdk'
import { sim_gas } from '../game/core/gas_guard.js'
import { game_log } from '../core/log.js'

// Sane fallback shown/used ONLY when the free dry-run simulate itself fails (RPC hiccup) — never a substitute
// for the real number. The bug this replaces: EST. GAS was a hardcoded 0.05 SUI constant (utils/sui_mist.ts
// GAS_BUDGET_MIST), ~25x a real plain-transfer cost (~0.001-0.002 SUI).
export const GAS_ESTIMATE_FALLBACK_MIST = 2_000_000n // ~0.002 SUI

export interface SendState {
  phase: 'BUILDING' | 'AWAITING_SIGNATURE' | 'EXECUTING' | 'SUCCESS' | 'FAILED'
  /**
   * The typed amount. Under `drain` it is the wallet's balance at build time — a DISPLAY figure only: the
   * drain PTB encodes no amount, and what actually lands is balance − the real fee.
   */
  amount_mist: bigint
  /** MAX: transfer the gas coin itself and land the sender on exact zero (see sui_transfer_ptb). */
  drain: boolean
  resolved_address: string
  resolved_name: string | null
  tx_digest: string | null
  error: string | null
  // Real dry-run estimate (computation + storage − rebate), set once BUILDING resolves into AWAITING_SIGNATURE.
  // Undefined only if a caller somehow reads the state before build() finishes — render code falls back to
  // GAS_ESTIMATE_FALLBACK_MIST in that case too.
  gas_estimate_mist?: bigint
}

// Free dry-run of the built transfer PTB (zero gas — simulateTransaction never signs/executes). Reuses the
// EXACT gRPC simulate + gas-math the tx choke (src/tx/index.ts `simulate` + game/core/gas_guard.js `sim_gas`)
// uses to pin the REAL signing budget, so the displayed estimate and the actual charge come from one formula —
// never a second hardcoded number to drift out of sync. Never throws: a simulate hiccup falls back to a small
// sane constant rather than block the send flow over a display number.
async function estimate_gas_mist(tx: Transaction): Promise<bigint> {
  try {
    const { grpc_client } = await get_sdk()
    const sim = await grpc_client.core.simulateTransaction({ transaction: tx, include: { effects: true } })
    const { net } = sim_gas(sim)
    return net > 0n ? net : GAS_ESTIMATE_FALLBACK_MIST
  } catch (e) {
    game_log('send', 'gas estimate simulate failed — using fallback', e)
    return GAS_ESTIMATE_FALLBACK_MIST
  }
}

interface SuiSendStore {
  send: SendState | null
  build: (payload: { address?: string; name?: string; amount_mist: bigint; drain?: boolean }) => Promise<void>
  confirm: () => Promise<void>
  clear: () => void
}

/**
 * THE one place this store turns a send into a PTB — both the dry-run leg and the signing leg call it, so the
 * transaction the player is quoted is byte-for-byte the transaction they sign. The shapes themselves live in
 * the SDK (`@aresrpg/sdk/sui-transfer`); this store never hand-rolls coin plumbing.
 */
const compose = (sender: string, recipient: string, send: Pick<SendState, 'amount_mist' | 'drain'>): Transaction =>
  sui_transfer_ptb({ sender, recipient, amount_mist: send.drain ? null : send.amount_mist })

export const use_sui_send = create<SuiSendStore>((set, get) => ({
  send: null,

  build: async (payload) => {
    const set_send = (s: SendState | null) => set({ send: s })
    const drain = payload.drain === true
    const base = {
      amount_mist: payload.amount_mist,
      drain,
      resolved_name: payload.name || null,
      tx_digest: null,
    }

    const { address: sender, wallet_name } = use_auth.getState()
    if (!sender || !wallet_name) {
      set_send({ ...base, phase: 'FAILED', resolved_name: null, resolved_address: '', error: 'NOT_LINKED' })
      return
    }

    const target_address = payload.address || ''

    // Send-by-name resolution used the WS player-search, retired with the backend. Without a chain-direct
    // name registry a name can't be resolved to an address, so fail fast — address-mode sends are unaffected.
    if (!target_address && base.resolved_name) {
      set_send({ ...base, phase: 'FAILED', resolved_address: '', error: 'RECIPIENT_NOT_FOUND' })
      return
    }

    set_send({ ...base, phase: 'BUILDING', resolved_address: target_address, error: null })

    try {
      const normalized = normalizeSuiAddress(target_address)

      if (normalized.toLowerCase() === sender.toLowerCase()) {
        set_send({ ...base, phase: 'FAILED', resolved_address: normalized, error: 'SELF_SEND' })
        return
      }

      // Free dry-run for the DISPLAYED estimate only — the real signing budget is pinned independently by the
      // tx choke (src/tx/index.ts) when confirm() actually signs. Absorbed into the existing BUILDING spinner
      // phase, so no new UI state is needed.
      const gas_estimate_mist = await estimate_gas_mist(compose(sender, normalized, base))

      set_send({
        ...base,
        phase: 'AWAITING_SIGNATURE',
        resolved_address: normalized,
        error: null,
        gas_estimate_mist,
      })
    } catch (err: any) {
      set_send({
        ...base,
        phase: 'FAILED',
        resolved_address: target_address,
        error: err?.message || 'BUILD_FAILED',
      })
    }
  },

  confirm: async () => {
    const { send } = get()
    if (!send || send.phase !== 'AWAITING_SIGNATURE') return

    const { address: sender, wallet_name } = use_auth.getState()
    if (!sender || !wallet_name) {
      set({ send: { ...send, phase: 'FAILED', error: 'NOT_LINKED' } })
      return
    }

    set({ send: { ...send, phase: 'EXECUTING' } })

    try {
      // MONEY LAW: a transfer moves value off `tx.gas`, so it takes the SELF-PAY door — sponsor gas must never
      // fund a player's outgoing SUI, and under a DRAIN the gas coin IS the transferred object (a sponsored one
      // would send the station's coin away). Same class as the marketplace/shop buys.
      const result = await sign_and_execute_self_pay_transaction(
        wallet_name,
        sender,
        compose(sender, send.resolved_address, send)
      )
      set({ send: { ...send, phase: 'SUCCESS', tx_digest: result.digest } })
    } catch (err: any) {
      const msg = err?.message || 'TX_FAILED'
      const error = msg.includes('reject') || msg.includes('denied') ? 'USER_REJECTED' : msg
      set({ send: { ...send, phase: 'FAILED', error } })
    }
  },

  clear: () => set({ send: null }),
}))
