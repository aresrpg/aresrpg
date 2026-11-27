// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ReactNode } from 'react'

export type StakingRewardLane = Readonly<{
  /** The asset paid: its ticker is a name and is never translated. */
  asset: string
  hue: 'gold' | 'sky'
  icon?: ReactNode
  /** What is accrued and can be claimed now, already formatted. */
  accrued: string
}>

/** One figure of a wallet row: an amount and what it counts, already formatted. */
/** `note` is a small secondary reading of the same figure, such as its value in dollars. */
export type StakingRowFigure = Readonly<{ value: string; label: string; hue?: 'gold' | 'sky' | 'green'; note?: string }>

/**
 * One wallet as a single line: its name, then its stake and daily rates, so two wallets compare at a
 * glance. The line is the selector of the desk below it. A wallet with nothing to show yet says why
 * in place of its figures; `control` sits outside the selector (a wallet picker, a connect button).
 */
export const StakingWalletRow = ({
  icon,
  name,
  selected,
  on_select,
  figures,
  status,
  control,
}: Readonly<{
  icon: ReactNode
  name: string
  selected: boolean
  on_select?: () => void
  figures: readonly StakingRowFigure[] | null
  status?: string | null
  control?: ReactNode
}>) => (
  <div className="aui-stake-row" data-selected={selected}>
    <button
      className="aui-stake-row-pick"
      type="button"
      aria-pressed={selected}
      disabled={!on_select}
      onClick={on_select}
    >
      <span className="aui-stake-row-name">
        {icon}
        {name}
      </span>
      {figures?.map((figure) => (
        <span className="aui-stake-row-figure" data-hue={figure.hue} key={figure.label}>
          <b>{figure.value}</b> <i>{figure.label}</i>
          {figure.note && <small>{figure.note}</small>}
        </span>
      ))}
      {!figures && status && <span className="aui-stake-row-status">{status}</span>}
    </button>
    {control}
  </div>
)

/**
 * One stake and what it has earned: the principal as the largest figure, then what has accrued per
 * reward asset beside the claim. Values arrive formatted; this component only paints them.
 */
export const StakingRewards = ({
  icon,
  stake_label,
  stake,
  unit,
  lanes,
  accrued_label,
  notice,
  action,
}: Readonly<{
  icon: ReactNode
  stake_label: string
  stake: string
  unit: string
  lanes: readonly StakingRewardLane[]
  accrued_label: string
  notice?: string | null
  action: ReactNode
}>) => (
  <div className="aui-staking-rewards">
    <div className="aui-stake">
      <span className="aui-stake-label">{stake_label}</span>
      <div className="aui-stake-line">
        {icon}
        <strong className="aui-stake-value">{stake}</strong>
        <small>{unit}</small>
      </div>
    </div>
    {notice && <p className="aui-stake-notice">{notice}</p>}
    <section className="aui-reward-claim" aria-label={accrued_label}>
      <div className="aui-reward-accrued">
        <h3>{accrued_label}</h3>
        <div className="aui-reward-lanes">
          {lanes.map((lane) => (
            <span className="aui-reward-lane" data-hue={lane.hue} key={lane.asset}>
              {lane.icon}
              <b>{lane.accrued}</b> <small>{lane.asset}</small>
            </span>
          ))}
        </div>
      </div>
      {action}
    </section>
  </div>
)
