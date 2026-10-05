// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CSSProperties, ReactNode } from 'react'

import { Button, IconButton } from './controls.tsx'
import { Panel } from './surfaces.tsx'

export type StatView = Readonly<{
  id: string
  label: string
  value: ReactNode
  on_select?: () => void
  icon?: ReactNode
}>
export const ProgressBar = ({
  label,
  value,
  max,
  detail,
}: Readonly<{ label: string; value: number; max: number; detail?: ReactNode }>) => (
  <label className="aui-progress">
    <span>
      {label}
      <strong>{detail}</strong>
    </span>
    <progress aria-label={label} value={Math.max(0, value)} max={Math.max(1, max)} />
  </label>
)

export type ItemView = Readonly<{ id: string; label: string; image?: string; quantity?: number; disabled?: boolean }>
const MobStatList = ({ stats }: Readonly<{ stats: readonly StatView[] }>) => (
  <div className="aui-mob-stats">
    {stats.map((stat) => (
      <button type="button" key={stat.id} aria-label={`${stat.label}: ${stat.value}`} onClick={stat.on_select}>
        <span>{stat.icon}</span>
        <strong>{stat.value}</strong>
      </button>
    ))}
  </div>
)

export const MobDetails = ({
  title,
  subtitle,
  portrait,
  vitals,
  resistances,
  children,
  actions,
}: Readonly<{
  title: string
  subtitle?: string
  portrait: ReactNode
  vitals: readonly StatView[]
  resistances: readonly StatView[]
  children?: ReactNode
  actions?: ReactNode
}>) => (
  <Panel className="aui-mob">
    <header>
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </header>
    <div className="aui-mob-content">
      <div className="aui-mob-overview">
        <MobStatList stats={vitals} />
        <div className="aui-mob-hero">{portrait}</div>
        <MobStatList stats={resistances} />
      </div>
      {children}
    </div>
    <footer>{actions}</footer>
  </Panel>
)

export const ProgressionCard = ({
  title,
  subtitle,
  rewards_label,
  icon,
  progress,
  rewards,
  action,
  close,
  close_label,
  kind = 'character',
}: Readonly<{
  title: string
  subtitle: string
  rewards_label: string
  icon: ReactNode
  progress: ReactNode
  rewards: ReactNode
  action?: ReactNode
  close: () => void
  close_label: string
  kind?: 'character' | 'profession'
}>) => (
  <Panel className="aui-progression" data-progression-kind={kind}>
    <div className="aui-progression-aura" aria-hidden="true" />
    <header>
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </header>
    <IconButton
      className="aui-progression-close"
      label={close_label}
      onClick={close}
      icon={<span aria-hidden="true">×</span>}
    />
    <div className="aui-progression-hero">
      <div className="aui-progression-badge">{icon}</div>
      <div className="aui-progression-level">{progress}</div>
    </div>
    <section className="aui-progression-rewards">
      <h3>{rewards_label}</h3>
      <div className="aui-rewards">{rewards}</div>
    </section>
    <footer className="aui-progression-footer">{action}</footer>
  </Panel>
)

/** The application supplies its authoritative clock and action availability. */
export const CombatHud = ({
  vitals,
  spells,
  controls,
  timer,
  label,
  spell_count = 20,
}: Readonly<{
  vitals: ReactNode
  spells: ReactNode
  controls: ReactNode
  label: string
  spell_count?: number
  timer?: Readonly<{ label: string; remaining: number; duration: number; hint?: string }> | null
}>) => (
  <Panel
    className="aui-combat-hud"
    aria-label={label}
    style={{ '--combat-columns': Math.ceil(Math.max(20, spell_count) / 2) } as CSSProperties}
  >
    <div className="aui-combat-vitals">{vitals}</div>
    <div className="aui-combat-spells">{spells}</div>
    <div className="aui-combat-controls">
      {timer && (
        <div title={timer.hint} aria-label={timer.hint} tabIndex={timer.hint ? 0 : undefined}>
          <ProgressBar
            label={timer.label}
            value={timer.remaining}
            max={timer.duration}
            detail={Math.max(0, Math.ceil(timer.remaining))}
          />
        </div>
      )}
      {controls}
    </div>
  </Panel>
)
