// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState, type CSSProperties } from 'react'

export const vital_percent = (value: bigint, maximum: bigint): number =>
  maximum <= 0n ? 0 : Math.max(0, Math.min(100, Number((value * 10_000n) / maximum) / 100))

const StatGem = ({ kind, value }: Readonly<{ kind: 'ap' | 'mp'; value: bigint }>) => (
  <div aria-label={`${kind.toUpperCase()} ${value}`} className={`fight-hud__gem fight-hud__gem--${kind}`}>
    <i />
    <span>{value.toString()}</span>
  </div>
)

export const VitalsDisplay = ({
  hp,
  max_hp,
  ap,
  mp,
}: Readonly<{ hp: bigint; max_hp: bigint; ap: bigint; mp: bigint }>) => {
  const [percent_visible, set_percent_visible] = useState(false)
  return (
    <div className="fight-hud__vitals">
      <button
        className="fight-hud__hp-gem"
        onClick={() => set_percent_visible((visible) => !visible)}
        title={`${hp} / ${max_hp} HP`}
        type="button"
      >
        <i aria-hidden="true" style={{ '--hp-percent': `${vital_percent(hp, max_hp)}%` } as CSSProperties} />
        {percent_visible ? (
          <span>{Math.round(vital_percent(hp, max_hp))}%</span>
        ) : (
          <span>
            {hp.toString()}
            <b />
            {max_hp.toString()}
          </span>
        )}
      </button>
      <div className="fight-hud__stat-gems">
        <StatGem kind="ap" value={ap} />
        <StatGem kind="mp" value={mp} />
      </div>
    </div>
  )
}
