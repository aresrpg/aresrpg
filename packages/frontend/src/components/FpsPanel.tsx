// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { QUALITY_OPTIONS, type EngineQuality } from '@aresrpg/engine'
import { Button, Panel } from '@aresrpg/ui'
import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'

import { useAppStore } from '../store.ts'
import { Text } from '../i18n/Text.tsx'
import type { AppCopy } from '../i18n/copy.ts'

import { connection_label, indexing_health_tone } from './connection_status.ts'
import { FullscreenButton } from './FullscreenButton.tsx'

export const FpsPanel = ({
  active,
  quality,
  fight_access,
  party_available,
  copy,
  change_quality,
  toggle_fight_access,
}: Readonly<{
  active: boolean
  quality: EngineQuality
  fight_access: 0 | 1 | null
  party_available: boolean
  copy: AppCopy
  change_quality: (quality: EngineQuality) => void
  toggle_fight_access?: () => void
}>) => {
  const session = useAppStore((state) => state.session)
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
    <Panel className="aui-performance" data-tutorial-target="fps">
      <div className="aui-performance-reading">
        <span>
          <Text path="ui.fps" />
        </span>
        <output>{fps ?? '—'}</output>
      </div>
      <span
        className="world-connection"
        title={`${connection_label(copy, session)} · ${session.latency_ms ?? '—'} ${copy.latency_unit}`}
        data-indexing-health={indexing_health_tone(session.indexing_lag)}
      >
        <i data-connected={session.link_status === 'ready'} />
        <Users size={13} aria-label={copy.online_players} />
        <b>{session.online ?? '—'}</b>
      </span>
      <FullscreenButton copy={copy} />
      <select
        aria-label={copy.quality}
        value={quality}
        onChange={(event) => change_quality(event.target.value as EngineQuality)}
      >
        {QUALITY_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {copy[option]}
          </option>
        ))}
      </select>
      {fight_access !== null && (
        <Button
          aria-label={copy.world_hud.dungeon_group}
          role="switch"
          aria-checked={fight_access === 1}
          data-fight-access=""
          disabled={!party_available}
          onClick={toggle_fight_access}
        >
          <span className="world-group-toggle" aria-hidden="true" />
          {copy.world_hud.dungeon_group}
        </Button>
      )}
    </Panel>
  )
}
