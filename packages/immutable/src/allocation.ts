// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import campaign from './allocation_campaign.json' with { type: 'json' }
import { LEADERBOARD_METRICS } from './leaderboards.ts'

export { campaign }
export type Tier = keyof typeof campaign.tiers
export type AwardSource = 'existing' | 'community' | 'manual' | 'leaderboard' | 'social'
export type Award = Readonly<{ address: string; tier: Tier; source: AwardSource; evidence: string }>
export const MAX_ALLOCATION_WALLETS = 10
export type PublicAward = Readonly<{
  address: string
  tier: Tier
  source: 'reserved' | 'leaderboard' | 'social'
  board?: string
}>
export const public_award = ({ address, tier, source, evidence }: Award): PublicAward => {
  if (source !== 'leaderboard' && source !== 'social') return { address, tier, source: 'reserved' }
  const board = LEADERBOARD_METRICS.find((metric) => metric === evidence.split(':')[0])
  return { address, tier, source, ...(source === 'leaderboard' && board ? { board } : {}) }
}
export type AllocationWallet = Readonly<{ address: string; label: string; game_wallet?: boolean }>
export type AllocationStatus = Readonly<{
  wallets: readonly AllocationWallet[]
  awards: readonly PublicAward[]
  /** Allowlist proofs for this account's verified, awarded wallets. */
  proofs?: readonly Readonly<{ address: string; proof: SpotProof }>[]
}>

export const normalize_address = (value: string): string => {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(value)) throw new Error('invalid_address')
  return `0x${value.slice(2).toLowerCase().padStart(64, '0')}`
}
export const cap_mist = (tier: Tier): bigint => BigInt(campaign.tiers[tier].cap_sui) * 1_000_000_000n
export const nominal_tokens = (tier: Tier): number =>
  (Number(cap_mist(tier)) / 1e9) * ((campaign.supply * campaign.sale_bps) / 10_000 / campaign.raise_sui)
export const sui_amount = (mist: bigint): string =>
  `${mist / 1_000_000_000n}.${String(mist % 1_000_000_000n).padStart(9, '0')}`.replace(/\.?0+$/, '')

export type BlastRow = Readonly<{ address: string; cap_mist: bigint }>
/** The one Blast allowlist order: CSV rows and Merkle leaf indexes both follow it. */
export const blast_rows = (awards: readonly Award[]): readonly BlastRow[] => {
  if (new Set(awards.map(({ address }) => normalize_address(address))).size !== awards.length)
    throw new Error('duplicate_address')
  return [...awards]
    .sort((a, b) => a.address.localeCompare(b.address))
    .map(({ address, tier }) => ({ address: normalize_address(address), cap_mist: cap_mist(tier) }))
}
/** Blast handoff stays address/cap only. The audit export retains tiers and sources separately. */
export const blast_csv = (awards: readonly Award[]): string =>
  [
    'address,cap_sui,cap_mist',
    ...blast_rows(awards).map(({ address, cap_mist }) => `${address},${sui_amount(cap_mist)},${cap_mist}`),
  ].join('\n') + '\n'
/** A wallet's position in the Blast allowlist tree. Strings keep u64 values exact over JSON. */
export type SpotProof = Readonly<{ index: string; cap_mist: string; siblings: readonly string[] }>

/** Cache key of a shared card. The value for an awarded card stays identical to the published links. */
export const share_version = (award?: Pick<Award, 'tier'>): string =>
  [
    'voxel-bank-v2',
    campaign.submissions_close_at,
    'final',
    award?.tier ?? 'pending',
    award ? cap_mist(award.tier).toString() : '0',
    award ? Math.round(nominal_tokens(award.tier)) : 0,
  ].join('-')
