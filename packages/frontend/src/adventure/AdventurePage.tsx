// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useRef, useState } from 'react'
import type { EngineStatus, Vec3 } from '@aresrpg/engine'

import { AdventureTouchControls } from '../../../mobile/src/AdventureTouchControls.tsx'
import { WorldLoading } from '../components/WorldLoading.tsx'
import { OnboardingFeedback } from '../analytics/OnboardingFeedback.tsx'
import { BiomeMusic } from '../game/audio/BiomeMusic.tsx'
import { LocaleScope } from '../i18n/LocaleScope.tsx'
import { WorldSocialDock } from '../game/hud/WorldSocialDock.tsx'
import { EngineNotice } from '../components/EngineNotice.tsx'
import { load_pet_companion } from '../content/pet_models.ts'
import { create_world } from '../game/core/world.ts'
import { read_pose } from '../game/core/pose_feed.ts'
import { FightLayer } from '../game/fight/FightLayer.tsx'
import { load_character_appearance } from '../game/character_entities.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, read_app_state, useAppStore } from '../store.ts'
import { report_error } from '../reporting.ts'
import environment from '../../../../seed/content/adventure_environment.json'

import { adventure_floor, adventure_movement_area, ADVENTURE_SPAWN } from './terrain.ts'
import { AdventureEnding } from './AdventureEnding.tsx'
import { AdventureHud, AdventurePartyFrame } from './AdventureHud.tsx'
import { ADVENTURE_NAMES, adventure_fight_position } from './content.ts'
import { adventure_model } from './models.ts'
import { create_adventure_actors } from './actors.ts'
import { selected_adventurer } from './quest.ts'
import { useDemoAnalytics } from './useDemoAnalytics.ts'
import { CompanionInteraction } from './CompanionInteraction.tsx'
import { load_adventure_scene } from './scene.ts'

export const AdventurePage = ({ copy: initial_copy }: Readonly<{ copy: AppCopy }>) => {
  const copy = useAppStore((state) => state.copy ?? initial_copy)
  const [scene, set_scene] = useState<Awaited<ReturnType<typeof load_adventure_scene>> | null>(null)
  const adventure = useAppStore((state) => state.adventure)
  const character = selected_adventurer(adventure)
  const route_unlocked = useAppStore((state) => state.adventure.encounter > 0)
  const encounter = useAppStore((state) => state.adventure.encounter)
  const phase = useAppStore((state) => state.adventure.phase)
  const finale = ['ending', 'complete', 'entered'].includes(phase)
  const page = useAppStore((state) => state.navigation.page)
  const dialog = useAppStore((state) => state.navigation.dialog)
  const mounted = useAppStore((state) => state.fight.mounted)
  const fight_position = useAppStore((state) => adventure_fight_position(state.fight.checkpoint?.contract.id ?? null))
  const positions = useRef(
    new Map<string, Vec3>([['adventure_senshi', [ADVENTURE_SPAWN.x, ADVENTURE_SPAWN.y, ADVENTURE_SPAWN.z]]])
  )
  const embodied = useRef<string | null>(null)
  const locale = useAppStore((state) => state.locale)
  const settings = useAppStore((state) => state.settings)
  const [canvas, set_canvas] = useState<HTMLCanvasElement | null>(null)
  const [world, set_world] = useState<ReturnType<typeof create_world> | null>(null)
  const [status, set_status] = useState<EngineStatus>({ state: 'initializing', backend: 'none' })
  const [model_failed, set_model_failed] = useState(false)
  const demo_loading = useDemoAnalytics(world, adventure.character)
  const display_status: EngineStatus = model_failed ? { state: 'failed', backend: status.backend } : status

  useEffect(() => dispatch_app({ type: 'adventure/entered' }), [])

  useEffect(() => {
    if (!canvas) return
    const request = new AbortController()
    let created: ReturnType<typeof create_world> | null = null
    let unsubscribe: (() => void) | undefined
    const release = () => {
      unsubscribe?.()
      unsubscribe = undefined
      created?.dispose()
      created = null
    }
    set_scene(null)
    set_world(null)
    set_model_failed(false)
    set_status({ state: 'initializing', backend: 'none' })
    void load_adventure_scene(request.signal)
      .then((loaded) => {
        if (request.signal.aborted) return
        const { quality } = read_app_state().settings
        created = create_world({
          canvas,
          world: loaded.world,
          quality,
          initial_focus: [ADVENTURE_SPAWN.x, ADVENTURE_SPAWN.z],
          initial_yaw: Math.PI,
          initial_pitch: environment.initial_pitch,
        })
        unsubscribe = created.subscribe_status(set_status)
        created.set_resource_nodes(loaded.resources, adventure_floor)
        created.set_time_of_day(environment.time_of_day)
        created.set_active(true)
        created.set_interactive(true)
        set_scene(loaded)
        set_world(created)
      })
      .catch((error: unknown) => {
        if (request.signal.aborted) return
        release()
        const failure: EngineStatus = { state: 'failed', backend: 'none', issue: { code: 'terrain_failed' } }
        set_status(failure)
        demo_loading.on_progress({ stage: 'failed', fraction: null }, failure)
        report_error(error, { area: 'adventure', action: 'scene' })
      })
    return () => {
      request.abort()
      release()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- canvas owns the lifetime; settings use the existing device doors.
  }, [canvas])

  useEffect(() => {
    world?.set_quality(settings.quality, settings.render_distance)
    world?.set_audio_volume(settings.master_volume ?? 1)
    world?.set_footsteps_enabled(settings.footsteps_enabled !== false)
  }, [settings.quality, settings.render_distance, settings.master_volume, settings.footsteps_enabled, world])

  useEffect(() => {
    world?.set_movement_area(adventure_movement_area(route_unlocked))
  }, [world, route_unlocked])

  useEffect(() => {
    if (!world || !character) return
    if (mounted || finale) {
      // eslint-disable-next-line functional/immutable-data -- scene identity is retained only for position restoration.
      embodied.current = null
      world.set_character(null)
      world.set_pet(null)
      return
    }
    let active = true
    void load_character_appearance(character).then(
      (appearance) => {
        if (!active) return
        world.set_character({ id: character.id, appearance })
        if (embodied.current !== character.id) {
          const position = positions.current.get(character.id)
          if (position) world.point_at({ x: position[0], y: position[1], z: position[2] })
          // eslint-disable-next-line functional/immutable-data -- selection restores once; appearance changes preserve movement.
          embodied.current = character.id
        }
      },
      (error: unknown) => {
        console.error('Demo character failed to load.', error)
        if (active) set_model_failed(true)
      }
    )
    return () => {
      active = false
    }
  }, [character, mounted, finale, world])

  useEffect(() => {
    if (!world || mounted) return
    world.set_interactive(phase === 'explore' && !adventure.journal_open && dialog === null && page === 'world')
    if (!character?.loadout.pet || finale) {
      world.set_pet(null)
      return
    }
    let active = true
    void load_pet_companion('adventure_pet', character.loadout.pet)
      .then((pet) => {
        if (active) world.set_pet(pet)
      })
      .catch((error: unknown) => console.error('Demo pet failed to load.', error))
    return () => {
      active = false
    }
  }, [character?.loadout.pet, adventure.journal_open, dialog, encounter, finale, mounted, page, phase, world])

  useEffect(() => {
    if (world && !mounted && !finale) return create_adventure_actors(world, positions.current)
  }, [world, mounted, finale])

  const challenge = (): void => {
    const pose = read_pose()
    if (!pose) return
    positions.current.set(pose.character_id, [pose.x, pose.y, pose.z])
    dispatch_app({ type: 'adventure/challenge' })
  }

  return (
    <LocaleScope locale={locale}>
      <main className="fixed inset-0 overflow-hidden bg-bg font-mono text-[#e8e4dc]">
        <BiomeMusic area="demo:mosswood" />
        {scene && !finale && (
          <WorldSocialDock copy={copy} terrain={scene.world}>
            <AdventurePartyFrame copy={copy} />
          </WorldSocialDock>
        )}
        <canvas className="absolute inset-0 size-full touch-none" ref={set_canvas} />
        <WorldLoading
          context="demo"
          source={world}
          quality={settings.quality}
          render_distance={settings.render_distance}
          failed={display_status.state === 'failed'}
          {...demo_loading}
        />
        {mounted && world && (
          <FightLayer
            world_anchor={fight_position}
            copy={copy}
            scene={world}
            model_for={adventure_model}
            names={ADVENTURE_NAMES}
            exit_label={null}
          />
        )}
        <CompanionInteraction world={world} canvas={canvas} copy={copy} />
        <AdventureTouchControls copy={copy} device={world} />
        <AdventureEnding world={world} positions={positions.current} />
        <AdventureHud copy={copy} challenge={challenge} />
        <OnboardingFeedback />
        {display_status.state === 'failed' && (
          <EngineNotice
            copy={copy}
            status={display_status}
            minimum_graphics={false}
            dismiss={() => undefined}
            reload={() => globalThis.location.reload()}
          />
        )}
      </main>
    </LocaleScope>
  )
}
