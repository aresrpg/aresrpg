// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Browser half of the deterministic GLB portrait generator. The launcher supplies a private
// Vite server and output endpoint; this scene uses the same composed character model as the game.

import {
  AgXToneMapping,
  AnimationMixer,
  Box3,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three'

import { create_character_model } from '../../engine/src/character_model.ts'
import { character_model_basenames } from '../src/content/character_model_catalog.ts'

const PORTRAIT_CLASSES = Object.freeze(['senshi', 'shugo', 'tomoda', 'yajin'] as const)
const PORTRAIT_SIZE = 500

const blob_of = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas did not produce a JPEG portrait.'))),
      'image/jpeg',
      0.92
    )
  )

const next_frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

const render_portrait = async (classe: (typeof PORTRAIT_CLASSES)[number], male: boolean): Promise<void> => {
  const model_names = character_model_basenames(classe, male)
  const model = await create_character_model({
    body_url: `/seed/models/characters/${model_names.body}.glb`,
    hair_url: model_names.hair ? `/seed/models/characters/${model_names.hair}.glb` : null,
    colors: Object.freeze(['#f2f2f2', '#d9af57', '#8b6539'] as const),
    worn: Object.freeze({ head: null, back: null }),
  })
  const renderer = new WebGLRenderer({ alpha: false, antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(PORTRAIT_SIZE, PORTRAIT_SIZE, false)
  renderer.setPixelRatio(1)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = AgXToneMapping
  renderer.toneMappingExposure = 1.15
  renderer.setClearColor(0x09090e, 1)

  const scene = new Scene()
  scene.background = new Color(0x09090e)
  scene.add(new HemisphereLight(0xdfe8ff, 0x17130d, 1.2))
  const key = new DirectionalLight(0xfff0d8, 2.4)
  key.position.set(-3, 5, 4)
  const fill = new DirectionalLight(0x8fb9ff, 0.85)
  fill.position.set(4, 2, 3)
  const rim = new DirectionalLight(0xffc76f, 1.15)
  rim.position.set(0, 4, -5)
  scene.add(key, fill, rim)

  const pivot = new Group()
  pivot.rotation.y = -0.5
  pivot.add(model.root)
  scene.add(pivot)
  const mixer = model.clips.length > 0 ? new AnimationMixer(model.root) : null
  const idle = model.clips.find(({ name }) => name.toUpperCase().includes('IDLE')) ?? model.clips[0]
  if (idle) mixer?.clipAction(idle).play()
  mixer?.update(0.15)

  model.root.updateWorldMatrix(true, true)
  const bounds = new Box3().setFromObject(model.root)
  const center = bounds.getCenter(new Vector3())
  const height = bounds.getSize(new Vector3()).y || 2
  model.root.position.set(-center.x, -bounds.min.y, -center.z)
  const camera = new PerspectiveCamera(29, 1, 0.1, 100)
  camera.position.set(0, height * 0.54, height * 1.72)
  camera.lookAt(0, height * 0.5, 0)

  document.body.replaceChildren(renderer.domElement)
  await renderer.compileAsync(scene, camera)
  renderer.render(scene, camera)
  await next_frame()
  renderer.render(scene, camera)
  const sex = male ? 'male' : 'female'
  const response = await fetch(`/__portrait_output?name=${encodeURIComponent(`${classe}_${sex}.jpg`)}`, {
    body: await blob_of(renderer.domElement),
    method: 'POST',
  })
  if (!response.ok) throw new Error(`Portrait output failed: ${response.status} ${await response.text()}`)
  mixer?.stopAllAction()
  model.dispose()
  renderer.dispose()
}

const run = async (): Promise<void> => {
  for (const classe of PORTRAIT_CLASSES) for (const male of [true, false]) await render_portrait(classe, male)
  document.body.dataset.portraitsComplete = 'true'
}

void run().catch((error: unknown) => {
  document.body.dataset.portraitsError = error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error(error)
})
