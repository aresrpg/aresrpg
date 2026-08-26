// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { HydratedFightCheckpoint } from '@aresrpg/fight'

export const holds_character_seat = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  character_id: string | null,
  owner: string | null
): boolean =>
  !!character_id &&
  !!owner &&
  checkpoint.contract.fighters.some(
    (fighter) =>
      fighter.kind.type === 'player' &&
      fighter.kind.character === character_id &&
      fighter.kind.owner === owner &&
      !fighter.settled
  )
