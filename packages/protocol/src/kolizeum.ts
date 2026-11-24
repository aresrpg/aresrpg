// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Its own entry: it reads the fight contract, which the package root must not pull into the site.
import { CONTRACT_CONSTANTS } from '@aresrpg/fight/move_contract'

import type { CharacterRow, KolizeumLobbyRow } from './packets.ts'

/** A side still seats a joiner: the lobby is open, the board has a start cell left and the format has room. */
export const kolizeum_side_open = (lobby: Readonly<KolizeumLobbyRow>, side: 0 | 1): boolean =>
  lobby.status === 'open' &&
  lobby.fighters.filter((fighter) => fighter.team === side).length < Number(CONTRACT_CONSTANTS.start_cells) &&
  lobby.fighters.filter((fighter) => fighter.team === side && !fighter.settled).length < lobby.format

/** Who may stake on a side: a kiosk-held hero inside the lobby's level band, on a side with room. */
export const kolizeum_joinable = (
  lobby: Readonly<KolizeumLobbyRow>,
  character: Readonly<Pick<CharacterRow, 'custody' | 'level'>>,
  side: 0 | 1
): boolean =>
  [
    character.custody === 'kiosk',
    character.level >= lobby.level_min,
    character.level <= lobby.level_max,
    lobby.can_join,
    kolizeum_side_open(lobby, side),
  ].every(Boolean)
