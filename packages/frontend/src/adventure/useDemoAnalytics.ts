// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useCallback, useEffect, useState } from 'react'
import type { EngineStatus } from '@aresrpg/engine'
import type { HydratedFightCheckpoint } from '@aresrpg/fight'

import { useAppStore } from '../store.ts'
import { fight_character_entity_sources } from '../game/fight/character_entity_sources.ts'
import { capture_analytics } from '../analytics.ts'
import { create_demo_loading_observer } from '../analytics/demo_loading.ts'
import { pose_matches_character, read_pose, subscribe_pose } from '../game/core/pose_feed.ts'
import type { LoadingProgress } from '../game/core/loading_progress.ts'
import type { create_world } from '../game/core/world.ts'

const position = (id: string | undefined): readonly [number, number] | null => {
  const pose = read_pose()
  return pose_matches_character(pose, id ?? null) ? [pose.x, pose.z] : null
}

export const adventure_assets_ready = (
  world: Pick<ReturnType<typeof create_world>, 'entity_height'> | null,
  character_id: string | undefined,
  checkpoint: Readonly<HydratedFightCheckpoint> | null
): boolean => {
  if (!world || !character_id) return false
  const ids = checkpoint ? fight_character_entity_sources(checkpoint, [], 0n).map(({ id }) => id) : [character_id]
  return ids.some((id) => world.entity_height(id) !== null)
}

export const useDemoAnalytics = (
  world: ReturnType<typeof create_world> | null,
  character: Readonly<{ id: string }> | null
) => {
  const character_id = character?.id
  const checkpoint = useAppStore((state) => (state.fight.mounted ? state.fight.checkpoint : null))
  const [{ observe, playable }] = useState(() => create_demo_loading_observer(capture_analytics))
  const assets_ready = useCallback(
    () => playable() || adventure_assets_ready(world, character_id, checkpoint),
    [world, character_id, checkpoint, playable]
  )
  const on_progress = useCallback(
    ({ stage }: LoadingProgress, engine: EngineStatus) => {
      observe({
        stage,
        elapsed_ms: performance.now(),
        position: position(character_id),
        failure_stage: engine.issue?.code ?? (engine.state === 'failed' ? 'graphics' : 'character'),
      })
    },
    [observe, character_id]
  )
  useEffect(() => {
    if (!world || !character_id) return
    const unsubscribe = subscribe_pose(() => {
      if (observe({ stage: 'movement', elapsed_ms: performance.now(), position: position(character_id) })) unsubscribe()
    })
    return unsubscribe
  }, [world, character_id, observe])
  return { assets_ready, on_progress }
}
