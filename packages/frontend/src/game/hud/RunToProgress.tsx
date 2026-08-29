// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { chain_to_client_coordinate } from '@aresrpg/immutable'
import { useRef } from 'react'

import { copy_text, type AppCopy } from '../../i18n/copy.ts'
import { run_to_progress_percent, type RunTo } from '../../modules/run_to.ts'
import { useAppStore } from '../../store.ts'
import { useWorldPose } from '../core/pose_feed.ts'

export const selected_position_run = (run: Readonly<RunTo> | null, selected: string | null) =>
  run?.status === 'running' && run.source === 'position' && run.controlled_character_id === selected ? run : null

export const RunToProgress = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const pose = useWorldPose()
  const selected = useAppStore((state) => state.session.selected_character_id)
  const run = selected_position_run(
    useAppStore((state) => state.run_to.run),
    selected
  )
  const baseline = useRef<Readonly<{ key: string; distance: number }> | null>(null)
  if (!pose || !run) return null
  const target_x = chain_to_client_coordinate(run.x)
  const target_z = chain_to_client_coordinate(run.z)
  const remaining = Math.hypot(target_x - pose.x, target_z - pose.z)
  const key = `${run.controlled_character_id}:${run.world}:${run.x}:${run.z}`
  if (baseline.current?.key !== key) {
    // eslint-disable-next-line functional/immutable-data -- the ref retains presentation-only progress for this target.
    baseline.current = Object.freeze({ key, distance: Math.max(remaining, 1) })
  }
  const percent = run_to_progress_percent(baseline.current.distance, remaining)
  const text = copy_text(copy.party_panel)
  return (
    <div className="pointer-events-none absolute top-[148px] left-1/2 z-[6] w-[min(360px,calc(100vw-32px))] -translate-x-1/2 rounded-[9px] border border-gold/25 bg-surface/85 px-3 py-2 font-mono shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur-sm">
      <div className="mb-1.5 flex items-center justify-between gap-3 text-[8px] tracking-[0.16em] uppercase">
        <span className="text-gold">{text('run_to_progress')}</span>
        <span className="text-[#8d929d] tabular-nums">{Math.ceil(remaining)}m</span>
      </div>
      <div className="h-1 overflow-hidden bg-white/8">
        <div className="h-full bg-gold transition-[width] duration-150" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
