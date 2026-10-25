// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { TournamentLink } from '@aresrpg/protocol'

/** The indexer owns this Fight-to-match relationship; absent links preserve ordinary fights. */
export const tournament_link = (
  row: Readonly<{ tournament?: unknown; tournament_index?: unknown }>
): Readonly<{ tournament?: TournamentLink }> =>
  typeof row.tournament === 'string' ? { tournament: { id: row.tournament, index: Number(row.tournament_index) } } : {}
