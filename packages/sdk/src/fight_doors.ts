// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One fight machine, four owners of its lifecycle doors. Placement, turns and cranks are shared; who
// may ready, start, give up, settle and close a fight belongs to what manages it. This is the one place that
// knows which door each mode uses: the game client and the hosted bot both ask it.

import type { DungeonActions } from './dungeon.ts'
import type { FightActions } from './fight.ts'
import type { KolizeumActions } from './kolizeum.ts'
import type { TournamentActions } from './tournament.ts'

export type FightMode =
  | Readonly<{ type: 'ordinary' }>
  | Readonly<{ type: 'dungeon'; dungeon: string }>
  | Readonly<{ type: 'kolizeum'; kolizeum: string }>
  | Readonly<{ type: 'tournament'; tournament: string; index: number }>
  /** A managed fight whose manager row has not been observed yet: no door is safe to pick. */
  | Readonly<{ type: 'unresolved' }>
type Managers = Readonly<{
  kolizeum?: string | null
  tournament?: Readonly<{ id: string; index: number }> | null
}>
type FightFacts = Readonly<{ dungeon: string | null; managed: boolean }>

/** A room names its dungeon on the fight itself; an arena or a match is named by its manager. */
export const fight_mode = ({ dungeon, managed }: FightFacts, { kolizeum, tournament }: Managers): FightMode => {
  if (tournament) return { type: 'tournament', tournament: tournament.id, index: tournament.index }
  if (kolizeum) return { type: 'kolizeum', kolizeum }
  if (dungeon !== null) return { type: 'dungeon', dungeon }
  return managed ? { type: 'unresolved' } : { type: 'ordinary' }
}

export type FightWallet = Readonly<{
  fight: Pick<FightActions, 'ready' | 'start' | 'forfeit' | 'settle' | 'close'>
  dungeon: Pick<DungeonActions, 'give_up_fight' | 'settle'>
  kolizeum: Pick<KolizeumActions, 'ready' | 'start' | 'exit' | 'forfeit' | 'settle' | 'close'>
  tournament: Pick<TournamentActions, 'ready' | 'crank' | 'forfeit' | 'settle' | 'close'>
}>
type Seat = Readonly<{ fighter_idx: bigint }>
type Custody = Parameters<FightActions['forfeit']>[0]['custody']
/** `placement`: the fight has not started, where an arena seat leaves with its pledge instead of losing. */
type Forfeit = Seat & Readonly<{ custody?: Custody; placement: boolean }>
/** An arena or a match pays one seat and carries no loot; the first settlement names that seat. */
type Settlement = Omit<Parameters<DungeonActions['settle']>[0], 'fight' | 'dungeon'>

const ordinary_doors = ({ fight: actions }: FightWallet, fight: string) => ({
  ready: ({ fighter_idx }: Seat) => actions.ready({ fight, fighter_idx }),
  start: () => actions.start({ fight }),
  forfeit: ({ fighter_idx, custody }: Forfeit) => actions.forfeit({ fight, fighter_idx, custody }),
  settle: ({ mastery: _, ...settlement }: Settlement) => actions.settle({ fight, ...settlement }),
  close: () => actions.close({ fight }),
})
const dungeon_doors = (wallet: FightWallet, fight: string, dungeon: string) => ({
  ...ordinary_doors(wallet, fight),
  forfeit: ({ fighter_idx, custody }: Forfeit) => wallet.dungeon.give_up_fight({ fight, fighter_idx, custody }),
  settle: (settlement: Settlement) => wallet.dungeon.settle({ fight, dungeon, ...settlement }),
})
const kolizeum_doors = ({ kolizeum: actions }: FightWallet, fight: string, kolizeum: string) => ({
  ready: ({ fighter_idx }: Seat) => actions.ready({ kolizeum, fight, fighter_idx }),
  start: () => actions.start({ kolizeum, fight }),
  forfeit: ({ fighter_idx, custody, placement }: Forfeit) =>
    placement
      ? actions.exit({ kolizeum, fight, fighter_idx, custody })
      : actions.forfeit({ fight, fighter_idx, custody }),
  settle: ({ settlements, custody, last }: Settlement) =>
    actions.settle({ kolizeum, fight, fighter_idx: settlements[0]!.fighter_idx, custody, last }),
  close: () => actions.close({ kolizeum, fight }),
})
const tournament_doors = (
  { tournament: actions }: FightWallet,
  match: Readonly<{ tournament: string; index: number; fight: string }>
) => ({
  ready: ({ fighter_idx }: Seat) => actions.ready({ ...match, fighter_indices: [fighter_idx] }),
  start: () => actions.crank(match),
  forfeit: ({ fighter_idx, custody }: Forfeit) => actions.forfeit({ fight: match.fight, fighter_idx, custody }),
  settle: ({ settlements, custody, last }: Settlement) =>
    actions.settle({ ...match, fighter_idx: settlements[0]!.fighter_idx, custody, last }),
  close: () => actions.close(match),
})

/** The lifecycle doors of one fight, or null while its manager is unknown. */
export const fight_doors = (wallet: FightWallet, fight: string, mode: FightMode) => {
  switch (mode.type) {
    case 'ordinary':
      return ordinary_doors(wallet, fight)
    case 'dungeon':
      return dungeon_doors(wallet, fight, mode.dungeon)
    case 'kolizeum':
      return kolizeum_doors(wallet, fight, mode.kolizeum)
    case 'tournament':
      return tournament_doors(wallet, { tournament: mode.tournament, index: mode.index, fight })
    case 'unresolved':
      return null
  }
}
