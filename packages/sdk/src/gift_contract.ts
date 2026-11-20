// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** Owner-chosen floor (0.1 SUI): below it the gift page asks for SUI before any step. Each of the three
 * player-paid steps reserves the SDK gas budget (0.05 SUI) but spends far less. */
export const GIFT_FUNDING_MIST = 100_000_000n
export type GiftAction = 'redeem' | 'open' | 'collect'
export type GiftProof = Readonly<{ giftcard: string; redeem?: string; open?: string; collect?: string }>
export type GiftStatus = Readonly<{
  stage: 'missing' | 'available' | 'voucher' | 'crate' | 'reward' | 'collected'
  proof: GiftProof | null
  kiosk?: string
  crate?: string
  claim?: string
  reward_template?: string
  amount?: number
  item?: string
}>
export type GiftErrorCode = 'invalid' | 'ineligible' | 'unavailable' | 'unauthorized'

export class GiftError extends Error {
  readonly code: GiftErrorCode
  constructor(code: GiftErrorCode, options?: ErrorOptions) {
    super(`Gift ${code}`, options)
    // eslint-disable-next-line functional/no-this-expressions -- Error subclasses retain their typed failure code.
    this.code = code
  }
}
