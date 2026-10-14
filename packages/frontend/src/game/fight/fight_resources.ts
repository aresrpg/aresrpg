// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect } from 'react'

import { SPELL_EFFECT_CLASSES } from '@aresrpg/engine/data'
import type { HydratedFightCheckpoint } from '@aresrpg/fight'
import { spell_effect_atlases } from '../../content/spell_effect_assets.ts'
import { preload_fight_sounds } from '../audio/fight_audio.ts'
import { spell_audio } from '../audio/spell_effect_audio.ts'
import type { SceneHandle } from '../core/scene_feed.ts'

export const prepare_spell_resources = (classes: readonly string[], scene: SceneHandle, ambient = false): void => {
  if (!classes.some((classe) => SPELL_EFFECT_CLASSES.some((authored) => authored === classe))) return
  void Promise.all([
    scene.prepare_fight_effects(spell_effect_atlases()),
    ambient ? Promise.resolve() : spell_audio.prepare(),
  ]).catch((error) => console.error('Fight spell preparation failed.', error))
}

export const useFightResources = (
  checkpoint: Readonly<HydratedFightCheckpoint> | null,
  scene: SceneHandle,
  ambient: boolean,
  models: readonly unknown[]
): void => {
  const fight_id = checkpoint?.contract.id
  useEffect(() => {
    if (!checkpoint) return
    if (!ambient) preload_fight_sounds(checkpoint)
    prepare_spell_resources(
      Object.values(checkpoint.sources.players).map((player) => player.classe),
      scene,
      ambient
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Fight identity and loaded models prewarm resources; changing HP must not rebuild them.
  }, [fight_id, scene, ambient, models])
}
