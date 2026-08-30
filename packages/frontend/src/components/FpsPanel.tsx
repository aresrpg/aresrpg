// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { QUALITY_OPTIONS, type EngineQuality } from '@aresrpg/engine'
import { useEffect, useState } from 'react'

import type { AppCopy } from '../i18n/copy.ts'

import { HudPanel } from './ui/HudPanel.tsx'

export const FpsPanel = ({
  active,
  quality,
  flattened,
  flatten_locked,
  fight_access,
  party_available,
  copy,
  change_quality,
  toggle_flattened,
  toggle_fight_access,
}: Readonly<{
  active: boolean
  quality: EngineQuality
  flattened: boolean
  flatten_locked: boolean
  fight_access: 0 | 1 | null
  party_available: boolean
  copy: AppCopy
  change_quality: (quality: EngineQuality) => void
  toggle_flattened: () => void
  toggle_fight_access: () => void
}>) => {
  const [fps, set_fps] = useState<number | null>(null)

  useEffect(() => {
    if (!active) {
      set_fps(null)
      return
    }
    let animation_frame = 0
    let frame_count = 0
    let sampled_at = performance.now()
    const sample = (now: number): void => {
      frame_count += 1
      const elapsed = now - sampled_at
      if (elapsed >= 500) {
        set_fps(Math.round((frame_count * 1000) / elapsed))
        frame_count = 0
        sampled_at = now
      }
      animation_frame = requestAnimationFrame(sample)
    }
    animation_frame = requestAnimationFrame(sample)
    return () => cancelAnimationFrame(animation_frame)
  }, [active])

  return (
    <HudPanel
      className="pointer-events-auto flex w-fit items-stretch overflow-hidden !rounded-[9px] text-[8px] tracking-[0.14em] uppercase"
      data-tutorial-target="fps"
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <span className="text-[#8d9099]">FPS</span>
        <output className="w-6 text-right text-[#67adff] tabular-nums">{fps ?? '—'}</output>
      </div>
      <select
        aria-label={copy.quality}
        className="cursor-pointer border-l border-white/10 bg-transparent px-2 text-[#67adff] outline-none"
        value={quality}
        onChange={(event) => change_quality(event.target.value as EngineQuality)}
      >
        {QUALITY_OPTIONS.map((option) => (
          <option className="bg-bg" key={option} value={option}>
            {copy[option]}
          </option>
        ))}
      </select>
      <button
        aria-label={copy.flat_mode}
        aria-pressed={flattened}
        className="flex cursor-pointer items-center gap-2 border-l border-white/10 px-2 text-[#c8963c] disabled:cursor-not-allowed disabled:opacity-60"
        data-flat-locked={flatten_locked}
        disabled={flatten_locked}
        onClick={toggle_flattened}
        type="button"
      >
        FLAT
        <span
          aria-hidden="true"
          className={`relative h-3 w-6 rounded-full border transition-colors duration-200 ${
            flattened ? 'border-[#4a9eff]/70 bg-[#4a9eff]/25' : 'border-white/15 bg-white/5'
          }`}
        >
          <span
            className={`absolute top-0.5 size-1.5 rounded-full transition-all duration-200 ${
              flattened ? 'left-3.5 bg-[#67adff] shadow-[0_0_7px_#4a9eff]' : 'left-0.5 bg-white/35'
            }`}
          />
        </span>
      </button>
      {fight_access !== null && (
        <button
          aria-label={copy.world_hud[fight_access === 1 ? 'dungeon_group' : 'dungeon_public']}
          aria-pressed={fight_access === 1}
          className="flex cursor-pointer items-center gap-2 border-l border-white/10 px-2 text-[#c8963c] disabled:cursor-not-allowed disabled:opacity-35"
          data-fight-access=""
          disabled={!party_available}
          onClick={toggle_fight_access}
          type="button"
        >
          {copy.world_hud[fight_access === 1 ? 'dungeon_group' : 'dungeon_public']}
          <span
            aria-hidden="true"
            className={`relative h-3 w-6 rounded-full border transition-colors duration-200 ${
              fight_access === 1 ? 'border-[#c8963c]/70 bg-[#c8963c]/25' : 'border-white/15 bg-white/5'
            }`}
          >
            <span
              className={`absolute top-0.5 size-1.5 rounded-full transition-all duration-200 ${
                fight_access === 1 ? 'left-3.5 bg-[#efbd45] shadow-[0_0_7px_#c8963c]' : 'left-0.5 bg-white/35'
              }`}
            />
          </span>
        </button>
      )}
    </HudPanel>
  )
}
