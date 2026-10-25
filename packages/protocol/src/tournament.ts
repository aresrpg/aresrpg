// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { basis_points } from '@aresrpg/immutable'

export type TournamentLink = Readonly<{ id: string; index: number }>
export type TournamentSeat = Readonly<{
  character: string
  owner: string
  sui_claimed: boolean
  token_claimed: boolean
  items_claimed: string
  name?: string
}>
export type TournamentTeam = Readonly<{
  name: string
  revision: string
  allowed: readonly string[]
  /** Optional names from the existing Character projection, keyed by allowed character ID. */
  allowed_names?: Readonly<Record<string, string>>
  seats: readonly TournamentSeat[]
  place: number
}>
export type TournamentMatch = Readonly<{
  a: number | null
  b: number | null
  available_ms: number
  state: 0 | 1 | 2
  winner: number | null
  loser: number | null
  fight: string | null
  phase?: 'placement' | 'active' | 'ended'
  joined?: readonly string[]
  fight_winner?: number | null
}>
export type TournamentRow = Readonly<{
  id: string
  version: string
  name: string
  status: 'open' | 'in_progress' | 'finished' | 'cancelled'
  organizer: string
  format: 1 | 3 | 6
  start_before_ms: number
  sui_bps: readonly number[]
  token_bps: readonly number[]
  sui_pool: string
  kares_pool: string | null
  token_version: string
  token_refunded: boolean
  token_pool: string
  sui_total: string
  token_total: string
  rewards: readonly Readonly<{ place: number; template: string; amount: number }>[]
  teams: readonly TournamentTeam[]
  matches: readonly TournamentMatch[]
}>

export const coin_share = (total: string, bps: number, seats: number, ordinal: number): bigint => {
  const allocation = (BigInt(total) * BigInt(bps)) / BigInt(basis_points)
  const count = BigInt(seats)
  return allocation / count + (BigInt(ordinal) < allocation % count ? 1n : 0n)
}

/** Read-only projection of Move's fixed per-seat entitlement, independently net of each claim flag. */
export const tournament_coin_claims = (
  t: TournamentRow,
  team: number,
  seat: number
): Readonly<{ sui: bigint; kares: bigint }> => {
  const roster = t.teams[team]
  if (t.status !== 'finished' || roster.place === 0) return { sui: 0n, kares: 0n }
  const counts = t.teams.map((entry) => (entry.place === roster.place ? entry.seats.length : 0))
  const count = counts.reduce((sum, value) => sum + value, 0)
  const ordinal = counts.slice(0, team).reduce((sum, value) => sum + value, seat)
  const member = roster.seats[seat]
  return {
    sui: member.sui_claimed ? 0n : coin_share(t.sui_total, t.sui_bps[roster.place - 1], count, ordinal),
    kares:
      !t.kares_pool || member.token_claimed
        ? 0n
        : coin_share(t.token_total, t.token_bps[roster.place - 1], count, ordinal),
  }
}
