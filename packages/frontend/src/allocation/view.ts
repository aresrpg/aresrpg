// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  campaign,
  cap_mist,
  nominal_tokens,
  type AllocationStatus,
  type AllocationWallet,
  type PublicAward,
} from '@aresrpg/immutable/allocation'

import type { AuthSession } from '../auth.ts'

export const wallet_label = (wallet: AllocationWallet, session: AuthSession | null): string =>
  wallet.label || (wallet.address === session?.address ? session.wallet_name : '')

export const short_address = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`
export type CardView = Readonly<{ wallet: AllocationWallet; award: PublicAward }>
export const allocation_view = (status: AllocationStatus | null, now: number) => {
  const final = status?.phase === 'final'
  const open = !!status?.submissions_open && now < Date.parse(campaign.submissions_close_at)
  const cards: readonly CardView[] = status
    ? [...new Map(status.wallets.map((wallet) => [wallet.address, wallet])).values()].flatMap((wallet) => {
        const award = status.awards.find(({ address }) => address === wallet.address)
        return award ? [{ wallet, award }] : []
      })
    : []
  const awards = cards.map(({ award }) => award)
  return {
    cards,
    final,
    open,
    spots: awards.length,
    sui: awards.reduce((sum, { tier }) => sum + Number(cap_mist(tier)) / 1e9, 0),
    tokens: awards.reduce((sum, { tier }) => sum + nominal_tokens(tier), 0),
  }
}
export const countdown = (now: number): readonly number[] => {
  const seconds = Math.max(0, Math.floor((Date.parse(campaign.submissions_close_at) - now) / 1000))
  return [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60]
}
