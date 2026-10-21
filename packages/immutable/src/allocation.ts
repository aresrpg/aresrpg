// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import campaign from '../../../seed/content/allocation_campaign.json' with { type: 'json' }

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
export type AllocationWallet = Readonly<{ address: string; label: string }>

export type Submission = Readonly<{
  user_id: string
  username: string
  address: string
  posts: readonly string[]
  submitted_at: string
}>
export type Metrics = Readonly<{
  id: string
  author_id: string
  likes: number
  reposts: number
  quotes: number
  observed_at: string
}>
export type Board = Readonly<{ metric: string; addresses: readonly string[] }>
export type CampaignPhase = 'registration' | 'review' | 'final'
export type AllocationStatus = Readonly<{
  phase: CampaignPhase
  submissions_open: boolean
  wallets: readonly AllocationWallet[]
  awards: readonly PublicAward[]
  user: Readonly<{ id: string; username: string }> | null
  submission: Submission | null
}>

export const normalize_address = (value: string): string => {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(value)) throw new Error('invalid_address')
  return `0x${value.slice(2).toLowerCase().padStart(64, '0')}`
}
export const tier_slots = (tier: Tier): number => {
  const { existing, community, manual, leaderboard, social } = campaign.tiers[tier]
  return existing + community + manual + leaderboard + social
}
export const cap_mist = (tier: Tier): bigint => BigInt(campaign.tiers[tier].cap_sui) * 1_000_000_000n
export const nominal_tokens = (tier: Tier): number =>
  (Number(cap_mist(tier)) / 1e9) * ((campaign.supply * campaign.sale_bps) / 10_000 / campaign.raise_sui)
export const sui_amount = (mist: bigint): string =>
  `${mist / 1_000_000_000n}.${String(mist % 1_000_000_000n).padStart(9, '0')}`.replace(/\.?0+$/, '')

export const post_id = (value: string): string => {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'].includes(url.hostname))
    throw new Error('invalid_post')
  const match = /^\/[A-Za-z0-9_]+\/status\/(\d{1,25})\/?$/.exec(url.pathname)
  if (!match || url.username || url.password || url.port) throw new Error('invalid_post')
  return match[1]
}
export const submitted_posts = (urls: readonly string[]): readonly string[] => {
  const posts = [...new Set(urls.map(post_id))]
  if (!posts.length || posts.length > campaign.social.max_posts || posts.length !== urls.length)
    throw new Error('invalid_post')
  return posts
}

export const validate_reserved = (awards: readonly Award[]): readonly Award[] => {
  const normalized = awards.map((award) => ({ ...award, address: normalize_address(award.address) }))
  if (new Set(normalized.map(({ address }) => address)).size !== normalized.length) throw new Error('duplicate_address')
  for (const tier of ['veteran', 'member'] as const) {
    for (const source of ['existing', 'community', 'manual'] as const) {
      if (
        normalized.filter((award) => award.tier === tier && award.source === source).length >
        campaign.tiers[tier][source]
      )
        throw new Error('reserved_quota_exceeded')
    }
  }
  if (
    normalized.some(
      ({ tier, source, evidence }) =>
        !['veteran', 'member'].includes(tier) ||
        !['existing', 'community', 'manual'].includes(source) ||
        typeof evidence !== 'string'
    )
  )
    throw new Error('invalid_reserved')
  return normalized
}

export const rank_social = (submissions: readonly Submission[], metrics: readonly Metrics[]) => {
  if (
    new Set(submissions.map(({ user_id }) => user_id)).size !== submissions.length ||
    new Set(submissions.map(({ address }) => normalize_address(address))).size !== submissions.length
  )
    throw new Error('duplicate_submission')
  if (
    metrics.some(
      (metric) =>
        ![metric.likes, metric.reposts, metric.quotes].every((count) => Number.isSafeInteger(count) && count >= 0)
    )
  )
    throw new Error('invalid_metrics')
  const by_id = new Map(metrics.map((metric) => [metric.id, metric]))
  const weights = campaign.social
  return submissions
    .map((submission) => {
      const posts = submission.posts.map((id) => by_id.get(id))
      if (
        !posts.length ||
        posts.length > weights.max_posts ||
        posts.some((post) => !post || post.author_id !== submission.user_id)
      )
        throw new Error(`missing_or_foreign_post:${submission.user_id}`)
      const score = posts.reduce(
        (total, post) =>
          total +
          post!.likes * weights.like_weight +
          post!.reposts * weights.repost_weight +
          post!.quotes * weights.quote_weight,
        0
      )
      return { ...submission, score, count: posts.length }
    })
    .sort(
      (a, b) =>
        b.score * a.count - a.score * b.count ||
        a.submitted_at.localeCompare(b.submitted_at) ||
        a.user_id.localeCompare(b.user_id)
    )
}

/** Each visit is one reserved board slot. Exhausted boards lose that slot to social selection. */
export const leaderboard_visits = (count: number, board_count: number): readonly number[] =>
  board_count === 0 ? [] : Array.from({ length: count }, (_, index) => index % board_count)

const select_players = (
  boards: readonly Board[],
  count: number,
  excluded: ReadonlySet<string>
): readonly Readonly<{ address: string; evidence: string }>[] =>
  leaderboard_visits(count, boards.length).reduce<readonly Readonly<{ address: string; evidence: string }>[]>(
    (rows, index) => {
      const board = boards[index]
      const address = board.addresses.find(
        (candidate) => !excluded.has(candidate) && !rows.some((row) => row.address === candidate)
      )
      return address
        ? [...rows, { address, evidence: `${board.metric}:${board.addresses.indexOf(address) + 1}` }]
        : rows
    },
    []
  )

export const select_awards = (
  reserved: readonly Award[],
  boards: readonly Board[],
  social: Readonly<ReturnType<typeof rank_social>>
): readonly Award[] => {
  const tiers = ['veteran', 'member'] as const
  const players = tiers.reduce<readonly Award[]>((awards, tier) => {
    const selected = select_players(
      boards,
      campaign.tiers[tier].leaderboard,
      new Set(awards.map(({ address }) => address))
    )
    return [...awards, ...selected.map((row) => ({ ...row, tier, source: 'leaderboard' as const }))]
  }, validate_reserved(reserved))
  return tiers.reduce<readonly Award[]>((awards, tier) => {
    const vacancies =
      campaign.tiers[tier].leaderboard -
      players.filter((row) => row.tier === tier && row.source === 'leaderboard').length
    const used = new Set(awards.map(({ address }) => address))
    const winners = social.filter(({ address }) => !used.has(address)).slice(0, campaign.tiers[tier].social + vacancies)
    return [
      ...awards,
      ...winners.map((row) => ({ address: row.address, tier, source: 'social' as const, evidence: row.user_id })),
    ]
  }, players)
}

/** Blast handoff stays address/cap only. The audit export retains tiers and sources separately. */
export const blast_csv = (awards: readonly Award[]): string => {
  if (new Set(awards.map(({ address }) => normalize_address(address))).size !== awards.length)
    throw new Error('duplicate_address')
  return (
    [
      'address,cap_sui,cap_mist',
      ...[...awards]
        .sort((a, b) => a.address.localeCompare(b.address))
        .map(({ address, tier }) => `${normalize_address(address)},${sui_amount(cap_mist(tier))},${cap_mist(tier)}`),
    ].join('\n') + '\n'
  )
}

/** A newly revealed tier or changed cap must not reuse a cached pending social preview. */
export const share_version = (phase: CampaignPhase, award?: Pick<Award, 'tier'>): string =>
  [
    phase,
    award?.tier ?? 'pending',
    award ? cap_mist(award.tier).toString() : '0',
    award ? Math.round(nominal_tokens(award.tier)) : 0,
  ].join('-')
