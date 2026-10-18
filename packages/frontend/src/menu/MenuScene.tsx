// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useRef, useState } from 'react'
import type { EngineFrame, EngineQuality } from '@aresrpg/engine'

import { WorldLoading } from '../components/WorldLoading.tsx'
import type { WorldLoadingSource } from '../game/core/loading_progress.ts'
import scene_url from '../../../../seed/scenes/main_menu.json?url'
import type scene_shape from '../../../../seed/scenes/main_menu.json'
import { read_app_state, useAppStore } from '../store.ts'
import { observe_frame_rate } from '../game/core/frame_rate.ts'
import { create_scene_preparation, scene_work_complete } from '../game/core/scene_preparation.ts'

import { menu_camera_at } from './camera.ts'
import { load_menu_actors, menu_entities, type MenuActor } from './residents.ts'

const load_scene = async (signal: Readonly<AbortSignal>): Promise<typeof scene_shape> => {
  const response = await fetch(scene_url, { signal })
  if (!response.ok) throw new Error(`Menu scenery request failed (${response.status}).`)
  return response.json() as Promise<typeof scene_shape>
}

/** One curated aerial view through the normal engine and bounded chunk lifecycle; never a second game world. */
export const MenuScene = () => {
  const [source, set_source] = useState<WorldLoadingSource | null>(null)
  const [failed, set_failed] = useState(false)
  const [canvas, set_canvas] = useState<HTMLCanvasElement | null>(null)
  const quality = useAppStore(({ settings }) => settings.quality)
  const runtime = useRef<((quality: EngineQuality) => void) | null>(null)
  useEffect(() => {
    runtime.current?.(quality)
  }, [quality])
  useEffect(() => {
    if (!canvas) return
    const request = new AbortController()
    canvas.dataset.ready = ''
    set_source(null)
    set_failed(false)
    let dispose: (() => void) | undefined
    let releases: readonly (() => void)[] = []
    const own = <T extends Readonly<{ dispose: () => void }>>(resource: T): T => {
      releases = [resource.dispose, ...releases]
      return resource
    }
    const release = () => {
      const pending = releases
      releases = []
      pending.forEach((close) => close())
    }
    void Promise.all([import('@aresrpg/engine'), import('../game/core/chunks.ts'), load_scene(request.signal)])
      .then(([engine_module, { create_chunk_manager }, scene_data]) => {
        if (request.signal.aborted) return
        const { quality } = read_app_state().settings
        const compiled = engine_module.compile_runtime_world_recipe(scene_data.world)
        const { recipe } = compiled
        const { position, target } = menu_camera_at(scene_data.camera, 0, true)
        const engine = own(
          engine_module.create_engine({
            canvas,
            world: compiled,
            quality,
            initial_focus: [target[0], target[2]],
            render_distance: 9,
          })
        )
        const preparation = own(create_scene_preparation(engine))
        const planner = own(engine_module.create_terrain_planner(recipe))
        own({ dispose: observe_frame_rate(engine) })
        const chunks = own(
          create_chunk_manager({
            engine,
            initial_quality: quality,
            initial_render_distance: 9,
            plan_layers: planner.plan,
            on_failure: (error) => engine.fail({ code: 'terrain_failed', detail: error.message }),
          })
        )
        set_source({
          state: () => ({
            engine: engine.status(),
            render: { ...engine.render_state(), settled: engine.render_state().settled && preparation.ready() },
            chunks: chunks.stats(),
            displayed_chunks: engine.chunk_count(),
          }),
        })
        // eslint-disable-next-line functional/immutable-data -- this effect owns the disposable runtime callback ref.
        runtime.current = (next) => {
          if (next !== engine.quality()) {
            preparation.reset()
            canvas.dataset.ready = ''
          }
          chunks.set_quality(next, 9)
        }
        chunks.set_focus(target[0], target[2])
        engine.set_camera(position, target, { fov: scene_data.camera.fov })
        engine.set_time_of_day(scene_data.time_of_day)
        engine.set_audio_volume(0)
        engine.set_resource_nodes(scene_data.resources)
        engine.set_character_anchor(scene_data.character.position as [number, number, number])
        let actors: readonly MenuActor[] = []
        let actors_loaded = false
        void load_menu_actors(scene_data.character, scene_data.residents)
          .then((loaded) => {
            if (!request.signal.aborted) {
              actors = loaded
              actors_loaded = true
            }
          })
          .catch((error: unknown) => {
            if (!request.signal.aborted) {
              console.error('Menu characters could not load.', error)
              engine.fail({ code: 'graphics_unavailable', detail: String(error) })
            }
          })
        const reduced_motion = globalThis.matchMedia('(prefers-reduced-motion: reduce)')
        let seconds = 0
        const frame = ({ delta_seconds }: EngineFrame) => {
          chunks.tick()
          engine.set_entities(menu_entities(actors, seconds, reduced_motion.matches))
          preparation.tick(() =>
            scene_work_complete(
              engine.render_state().settled,
              chunks.stats(),
              actors_loaded && actors.every(({ entity }) => engine.entity_height(entity.id) !== null)
            )
          )
          if (preparation.ready()) {
            canvas.dataset.ready = 'true'
            seconds += Math.min(0.05, delta_seconds)
          }
          const view = menu_camera_at(scene_data.camera, seconds, reduced_motion.matches)
          engine.set_camera(view.position, view.target, { fov: scene_data.camera.fov })
        }
        const sync_visibility = () => {
          if (document.hidden) engine.stop()
          else engine.start(frame)
        }
        dispose = () => {
          // eslint-disable-next-line functional/immutable-data -- cleanup releases the runtime callback ref owned by this effect.
          runtime.current = null
          document.removeEventListener('visibilitychange', sync_visibility)
        }
        document.addEventListener('visibilitychange', sync_visibility)
        sync_visibility()
      })
      .catch((error: unknown) => {
        if (request.signal.aborted) return
        request.abort()
        dispose?.()
        release()
        set_failed(true)
        console.error('Menu scene could not load.', error)
      })
    return () => {
      request.abort()
      dispose?.()
      release()
    }
  }, [canvas])
  return (
    <>
      <div className="main-menu-scene" aria-hidden="true">
        <canvas ref={set_canvas} />
      </div>
      <WorldLoading context="home" source={source} quality={quality} render_distance={9} failed={failed} />
    </>
  )
}
