// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The grimoire's spell row, reused unchanged by the simulator's trailing level control.

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

export const SpellRow = ({
  color,
  icon,
  name,
  subline,
  right,
}: Readonly<{ color: string; icon: string | null; name: string; subline: string; right: ReactNode }>) => {
  const [failed, set_failed] = useState(false)

  useEffect(() => set_failed(false), [icon])

  return (
    <div className="sb__row sb__row--dense" style={{ '--el': color } as CSSProperties}>
      {!icon || failed ? (
        <span aria-hidden="true" className="sb__ic sb__art--fallback">
          {name.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <img
          alt=""
          className="sb__ic"
          crossOrigin="anonymous"
          draggable={false}
          onError={() => set_failed(true)}
          src={icon}
        />
      )}
      <span className="sb__meta">
        <span className="sb__nm">{name}</span>
        <span className="sb__rl">{subline}</span>
      </span>
      <span className="sb__right">{right}</span>
    </div>
  )
}
