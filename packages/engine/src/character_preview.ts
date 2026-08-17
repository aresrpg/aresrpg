// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A transient creation-screen renderer around the same avatar model path used by the world.

import {
  AgXToneMapping,
  AnimationMixer,
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'

import { create_character_model, type CharacterModel } from './character_model.ts'
import type { CharacterAppearanceRender } from './types.ts'

const BASE_YAW = -0.5

export type CharacterPreview = Readonly<{
  set_appearance: (appearance: CharacterAppearanceRender) => Promise<boolean>
  dispose: () => void
}>

const model_assets_key = ({ body_url, hair_url, worn }: CharacterAppearanceRender): string =>
  JSON.stringify([body_url, hair_url, worn])

export const create_character_preview = async (canvas: HTMLCanvasElement): Promise<CharacterPreview> => {
  const renderer = new WebGPURenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  })
  try {
    await renderer.init()
  } catch (error) {
    renderer.dispose()
    throw error
  }
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = AgXToneMapping
  renderer.toneMappingExposure = 1.15
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  const scene = new Scene()
  const camera = new PerspectiveCamera(32, 1, 0.1, 100)
  const pivot = new Group()
  scene.add(pivot)
  scene.add(new HemisphereLight(0xdfe8ff, 0x222018, 1.05))
  const key = new DirectionalLight(0xfff0d8, 2.1)
  key.position.set(-3, 5, 4)
  const fill = new DirectionalLight(0x9fc0ff, 0.7)
  fill.position.set(4, 2, 3)
  const rim = new DirectionalLight(0xffd9a0, 1)
  rim.position.set(0, 4, -5)
  scene.add(key, fill, rim)

  let model: CharacterModel | null = null
  let mixer: AnimationMixer | null = null
  let assets_key: string | null = null
  let generation = 0
  let yaw = BASE_YAW
  let animation_frame: number | null = null
  let previous_frame = performance.now()
  let render_width = 0
  let render_height = 0
  let disposed = false

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth)
    const height = Math.max(1, canvas.clientHeight)
    if (width === render_width && height === render_height) return
    render_width = width
    render_height = height
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  const frame_model = (next: CharacterModel): void => {
    next.root.position.set(0, 0, 0)
    next.root.updateWorldMatrix(true, true)
    const bounds = new Box3().setFromObject(next.root)
    const center = bounds.getCenter(new Vector3())
    const height = bounds.getSize(new Vector3()).y || 1.4
    next.root.position.set(-center.x, -bounds.min.y, -center.z)
    camera.position.set(0, height * 0.55, height * 1.95)
    camera.lookAt(0, height * 0.5, 0)
  }

  const release_model = (): void => {
    if (!model) return
    pivot.remove(model.root)
    mixer?.stopAllAction()
    mixer?.uncacheRoot(model.root)
    model.dispose()
    model = null
    mixer = null
    assets_key = null
  }

  const draw = (now: number): void => {
    if (disposed) return
    resize()
    const delta_seconds = Math.min(0.1, Math.max(0, now - previous_frame) / 1000)
    previous_frame = now
    mixer?.update(delta_seconds)
    pivot.rotation.y = yaw
    renderer.render(scene, camera)
    animation_frame = requestAnimationFrame(draw)
  }

  const resize_observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
  resize_observer?.observe(canvas)
  let dragging = false
  let last_x = 0
  const pointer_down = (event: PointerEvent): void => {
    dragging = true
    last_x = event.clientX
    canvas.setPointerCapture(event.pointerId)
  }
  const pointer_move = (event: PointerEvent): void => {
    if (!dragging) return
    yaw += (event.clientX - last_x) * 0.01
    last_x = event.clientX
  }
  const pointer_up = (event: PointerEvent): void => {
    dragging = false
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  }
  canvas.addEventListener('pointerdown', pointer_down)
  canvas.addEventListener('pointermove', pointer_move)
  window.addEventListener('pointerup', pointer_up)
  resize()
  animation_frame = requestAnimationFrame(draw)

  return Object.freeze({
    set_appearance: async (appearance) => {
      const next_assets_key = model_assets_key(appearance)
      if (model && next_assets_key === assets_key) {
        model.set_colors(appearance.colors)
        return true
      }
      generation += 1
      const load_generation = generation
      const next = await create_character_model(appearance)
      if (disposed || load_generation !== generation) {
        next.dispose()
        return false
      }
      release_model()
      model = next
      assets_key = next_assets_key
      yaw = BASE_YAW
      pivot.add(next.root)
      frame_model(next)
      mixer = next.clips.length > 0 ? new AnimationMixer(next.root) : null
      const idle = next.clips.find(({ name }) => name.toUpperCase().includes('IDLE')) ?? next.clips[0]
      if (idle) mixer?.clipAction(idle).play()
      mixer?.update(0)
      return !!appearance.body_url
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      generation += 1
      if (animation_frame !== null) cancelAnimationFrame(animation_frame)
      resize_observer?.disconnect()
      canvas.removeEventListener('pointerdown', pointer_down)
      canvas.removeEventListener('pointermove', pointer_move)
      window.removeEventListener('pointerup', pointer_up)
      release_model()
      renderer.dispose()
    },
  })
}
