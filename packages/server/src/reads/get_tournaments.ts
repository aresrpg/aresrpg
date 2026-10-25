// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { tournament_coin_claims, type TournamentRow, type TournamentTeam, type TournamentSeat } from '@aresrpg/protocol'

import type { Graph, Node } from '../graph.ts'

type RawTournament = Omit<TournamentRow, 'token_pool' | 'token_total' | 'token_version' | 'token_refunded' | 'teams'> &
  Readonly<{
    teams: readonly (Omit<TournamentTeam, 'seats'> &
      Readonly<{ seats: readonly Omit<TournamentSeat, 'token_claimed'>[] }>)[]
  }>

const pool_projection = (pool: Record<string, unknown> | undefined) => {
  if (!pool) return { balance: '0', total: '0', version: '0', refunded: true, claimed: new Set<string>() }
  if (!Array.isArray(pool.claimed)) throw new Error('Tournament KARES claim projection is not an array.')
  return {
    balance: String(pool.balance),
    total: String(pool.total),
    version: String(pool.version),
    refunded: Boolean(pool.refunded),
    claimed: new Set(pool.claimed.map(String)),
  }
}

const pending_prizes = (t: TournamentRow, address: string): boolean =>
  t.status === 'finished' &&
  t.teams.some((team, team_index) =>
    team.seats.some((seat, seat_index) => {
      if (team.place === 0 || seat.owner !== address) return false
      const coins = tournament_coin_claims(t, team_index, seat_index)
      return (
        coins.sui > 0n ||
        coins.kares > 0n ||
        t.rewards.some(
          (reward, index) => reward.place === team.place && (BigInt(seat.items_claimed) & (1n << BigInt(index))) === 0n
        )
      )
    })
  )

export const get_tournaments = async (graph: Graph, address: string): Promise<readonly TournamentRow[]> => {
  // The current event plus this wallet's outstanding prizes. Finished history does not grow the public feed.
  const rows = await graph.read(
    `MATCH (t:Tournament) WHERE t.status IN ['open', 'in_progress'] RETURN t AS tournament
    UNION MATCH (t:Tournament)-[r:REGISTERED]->(:User {address: $address})
    OPTIONAL MATCH (p:TournamentKaresPool {id: t.kares_pool})
    WITH t, r, p WHERE t.status = 'finished' AND r.eligible AND (r.pending OR (p IS NOT NULL AND p.balance <> '0' AND NOT r.character IN p.claimed)) RETURN DISTINCT t AS tournament
    UNION MATCH (t:Tournament), (p:TournamentKaresPool {id: t.kares_pool})
    WHERE t.status IN ['finished', 'cancelled'] AND NOT p.refunded RETURN t AS tournament
    UNION MATCH (t:Tournament) WITH t ORDER BY t.created_ckpt DESC LIMIT 1 RETURN t AS tournament`,
    { address }
  )
  const ordered = [...rows].sort(
    (a, b) =>
      Number((b.tournament as Node)!.properties.created_ckpt) - Number((a.tournament as Node)!.properties.created_ckpt)
  )
  const tournaments = ordered.map(
    ({ tournament }) => JSON.parse(String((tournament as Node)!.properties.data)) as RawTournament
  )
  const fights = tournaments.flatMap((t) => t.matches.flatMap((m) => (m.fight ? [m.fight] : [])))
  const characters = [
    ...new Set(
      tournaments.flatMap((t) =>
        t.teams.flatMap((team) => [...team.allowed, ...team.seats.map((seat) => seat.character)])
      )
    ),
  ]
  const pool_ids = tournaments.flatMap((t) => (t.kares_pool ? [t.kares_pool] : []))
  const [fight_rows, character_rows, pool_rows] = await Promise.all([
    fights.length ? graph.read(`MATCH (f:Fight) WHERE f.id IN ${JSON.stringify(fights)} RETURN f AS fight`) : [],
    characters.length
      ? graph.read(`MATCH (c:Character) WHERE c.id IN ${JSON.stringify(characters)} RETURN c.id AS id, c.name AS name`)
      : [],
    pool_ids.length
      ? graph.read(`MATCH (p:TournamentKaresPool) WHERE p.id IN ${JSON.stringify(pool_ids)} RETURN p AS pool`)
      : [],
  ])
  const pools = new Map(
    pool_rows.map(({ pool }) => {
      const row = (pool as Node)!.properties
      return [String(row.id), row] as const
    })
  )
  const names = new Map(
    character_rows.flatMap((row) =>
      typeof row.name === 'string' && row.name.length > 0 ? [[String(row.id), row.name] as const] : []
    )
  )
  const live = new Map(
    fight_rows.map(({ fight }) => {
      const row = (fight as Node)!.properties
      return [String(row.id), row] as const
    })
  )
  const projected = tournaments.map((t): TournamentRow => {
    const pool = t.kares_pool ? pools.get(t.kares_pool) : undefined
    if (t.kares_pool && !pool) throw new Error('Tournament KARES pool projection is not available yet.')
    const values = pool_projection(pool)
    return {
      ...t,
      token_pool: values.balance,
      token_total: values.total,
      token_version: values.version,
      token_refunded: values.refunded,
      teams: t.teams.map((team) => ({
        ...team,
        allowed_names: Object.fromEntries(team.allowed.flatMap((id) => (names.has(id) ? [[id, names.get(id)!]] : []))),
        seats: team.seats.map((seat) => ({
          ...seat,
          token_claimed: !t.kares_pool || values.claimed.has(seat.character),
          name: names.get(seat.character),
        })),
      })),
      matches: t.matches.map((match) => {
        const f = match.fight ? live.get(match.fight) : undefined
        if (!f) return match
        const machine = JSON.parse(String(f.machine)) as {
          fighters: { kind: { player?: { character: string } }; settled: boolean }[]
        }
        return {
          ...match,
          phase:
            f.phase === 'placement'
              ? ('placement' as const)
              : f.phase === 'ended'
                ? ('ended' as const)
                : ('active' as const),
          fight_winner: f.winner == null ? null : Number(f.winner),
          joined: machine.fighters.flatMap((fighter) => (fighter.kind.player ? [fighter.kind.player.character] : [])),
        }
      }),
    }
  })
  // The query selects recovery candidates; zero-value entitlements are not pending claims.
  return projected.filter(
    (t, index) =>
      index === 0 ||
      t.status === 'open' ||
      t.status === 'in_progress' ||
      !t.token_refunded ||
      pending_prizes(t, address)
  )
}
