// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The established characteristic identity row, retained for every character build surface.

import type { CSSProperties } from 'react'

import { stat_identities } from '../visual_identity.ts'

export const StatIdentity = ({ stat, label }: Readonly<{ stat: string; label: string }>) => {
  const identity = stat_identities[stat]
  return (
    <>
      <span
        className="stats__prow-icon"
        data-stat-icon={stat}
        style={{ '--tint': identity?.tint ?? '#6b7280' } as CSSProperties}
        title={label}
      >
        {identity && <img alt="" src={identity.icon} />}
      </span>
      <span className="stats__prow-labels">
        <span className="stats__prow-label">{label}</span>
      </span>
    </>
  )
}
