// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useRef } from 'react'
import type { WorldCaption } from '@aresrpg/engine'
import type { SpellTargetPreview } from '@aresrpg/fight'

import { useText } from '../../i18n/useText.ts'
import type { SceneHandle } from '../core/scene_feed.ts'

export type FightTargetPreviewView = SpellTargetPreview &
  Readonly<{ allied: boolean; entity_id: string; level: bigint; name: string }>

/** Presentation receives resolved HP only; targeting math remains in the fight twin. */
export const fight_target_caption = (
  target: FightTargetPreviewView,
  level: string,
  critical: boolean
): WorldCaption => {
  const difference = target.hp_after - target.hp_before
  const change = difference === 0n ? '' : ` ${difference > 0n ? '+' : '−'}${difference < 0n ? -difference : difference}`
  return {
    name: target.name,
    color: target.allied ? '#a9d6ee' : '#f5d0a9',
    suffix: [
      { text: ` ${level} (${target.hp_before}`, color: '#a3a5ad' },
      { text: change, color: critical ? '#ffd074' : difference < 0n ? '#ff7865' : '#69d8a0' },
      { text: ')', color: '#a3a5ad' },
    ],
  }
}
export const FightTargetPreviews = ({
  scene,
  critical,
  targets,
}: Readonly<{
  scene: SceneHandle
  critical: boolean
  targets: readonly FightTargetPreviewView[]
}>) => {
  const text = useText()
  const shown = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const current = new Set(targets.map(({ entity_id }) => entity_id))
    shown.current.forEach((id) => {
      if (!current.has(id)) scene.set_entity_caption(id, null)
    })
    targets.forEach((target) =>
      scene.set_entity_caption(
        target.entity_id,
        fight_target_caption(
          target,
          text('encyclopedia_page.level_short', { level: target.level.toString() }),
          critical
        )
      )
    )
    // eslint-disable-next-line functional/immutable-data -- React effect cleanup owns this presentation-only registry.
    shown.current = current
  }, [scene, targets, critical, text])
  useEffect(
    () => () => {
      shown.current.forEach((id) => scene.set_entity_caption(id, null))
      // eslint-disable-next-line functional/immutable-data -- Retire the previous scene before its replacement paints.
      shown.current = new Set()
    },
    [scene]
  )
  return null
}
