// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { SPELL_EFFECT_CLASSES } from '@aresrpg/engine/data'
import type { CharacterEntityRender } from '@aresrpg/engine'
import type { HydratedFightCheckpoint } from '@aresrpg/fight'
import { worn_appearance } from '@aresrpg/immutable'
import { spell_effect_atlases } from '../../content/spell_effect_assets.ts'
import { preload_fight_sounds } from '../audio/fight_audio.ts'
import { spell_audio } from '../audio/spell_effect_audio.ts'
import type { SceneHandle } from '../core/scene_feed.ts'
import { load_fight_character_entities, type FightCharacterRenderSource } from './character_entities.ts'

export const prepare_spell_resources = async (
  classes: readonly string[],
  scene: Pick<SceneHandle, 'prepare_fight_effects'>,
  ambient = false
): Promise<void> => {
  if (!classes.some((classe) => SPELL_EFFECT_CLASSES.some((authored) => authored === classe))) return
  await Promise.all([
    scene.prepare_fight_effects(spell_effect_atlases()),
    ambient ? Promise.resolve() : spell_audio.prepare(),
  ])
}

const preparation_request = () => {
  let complete: (error: Readonly<Error> | null) => void = () => {}
  const task = new Promise<Error | null>((resolve) => {
    complete = resolve
  })
  return { task, complete }
}

/** Appearance changes can replace a pending request; a cue must await the current owner. */
export const wait_for_fight_resources = async (read: () => Promise<Error | null> | null): Promise<void> => {
  let requested = read()
  while (requested) {
    const error = await requested
    if (requested === read()) {
      if (error) throw error
      return
    }
    requested = read()
  }
}

const NO_CHARACTERS: readonly CharacterEntityRender[] = Object.freeze([])

export const useFightResources = (
  checkpoint: Readonly<HydratedFightCheckpoint> | null,
  scene: SceneHandle,
  ambient: boolean,
  sources: readonly FightCharacterRenderSource[]
) => {
  const fight_id = checkpoint?.contract.id
  const appearance_key = JSON.stringify(
    sources.map(({ id, classe, male, colors, loadout }) => [id, classe, male, colors, worn_appearance(loadout)])
  )
  // eslint-disable-next-line react-hooks/exhaustive-deps -- these identities own one preparation lifetime.
  const identity = useMemo(() => ({}), [fight_id, scene, ambient, appearance_key])
  const latest = useRef<ReturnType<typeof preparation_request> | null>(null)
  const [models, set_models] = useState<Readonly<{
    identity: object
    result: readonly CharacterEntityRender[] | Error
  }> | null>(null)
  const [prepared, set_prepared] = useState<Readonly<{ identity: object; error: Error | null }> | null>(null)
  const wait = useCallback(() => wait_for_fight_resources(() => latest.current?.task ?? null), [])

  useEffect(() => {
    let current = true
    const request = preparation_request()
    // eslint-disable-next-line functional/immutable-data -- effect setup owns a fresh gate, including StrictMode's cleanup/setup replay.
    latest.current = request
    void load_fight_character_entities(sources).then(
      (result) => {
        if (current) set_models({ identity, result })
      },
      (error: unknown) => {
        if (current) set_models({ identity, result: error instanceof Error ? error : new Error(String(error)) })
      }
    )
    return () => {
      current = false
      // eslint-disable-next-line functional/immutable-data -- retire this effect's gate before releasing cancelled cue waiters.
      latest.current = null
      request.complete(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identity includes appearance values; packet arrivals and cell changes cannot reload actors.
  }, [identity])

  useEffect(() => {
    const request = latest.current
    if (!checkpoint || models?.identity !== identity || !request) return
    let current = true
    const finish = (error: Readonly<Error> | null): void => {
      if (!current) return
      if (error) console.error('Fight preparation failed.', error)
      set_prepared({ identity, error })
      request.complete(error)
    }
    if (models.result instanceof Error) {
      finish(models.result)
      return
    }
    if (!ambient) preload_fight_sounds(checkpoint)
    void prepare_spell_resources(
      Object.values(checkpoint.sources.players).map((player) => player.classe),
      scene,
      ambient
    ).then(
      () => finish(null),
      (error: unknown) => finish(error instanceof Error ? error : new Error(String(error)))
    )
    return () => {
      current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the request pins fight/scene identity; HP changes do not restart preparation.
  }, [identity, models])

  return {
    characters: models?.identity === identity && !(models.result instanceof Error) ? models.result : NO_CHARACTERS,
    status: prepared?.identity !== identity ? 'loading' : prepared.error ? 'failed' : 'ready',
    wait,
  } as const
}
