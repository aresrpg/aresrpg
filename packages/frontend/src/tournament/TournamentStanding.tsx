// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { TournamentRow } from '@aresrpg/protocol'

import type { CopyText } from '../i18n/copy.ts'

import { own_team, tournament_name } from './presentation.ts'
import './podium.css'

export const TournamentStanding = ({
  row,
  address,
  t,
}: Readonly<{ row: TournamentRow; address: string | null; t: CopyText }>) => {
  const place = row.teams[own_team(row, address)]?.place ?? 0
  if (row.status !== 'finished' || place === 0) return null
  return (
    <div className="tourney-standing">
      <p>{tournament_name(row.name)}</p>
      <h2>{t(place === 1 ? 'victory_title' : 'placing_title', { place })}</h2>
    </div>
  )
}
