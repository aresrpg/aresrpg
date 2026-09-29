// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Text } from '../../i18n/Text.tsx'

import { useRef } from 'react'
import { Clock3 } from 'lucide-react'

import { copy_text, type AppCopy } from '../../i18n/copy.ts'
import { run_to_distance, run_to_progress_percent, type RunTo } from '../../modules/run_to.ts'
import { useAppStore } from '../../store.ts'
import { useWorldPose } from '../core/pose_feed.ts'
import { run_to_remaining_seconds } from '../core/run_to.ts'

export const selected_position_run = (run: Readonly<RunTo> | null, selected: string | null) =>
  run?.status === 'running' &&
  (run.source === 'position' || run.source === 'fight') &&
  run.controlled_character_id === selected
    ? run
    : null

const route_eta = (remaining: number | null, riding: boolean): string => {
  if (remaining === null) return '—'
  const seconds = run_to_remaining_seconds(remaining, riding)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export const RunToProgress = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const pose = useWorldPose()
  const selected = useAppStore((state) => state.session.selected_character_id)
  const run = selected_position_run(
    useAppStore((state) => state.run_to.run),
    selected
  )
  const baseline = useRef<Readonly<{ key: string; distance: number }> | null>(null)
  if (!pose || !run) return null
  const remaining = run_to_distance(run, pose)
  const eta = route_eta(remaining, pose.riding)
  const key = `${run.controlled_character_id}:${run.world}:${run.x}:${run.z}`
  if (remaining !== null && baseline.current?.key !== key) {
    // eslint-disable-next-line functional/immutable-data -- the ref retains presentation-only progress for this target.
    baseline.current = Object.freeze({ key, distance: Math.max(remaining, 1) })
  }
  const percent =
    remaining === null || !baseline.current ? 0 : run_to_progress_percent(baseline.current.distance, remaining)
  const text = copy_text(copy.party_panel)
  return (
    <div className="world-run-progress pointer-events-none absolute top-[148px] left-1/2 z-[6] w-[min(360px,calc(100vw-32px))] -translate-x-1/2 rounded-[9px] border border-gold/25 bg-surface/85 px-3 py-2 font-mono shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur-sm">
      <div className="mb-1.5 flex items-center justify-between gap-3 text-[8px] tracking-[0.16em] uppercase">
        <span className="text-gold">{text('run_to_progress')}</span>
        <span className="flex shrink-0 items-center gap-2 text-[#8d929d] tabular-nums">
          {remaining !== null && <Text path="ui.meters" values={{ count: Math.ceil(remaining) }} />}
          <span className="flex items-center gap-1">
            <Clock3 size={10} aria-hidden="true" />≈{eta}
          </span>
        </span>
      </div>
      <div className="h-1 overflow-hidden bg-white/8">
        <div className="h-full bg-gold transition-[width] duration-150" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
