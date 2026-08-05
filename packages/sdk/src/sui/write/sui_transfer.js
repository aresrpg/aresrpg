// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction } from '@mysten/sui/transactions'

// THE ONE composer for a plain SUI transfer (the wallet's Send door). No Move call, no deployment id — pure
// coin plumbing — so it lives here beside the other write doors rather than being hand-rolled at each call
// site (it used to be written twice inside the frontend send store: once to price the dry-run, once to sign).
//
// TWO SHAPES, one decision, taken from the data:
//
//   amount_mist = <bigint>  PARTIAL — split the amount off the gas coin and transfer the split:
//                           SplitCoins(GasCoin,[amount]) → TransferObjects([Result],recipient).
//                           The sender keeps the remainder AND pays the fee from it.
//
//   amount_mist = null      DRAIN — transfer the GAS COIN ITSELF:
//                           TransferObjects([GasCoin],recipient).
//                           This is the canonical Sui empty-wallet shape: the network fee is charged to the
//                           very coin being transferred, so the recipient receives balance − actual fee and
//                           the sender lands on EXACT zero. No fee estimate, no dust, no kept buffer — a
//                           "keep 0.2 SUI for gas" reserve is precisely what makes a wallet un-emptiable.
//                           Multi-coin wallets need no explicit sweep: with no preset gas payment the Sui
//                           client resolves gas from EVERY SUI coin the sender owns (@mysten/sui
//                           core-resolver `setGasPayment` — the whole address balance is reserved into the
//                           gas coin when the PTB uses it), and gas smashing merges them into the single
//                           coin this command transfers.
//
// MONEY LAW: a transfer PTB moves value off `tx.gas`, so it is `sponsor_excluded` at every call site — a
// sponsored gas coin would fund the transfer, and under the DRAIN shape it would BE the transfer. The
// sponsor server refuses TransferObjects outright (api/sponsor.mjs command-graph scope), which is the second
// wall behind that rule.

/**
 * Compose a SUI transfer PTB.
 * @param {object} params
 * @param {string} params.sender             the signing address
 * @param {string} params.recipient          normalized destination address
 * @param {bigint | null} params.amount_mist MIST to send, or null to DRAIN the whole wallet
 * @returns {Transaction}
 */
export function sui_transfer_ptb({ sender, recipient, amount_mist }) {
  const tx = new Transaction()
  tx.setSender(sender)

  if (amount_mist === null) {
    tx.transferObjects([tx.gas], tx.pure.address(recipient))
    return tx
  }

  if (amount_mist <= 0n)
    throw new Error(
      `[sui_transfer] amount_mist must be positive (got ${amount_mist}) — use null to drain the wallet.`,
    )

  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount_mist)])
  tx.transferObjects([coin], tx.pure.address(recipient))
  return tx
}
