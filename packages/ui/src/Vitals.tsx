import type { CSSProperties, ReactNode } from 'react'

import { stat_art } from './art.ts'

export const vital_art = { health: stat_art.health, action: stat_art.action, movement: stat_art.movement } as const

/** Values and fill arrive from the game projection; this component only paints them. */
export const Vitals = ({
  health,
  fill,
  health_label,
  on_health,
  ap,
  mp,
  ap_label,
  mp_label,
}: Readonly<{
  health: ReactNode
  fill: number
  health_label: string
  on_health: () => void
  ap: string
  mp: string
  ap_label: string
  mp_label: string
}>) => (
  <div className="aui-vitals">
    <button type="button" className="aui-health" aria-label={health_label} title={health_label} onClick={on_health}>
      <img className="aui-health-empty" src={vital_art.health} alt="" />
      <img
        className="aui-health-fill"
        src={vital_art.health}
        alt=""
        style={{ '--hp-percent': `${fill}%` } as CSSProperties}
      />
      <span>{health}</span>
    </button>
    <div className="aui-vital-tokens">
      <div className="aui-vital-token" aria-label={ap_label}>
        <img src={vital_art.action} alt="" />
        <strong>{ap}</strong>
      </div>
      <div className="aui-vital-token" aria-label={mp_label}>
        <img src={vital_art.movement} alt="" />
        <strong>{mp}</strong>
      </div>
    </div>
  </div>
)
