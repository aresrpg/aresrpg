// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useState } from 'react'
import type { Vec3 } from '@aresrpg/engine'

import scene_url from '../../../../seed/scenes/asset_workshop.json?url'
import { WorldLoading } from '../components/WorldLoading.tsx'
import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

import { mount_asset_scene, type AssetSceneData } from './asset_scene.ts'

type WorkshopScene = AssetSceneData &
  Readonly<{
    labels: readonly Readonly<{
      id: string
      position: Vec3
      area: readonly [number, number, number, number]
      featured: boolean
    }>[]
  }>

export const AssetWorkshop = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [canvas, set_canvas] = useState<HTMLCanvasElement | null>(null)
  const [scene, set_scene] = useState<ReturnType<typeof mount_asset_scene> | null>(null)
  const [labels, set_labels] = useState<WorkshopScene['labels']>([])
  const [failed, set_failed] = useState(false)
  const quality = useAppStore(({ settings }) => settings.quality)
  const text = copy.demo_page
  useEffect(() => {
    if (!canvas) return
    const request = new AbortController()
    let mounted: ReturnType<typeof mount_asset_scene> | null = null
    set_scene(null)
    set_failed(false)
    const load = async () => {
      const response = await fetch(scene_url, { signal: request.signal })
      if (!response.ok) throw new Error(`Asset workshop request failed (${response.status})`)
      const data = (await response.json()) as WorkshopScene
      if (request.signal.aborted) return
      mounted = mount_asset_scene(canvas, data, quality)
      set_labels(data.labels)
      set_scene(mounted)
    }
    void load().catch((error: unknown) => {
      if (request.signal.aborted) return
      mounted?.dispose()
      mounted = null
      set_failed(true)
      console.error('Asset workshop could not load.', error)
    })
    return () => {
      request.abort()
      mounted?.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Quality updates the retained world through its own effect.
  }, [canvas])
  useEffect(() => {
    scene?.set_quality(quality, 3)
  }, [scene, quality])
  useEffect(() => {
    if (!scene) return
    const captions = labels.map(({ id, position, featured }, index) => {
      const outer = document.createElement('div')
      const element = document.createElement('span')
      element.setAttribute(
        'class',
        'pointer-events-none border border-white/15 bg-surface/85 px-2 py-1 font-mono text-[10px] text-[#ded4bb] shadow-sm'
      )
      element.append(document.createTextNode(`${String(index + 1).padStart(2, '0')} · ${text[`asset_${id}`]}`))
      outer.append(element)
      scene.set_world_label(`workshop:${id}`, outer, position)
      return { element, featured }
    })
    const feature = labels.find((label) => label.featured)
    let frame = 0
    let previous: boolean | null = null
    const update = () => {
      const { x, z } = scene.camera_focus()
      const [left, top, width, depth] = feature!.area
      const inside = x >= left && x <= left + width && z >= top && z <= top + depth
      if (inside !== previous) {
        captions.forEach(({ element, featured }) => element.toggleAttribute('hidden', inside && !featured))
        previous = inside
      }
      frame = requestAnimationFrame(update)
    }
    if (feature) update()
    return () => {
      cancelAnimationFrame(frame)
      labels.forEach(({ id }) => scene.set_world_label(`workshop:${id}`, null, null))
    }
  }, [scene, labels, text])
  return (
    <section className="absolute inset-0 bg-bg" aria-label={text.asset_gallery}>
      <canvas
        ref={set_canvas}
        tabIndex={0}
        aria-label={text.asset_gallery}
        className="absolute inset-0 size-full touch-none outline-none"
      />
      <WorldLoading source={scene} quality={quality} render_distance={3} failed={failed} />
      <p className="pointer-events-none absolute right-4 bottom-4 left-4 text-center text-[10px] text-white/75">
        {text.asset_hint}
      </p>
    </section>
  )
}
