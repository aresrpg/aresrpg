// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useState } from 'react'

import type { ReadyAllProgress } from '../../modules/fight.ts'

const BUTTON = 'mt-1 rounded-[6px] px-4 py-1.5 text-[10px] tracking-[0.14em]'

const usePlacementSeconds = (deadline: bigint | null): number | null => {
  const [now, set_now] = useState(() => Date.now())
  useEffect(() => {
    if (deadline === null) return undefined
    const timer = setInterval(() => set_now(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [deadline])
  return deadline === null ? null : Math.max(0, Math.ceil((Number(deadline) - now) / 1_000))
}

const placement_prompt = (text: Readonly<Record<string, string>>, sides_manned: boolean, stalled: boolean): string =>
  !sides_manned ? text.placement_no_opponent : stalled ? text.placement_force_prompt : text.placement_hint

export const ready_all_progress_label = (
  text: Readonly<Record<string, string>>,
  progress: ReadyAllProgress
): string => {
  const source =
    progress.status === 'failed'
      ? text.placement_ready_all_failed
      : progress.status === 'complete'
        ? text.placement_ready_all_complete
        : text.placement_ready_all_progress
  return source.replace('{completed}', String(progress.completed)).replace('{total}', String(progress.total))
}

const PlacementReadyActions = ({
  text,
  ready,
  ready_all,
  ready_all_disabled,
  ready_all_progress,
  starting,
  locked,
  on_ready,
  on_ready_all,
}: Readonly<{
  text: Readonly<Record<string, string>>
  ready: boolean
  ready_all: boolean
  ready_all_disabled: boolean
  ready_all_progress: ReadyAllProgress | null
  starting: boolean
  locked: boolean
  on_ready: () => void
  on_ready_all: () => void
}>) => (
  <div className="fight-hud__placement-ready">
    <div className="fight-hud__placement-actions">
      <button className={`btn-gold ${BUTTON}`} disabled={ready || locked} onClick={on_ready} type="button">
        {ready ? (starting ? text.placement_starting : text.placement_waiting) : text.placement_ready}
      </button>
      {ready_all && (
        <button
          className={`btn-outline ${BUTTON}`}
          disabled={ready_all_disabled || locked}
          onClick={on_ready_all}
          type="button"
        >
          {ready_all_progress ? ready_all_progress_label(text, ready_all_progress) : text.placement_ready_all}
        </button>
      )}
    </div>
    {ready_all_progress && (
      <div
        aria-label={ready_all_progress_label(text, ready_all_progress)}
        className={`fight-hud__ready-progress ${ready_all_progress.status}`}
        role="progressbar"
        aria-valuemax={ready_all_progress.total}
        aria-valuemin={0}
        aria-valuenow={ready_all_progress.completed}
      >
        <span style={{ width: `${(ready_all_progress.completed / ready_all_progress.total) * 100}%` }} />
      </div>
    )}
  </div>
)

export const FightPlacementBanner = ({
  deadline,
  text,
  ready,
  ready_all,
  ready_all_disabled,
  ready_all_progress,
  starting,
  locked,
  sides_manned,
  can_forfeit,
  on_ready,
  on_ready_all,
  on_force_start,
  on_forfeit,
}: Readonly<{
  deadline: bigint | null
  text: Readonly<Record<string, string>>
  ready: boolean | null
  ready_all: boolean
  ready_all_disabled: boolean
  ready_all_progress: ReadyAllProgress | null
  starting: boolean
  locked: boolean
  sides_manned: boolean
  can_forfeit: boolean
  on_ready: () => void
  on_ready_all: () => void
  on_force_start: () => void
  on_forfeit: () => void
}>) => {
  const seconds = usePlacementSeconds(deadline)
  const stalled = sides_manned && ready !== null && seconds === 0
  return (
    <div className="fight-hud__placement" role="status">
      <span>{text.placement_title}</span>
      {seconds !== null && sides_manned && (
        <strong className={seconds <= 10 ? 'urgent' : ''}>0:{String(seconds).padStart(2, '0')}</strong>
      )}
      <small>{placement_prompt(text, sides_manned, stalled)}</small>
      {sides_manned && ready !== null && !stalled && (
        <PlacementReadyActions
          locked={locked}
          on_ready={on_ready}
          on_ready_all={on_ready_all}
          ready={ready}
          ready_all={ready_all}
          ready_all_disabled={ready_all_disabled}
          ready_all_progress={ready_all_progress}
          starting={starting}
          text={text}
        />
      )}
      {stalled && (
        <button className={`btn-gold ${BUTTON}`} disabled={locked} onClick={on_force_start} type="button">
          {text.placement_force_button}
        </button>
      )}
      {can_forfeit && (
        <button className={`btn-outline ${BUTTON}`} disabled={locked} onClick={on_forfeit} type="button">
          {text.forfeit}
        </button>
      )}
    </div>
  )
}
