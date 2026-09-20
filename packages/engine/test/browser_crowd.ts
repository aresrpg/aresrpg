// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  AmbientLight,
  AnimationClip,
  AnimationMixer,
  Bone,
  BoxGeometry,
  Color,
  DirectionalLight,
  DataTexture,
  SRGBColorSpace,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  VectorKeyframeTrack,
} from 'three'
import { Renderer, StandardNodeLibrary, WebGPUBackend } from 'three/webgpu'

import { create_character_crowd_layer } from '../src/character_crowd.ts'
import type { CharacterEntityRender } from '../src/types.ts'

/** Pixel parity against ordinary skinned objects, including the standard shadow pass. */
export const probe_crowd = async (canvas: HTMLCanvasElement, morph: boolean) => {
  const renderer = new Renderer(new WebGPUBackend({ canvas }), {})
  renderer.library = new StandardNodeLibrary()
  await renderer.init()
  renderer.setSize(320, 240, false)
  renderer.shadowMap.enabled = true
  const scene = new Scene()
  scene.background = new Color('#202638')
  const camera = new OrthographicCamera(-5, 5, 3.75, -3.75, 0.1, 100)
  camera.position.set(5, 5, 9)
  camera.lookAt(0, 0.7, 0)
  const sunlight = new DirectionalLight(0xffffff, 3)
  sunlight.position.set(3, 7, 4)
  sunlight.castShadow = true
  sunlight.shadow.mapSize.set(256, 256)
  sunlight.shadow.camera.left = -6
  sunlight.shadow.camera.right = 6
  sunlight.shadow.camera.top = 6
  sunlight.shadow.camera.bottom = -6
  const floor = new Mesh(new PlaneGeometry(14, 14), new MeshStandardMaterial({ color: '#787878', roughness: 1 }))
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(sunlight, new AmbientLight(0xffffff, 0.7), floor)
  const base_texture = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  base_texture.name = 'body_base'
  base_texture.colorSpace = SRGBColorSpace
  base_texture.needsUpdate = true
  const mask_texture = base_texture.clone()
  mask_texture.name = 'body_color1'
  mask_texture.needsUpdate = true
  const make = () => {
    const root = new Group()
    const bone = new Bone()
    bone.name = 'root_bone'
    const geometry = new BoxGeometry(0.8, 1.8, 0.5)
    geometry.translate(0, 0.9, 0)
    const { count } = geometry.attributes.position!
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(count * 4), 4))
    geometry.setAttribute(
      'skinWeight',
      new Float32BufferAttribute(
        Array.from({ length: count * 4 }, (_, index) => (index % 4 === 0 ? 1 : 0)),
        4
      )
    )
    if (morph) {
      const target = geometry.attributes.position!.clone()
      for (let index = 0; index < count; index++) target.setZ(index, target.getZ(index) + target.getY(index) * 0.3)
      geometry.morphAttributes.position = [target]
    }
    const material = new MeshStandardMaterial({ map: base_texture, roughness: 0.6 })
    const mesh = new SkinnedMesh(geometry, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    const mask_geometry = new BoxGeometry()
    const mask_material = new MeshStandardMaterial({ map: mask_texture })
    const mask = new Mesh(mask_geometry, mask_material)
    mask.visible = false
    root.add(bone, mesh, mask)
    root.updateMatrixWorld(true)
    mesh.bind(new Skeleton([bone]))
    if (morph) mesh.morphTargetInfluences![0] = 0.6
    const clips = [
      new AnimationClip('RUN', 1, [new VectorKeyframeTrack('root_bone.position', [0, 1], [0, 0, 0, 0, 4, 0])]),
    ]
    return {
      root,
      clips,
      min_y: 0,
      set_colors: () => {},
      dispose: () => {
        mesh.skeleton.dispose()
        geometry.dispose()
        material.dispose()
        mask_geometry.dispose()
        mask_material.dispose()
      },
    }
  }
  const specs: CharacterEntityRender[] = [-2, 2].map((x, index) => ({
    id: `actor_${index}`,
    kind: 'character',
    presentation: 'crowd',
    appearance: {
      body_url: 'same_rig',
      hair_url: null,
      colors: [index ? '#52bbff' : '#ffaa33', '#fff', '#fff'],
      worn: { head: null, back: null },
    },
    anchor: { kind: 'world', position: [x, 0, 0] },
    facing: { kind: 'yaw', yaw: index ? 0.7 : -0.3 },
    animation: { name: 'RUN', time_scale: index ? 1 : 0 },
  }))
  const read = document.createElement('canvas')
  read.width = 320
  read.height = 240
  const context = read.getContext('2d')!
  const pixels = () => {
    context.drawImage(canvas, 0, 0)
    return context.getImageData(0, 0, 320, 240).data
  }
  const frame = async () => {
    await new Promise(requestAnimationFrame)
    renderer.render(scene, camera)
  }
  const settle = async () => {
    for (let index = 0; index < 8; index++) await frame()
  }
  const references = specs.map((spec, index) => {
    const model = make()
    const surface = model.root.children.find((child) => child instanceof SkinnedMesh) as SkinnedMesh
    ;(surface.material as MeshStandardMaterial).color.set(spec.appearance.colors[0])
    model.root.position.x = index ? 2 : -2
    model.root.rotation.y = spec.facing.kind === 'yaw' ? spec.facing.yaw : 0
    const mixer = new AnimationMixer(model.root)
    mixer
      .clipAction(model.clips[0]!)
      .play()
      .setEffectiveTimeScale(index ? 1 : 0)
    mixer.update(0.1)
    scene.add(model.root)
    return { model, mixer }
  })
  const crowd = create_character_crowd_layer({ scene, load_model: async () => make() })
  try {
    await settle()
    const expected = pixels()
    const reference_image = canvas.toDataURL('image/png')
    references.forEach(({ model, mixer }) => {
      scene.remove(model.root)
      mixer.stopAllAction()
      model.dispose()
    })
    crowd.set(specs as never)
    await new Promise((resolve) => setTimeout(resolve, 0))
    crowd.tick(performance.now() + 1000) // The production clamp advances both poses by exactly 100 ms.
    await settle()
    const actual = pixels()
    let difference = 0
    for (let index = 0; index < actual.length; index++) difference += Math.abs(actual[index]! - expected[index]!)
    return {
      mean_difference: difference / actual.length,
      reference_image,
      crowd_image: canvas.toDataURL('image/png'),
      batches: crowd.stats().batches,
    }
  } finally {
    crowd.dispose()
    floor.geometry.dispose()
    floor.material.dispose()
    sunlight.shadow.map?.dispose()
    renderer.dispose()
    base_texture.dispose()
    mask_texture.dispose()
  }
}
