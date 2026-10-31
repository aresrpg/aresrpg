// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { TOURNAMENT_MAX_TEAMS } from '@aresrpg/sdk/tournament'
import type { CharacterRow, TournamentMatch, TournamentRow } from '@aresrpg/protocol'

import { rolled_item_types } from '../../src/modules/claims.ts'

export const NOW = 1_900_000
export const character: CharacterRow = {
  id: 'hero',
  name: 'Nox',
  classe: 'senshi',
  sex: 'male',
  experience: '0',
  level: 10,
  color_1: 0,
  color_2: 0,
  color_3: 0,
  vitality: 10,
  wisdom: 0,
  strength: 5,
  intelligence: 0,
  chance: 0,
  agility: 0,
  available_points: 0,
  spells: {},
  available_spell_points: 0,
  jobs: {},
  kiosk: 'kiosk',
  custody: 'kiosk',
  equipment: [],
  world: 'nauvis',
  checkpoint_world: 'nauvis',
  x: 50000,
  z: 50000,
  at_ms: 0,
}
const seat = (index: number, ordinal: number) => ({
  character: `other-${index}-${ordinal}`,
  owner: `other-${index}`,
  name: ['Aoi', 'Juno', 'Mirelle'][ordinal % 3],
  sui_claimed: false,
  token_claimed: false,
  items_claimed: '0',
})
const team_names = [
  'Moon Owls',
  'Iron Foxes',
  'Azure Wolves',
  'Golden Cranes',
  'Saltwind Corsairs',
  'Ember Pact',
  'Nine Lanterns',
  'The Long Night Over Thebes',
]
const teams = (count: number, complete = true, format = 3) =>
  Array.from({ length: count }, (_, index) => ({
    name: team_names[index % team_names.length] + (index > 7 ? ` ${index + 1}` : ''),
    revision: '3',
    allowed: [] as string[],
    allowed_names: {} as Record<string, string>,
    place: 0,
    seats: Array.from({ length: complete ? format : (index % format) + 1 }, (_, ordinal) => seat(index, ordinal)),
  }))
const empty_match = (): TournamentMatch => ({
  a: null,
  b: null,
  available_ms: 0,
  state: 0,
  winner: null,
  loser: null,
  fight: null,
})
const result = (a: number | null, b: number | null): TournamentMatch => ({
  ...empty_match(),
  a,
  b,
  state: 2,
  winner: a ?? b,
  loser: [a, b].includes(null) ? null : b,
  available_ms: NOW - 5000,
})
const first_round = (count: number, size: number, finished: boolean): readonly TournamentMatch[] =>
  Array.from({ length: size / 2 }, (_, a) => {
    const b = a + size / 2 < count ? a + size / 2 : null
    if (finished || b === null) return result(a, b)
    return {
      ...empty_match(),
      a,
      b,
      state: 1,
      available_ms: NOW - 5000,
      fight: `fight-${size / 2 - 1 + a}`,
      phase: 'active',
      joined: [],
    }
  })
const bracket = (count: number, finished = false): readonly TournamentMatch[] => {
  const size = 2 ** Math.ceil(Math.log2(count))
  const rows = [...Array.from({ length: size / 2 - 1 }, empty_match), ...first_round(count, size, finished)]
  if (size === 2) return rows
  rows.push(empty_match())
  if (!finished) return rows
  for (let index = size / 2 - 2; index >= 0; index--)
    rows[index] = result(rows[2 * index + 1].winner, rows[2 * index + 2].winner)
  rows[size - 1] = result(rows[1].loser, rows[2].loser)
  return rows
}
const base = (): TournamentRow => ({
  id: 'cup',
  version: '7',
  name: 'Autumn Championship',
  status: 'open',
  organizer: 'organizer',
  format: 3,
  entry_fee_mist: '0',
  max_level: null,
  start_before_ms: NOW + 8_040_000,
  kares_pool: 'pool',
  token_version: '7',
  token_refunded: false,
  sui_bps: [5000, 2500, 1500, 500, 500],
  token_bps: [4000, 2500, 1500, 500, 1500],
  sui_pool: '250123456789',
  token_pool: '50000000000000',
  sui_total: '250123456789',
  token_total: '50000000000000',
  rewards: [...rolled_item_types().keys()]
    .slice(0, 2)
    .map((template, index) => ({ template, place: index + 1, amount: 1 })),
  teams: teams(8, false),
  matches: [],
})
const own = (row: TournamentRow): TournamentRow => {
  const seats = ['hero', 'alt']
    .slice(0, row.format)
    .map((character, index) => ({ ...seat(0, index), character, owner: 'owner', name: ['Nox', 'Rin'][index] }))
  return {
    ...row,
    teams: row.teams.map((team, index) =>
      index === 0 ? { ...team, seats: [...seats, ...team.seats.slice(seats.length)] } : team
    ),
  }
}
const placed = (row: TournamentRow): TournamentRow => {
  const bronze = row.matches.at(-1)!
  const places = new Map([
    [row.matches[0].winner, 1],
    [row.matches[0].loser, 2],
    [bronze.winner, 3],
    [bronze.loser, 4],
    ...row.matches.slice(3, 7).map((match) => [match.loser, 5] as const),
  ])
  return { ...row, teams: row.teams.map((team, index) => ({ ...team, place: places.get(index) ?? 0 })) }
}
const finished = () =>
  placed(own({ ...base(), status: 'finished', finished_at_ms: NOW - 1000, teams: teams(8), matches: bracket(8, true) }))
const live = (count: number, format: 1 | 3 | 6 = 3) =>
  own({ ...base(), status: 'in_progress', format, teams: teams(count, true, format), matches: bracket(count) })
const match_state = (patch: Partial<TournamentMatch>): TournamentRow => {
  const row = live(4)
  return { ...row, matches: row.matches.map((match, index) => (index === 1 ? { ...match, ...patch } : match)) }
}
const admission = () => match_state({ phase: 'placement', available_ms: NOW - 49_000, joined: ['other-2-0'] })
const SCENARIOS: Readonly<Record<string, () => TournamentRow>> = {
  open_sui: () => ({ ...base(), kares_pool: null, token_pool: '0', token_total: '0', token_refunded: true }),
  restricted: () => {
    const row = base()
    return {
      ...row,
      teams: row.teams.map((team, index) =>
        index === 0
          ? { ...team, allowed: ['other-0-0', 'hero', 'reserved'], allowed_names: { hero: 'Nox', reserved: 'Tamsin' } }
          : team
      ),
    }
  },
  registered: () => own(base()),
  add_owned: () => own(base()),
  live8: () => live(8),
  dense: () => live(TOURNAMENT_MAX_TEAMS),
  byes: () => live(5),
  three: () => live(3),
  two: () => live(2, 1),
  sixteen: () => live(16),
  sixv6: () => live(4, 6),
  admission,
  entry_failure: admission,
  dependency_timeout: () => {
    const row = live(4)
    return {
      ...row,
      matches: row.matches.map((match, index) =>
        index === 1 ? result(0, 2) : index === 2 ? { ...match, available_ms: NOW - 1_800_001 } : match
      ),
    }
  },
  start_due: () => match_state({ phase: 'placement', available_ms: NOW - 60_001, joined: ['hero'] }),
  no_show: () => match_state({ phase: undefined, fight: null, available_ms: NOW - 60_001, joined: undefined }),
  timeout: () => match_state({ available_ms: NOW - 1_800_001 }),
  recording: () => match_state({ phase: 'ended', fight_winner: 0 }),
  finished,
  items_only: () => ({ ...finished(), sui_pool: '0', token_pool: '0', sui_total: '0', token_total: '0' }),
  no_champion: () => {
    const row = finished()
    return {
      ...row,
      teams: row.teams.map((team) => ({ ...team, place: 0 })),
      matches: row.matches.map((match) => ({ ...match, winner: null, loser: null })),
    }
  },
  level_limited: () => ({ ...base(), max_level: 1 }),
  paid: () => ({ ...base(), entry_fee_mist: '123456789' }),
  expired: () => ({ ...base(), start_before_ms: NOW - 1 }),
  cancelled: () => ({ ...base(), status: 'cancelled' }),
  public_start: () => ({ ...base(), start_before_ms: NOW - 1, teams: teams(8) }),
  admin_start: () => ({
    ...base(),
    start_before_ms: NOW - 1,
    teams: [...teams(8), { ...teams(1)[0], name: 'Incomplete', seats: [seat(8, 0)] }],
  }),
}
export const tournament_scenario = (
  scenario: string
): Readonly<{ rows: readonly TournamentRow[]; characters: readonly CharacterRow[] }> => {
  const row = (SCENARIOS[scenario] ?? base)()
  if (scenario === 'empty') return { rows: [], characters: [character] }
  const hero: CharacterRow =
    scenario === 'timeout' ? { ...character, custody: 'fight', active_fight: { id: 'fight-1', seat: 0 } } : character
  return {
    characters: [
      hero,
      { ...character, id: 'alt', name: 'Rin', kiosk: 'alt-kiosk' },
      ...(scenario === 'add_owned' ? [{ ...character, id: 'third', name: 'Kaori', kiosk: 'third-kiosk' }] : []),
    ],
    rows: scenario === 'recovery' ? [row, { ...finished(), id: 'old-cup', name: 'Previous Championship' }] : [row],
  }
}
