// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The char-create PEDESTAL — an imperative Three.js scene that renders the haired character GLB on
// a soft-shadow pedestal with drag-to-rotate, live 3-colour recolour, and the IDLE animation loop.
// It owns its own WebGLRenderer (the recolour composite needs a renderer, exactly as production
// `set_colors(colors, renderer)`). Lighting + tone-mapping match design's approved mockup
// (`p2-charcreate-v827-grid.png`): warm key upper-left, cool fill, warm rim, ACES + sRGB.

import {
  Box3,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  ACESFilmicToneMapping,
  SRGBColorSpace,
} from 'three'

import { load_character_model } from './character-glb.js'

const add_lights = (scene) => {
  scene.add(new HemisphereLight(0xdfe8ff, 0x222018, 1.05))
  const key = new DirectionalLight(0xfff0d8, 2.1)
  key.position.set(-3, 5, 4)
  scene.add(key)
  const fill = new DirectionalLight(0x9fc0ff, 0.7)
  fill.position.set(4, 2, 3)
  scene.add(fill)
  const rim = new DirectionalLight(0xffd9a0, 1.0)
  rim.position.set(0, 4, -5)
  scene.add(rim)
}

const BASE_YAW = -0.5 // slight 3/4 turn (matches the mockup)

/**
 * Mount a pedestal scene into `canvas`. Async model loads are owned here; selecting a class with no
 * local GLB resolves `false` from `set_class` so the host can show the "model soon" placeholder.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {{
 *   set_class: (class_id: string, opts?: { male?: boolean }) => Promise<boolean>,
 *   set_colors: (colors: [string, string, string]) => void,
 *   destroy: () => void,
 * }}
 */
export function character_pedestal(canvas) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  const scene = new Scene()
  const camera = new PerspectiveCamera(32, 1, 0.1, 100)
  add_lights(scene)

  const pivot = new Group() // drag rotates this; model lives inside
  scene.add(pivot)

  let model = /** @type {Awaited<ReturnType<typeof load_character_model>>} */ (null)
  let load_token = 0 // guards against a stale async load landing after a newer selection
  let colors = /** @type {[string, string, string]} */ (['#ffffff', '#cccccc', '#888888'])
  let yaw = BASE_YAW
  let raf = 0
  let last = performance.now()
  let destroyed = false

  const size = () => {
    const w = canvas.clientWidth || 1
    const h = canvas.clientHeight || 1
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  // frame the loaded model: drop it on the pedestal (feet ~ y=0) + place the camera, lifted from the
  // mockup harness so the framing matches the design gate.
  const frame = () => {
    if (!model) return
    model.object3d.position.set(0, 0, 0)
    model.object3d.updateMatrixWorld(true)
    const box = new Box3().setFromObject(model.object3d)
    const center = box.getCenter(new Vector3())
    const h = box.getSize(new Vector3()).y || 1.8
    model.object3d.position.x -= center.x
    model.object3d.position.z -= center.z
    model.object3d.position.y -= box.min.y // feet to the pedestal
    camera.position.set(0, h * 0.55, h * 1.95)
    camera.lookAt(0, h * 0.5, 0)
  }

  const apply_colors = () => {
    if (model) model.set_colors(colors, renderer)
  }

  const tick = () => {
    if (destroyed) return
    const now = performance.now()
    const dt = (now - last) / 1000
    last = now
    model?.mixer?.update(dt)
    pivot.rotation.y = yaw
    renderer.render(scene, camera)
    raf = requestAnimationFrame(tick)
  }

  size()
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(size) : null
  ro?.observe(canvas)

  // drag-to-rotate (pointer events => clickable in dev + on touch). Rotating the pivot only spins
  // the model, never the lights, so the key/fill/rim stay fixed (cleaner read while turning).
  let dragging = false
  let last_x = 0
  const on_down = (e) => {
    dragging = true
    last_x = e.clientX
    canvas.setPointerCapture?.(e.pointerId)
  }
  const on_move = (e) => {
    if (!dragging) return
    yaw += (e.clientX - last_x) * 0.01
    last_x = e.clientX
  }
  const on_up = (e) => {
    dragging = false
    canvas.releasePointerCapture?.(e.pointerId)
  }
  canvas.addEventListener('pointerdown', on_down)
  canvas.addEventListener('pointermove', on_move)
  window.addEventListener('pointerup', on_up)

  raf = requestAnimationFrame(tick)

  return {
    async set_class(class_id, { male = true } = {}) {
      // D212: gender rides the same load path (male/female rigs per CHARACTER_MODELS) — the creator's
      // picker re-calls this on toggle; apply_colors() below re-paints the fresh clone.
      const token = ++load_token
      const next = await load_character_model(class_id, { male })
      if (destroyed || token !== load_token) {
        next?.dispose()
        return !!next
      }
      if (model) {
        pivot.remove(model.object3d)
        model.dispose()
      }
      model = next
      yaw = BASE_YAW
      if (model) {
        pivot.add(model.object3d)
        frame()
        apply_colors()
      }
      return !!model
    },
    set_colors(next) {
      colors = next
      apply_colors()
    },
    destroy() {
      destroyed = true
      cancelAnimationFrame(raf)
      ro?.disconnect()
      canvas.removeEventListener('pointerdown', on_down)
      canvas.removeEventListener('pointermove', on_move)
      window.removeEventListener('pointerup', on_up)
      if (model) {
        pivot.remove(model.object3d)
        model.dispose()
        model = null
      }
      renderer.dispose()
    },
  }
}

/**
 * Render ONE static GLB thumbnail for the class grid, as a transparent-PNG data URL. A throwaway renderer is
 * created + DISPOSED per call so no WebGL context lingers (the live pedestal keeps the only persistent
 * context). Resolves null for a class with no local GLB.
 * @param {string} class_id
 * @param {number} [px]
 * @param {[string, string, string]} [colors]  the same default palette the create grid applies on select
 *   (caller's SSOT) — keeps the thumb and the picked colours consistent. Defaults to a neutral set.
 * @returns {Promise<string | null>}
 */
export async function render_character_thumbnail(class_id, px = 128, colors = ['#d8b48a', '#9aa6b8', '#b23838']) {
  const model = await load_character_model(class_id)
  if (!model) return null
  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = px
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true, // required for toDataURL to capture the WebGL pixels
  })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  renderer.setSize(px, px, false)

  const scene = new Scene()
  add_lights(scene)
  const camera = new PerspectiveCamera(30, 1, 0.1, 100)
  scene.add(model.object3d)

  model.object3d.rotation.y = BASE_YAW
  model.object3d.updateMatrixWorld(true)
  model.mixer?.update(0.6) // settle off the bind pose
  model.object3d.updateMatrixWorld(true)
  const box = new Box3().setFromObject(model.object3d)
  const center = box.getCenter(new Vector3())
  const h = box.getSize(new Vector3()).y || 1.8
  // frame the head + torso (the grid thumb reads best as a bust, like the mockup)
  camera.position.set(0, box.max.y - h * 0.18, h * 0.95)
  camera.lookAt(new Vector3(center.x, box.max.y - h * 0.2, center.z))

  model.set_colors(colors, renderer)
  renderer.setClearColor(new Color(0x000000), 0)
  renderer.render(scene, camera)
  const url = canvas.toDataURL('image/png')

  model.dispose()
  renderer.dispose()
  renderer.forceContextLoss() // free the throwaway WebGL context now (don't wait for GC)
  return url
}
