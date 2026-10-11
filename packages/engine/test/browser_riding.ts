// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  Raycaster,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  type SkinnedMesh,
  type Object3D,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import { create_entity_layer } from '../src/entities.ts'
import type { EntityRender, CharacterAppearanceRender } from '../src/types.ts'

const skinned_meshes = (root: Object3D): readonly SkinnedMesh[] => {
  const meshes: SkinnedMesh[] = []
  root.traverse((node) => {
    const mesh = node as SkinnedMesh
    if (mesh.isSkinnedMesh) meshes.push(mesh)
  })
  return meshes
}

const boot_floor = (root: Object3D): number => {
  let minimum = Infinity
  const point = new Vector3()
  for (const mesh of skinned_meshes(root)) {
    const joints = mesh.geometry.getAttribute('skinIndex')
    const weights = mesh.geometry.getAttribute('skinWeight')
    for (let index = 0; index < joints.count; index++) {
      const lane = [0, 1, 2, 3].reduce((best, next) =>
        weights.getComponent(index, next) > weights.getComponent(index, best) ? next : best
      )
      const bone = mesh.skeleton.bones[joints.getComponent(index, lane)]!
      if (!/(?:Foot|Toe)/i.test(bone.name)) continue
      mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld)
      minimum = Math.min(minimum, point.y)
    }
  }
  return minimum
}

const seat_surface_gap = (pet: Object3D, seat: Object3D): number | null => {
  for (const mesh of skinned_meshes(pet)) {
    mesh.computeBoundingBox()
    mesh.computeBoundingSphere()
  }
  const point = seat.getWorldPosition(new Vector3())
  const normal = new Vector3(0, 1, 0).transformDirection(seat.matrixWorld)
  const ray = new Raycaster(point.clone().addScaledVector(normal, 0.1), normal.negate(), 0, 0.5)
  const [hit] = ray.intersectObject(pet, true)
  return hit ? hit.point.distanceTo(point) : null
}

const sample_rider = (scene: Scene, sex: string) => {
  const root = scene.getObjectByName(`entity:${sex}`)
  const pet = scene.getObjectByName(`entity:pet_${sex}`)
  const rider = root?.getObjectByName('Rider')
  const seat = pet?.getObjectByName('Mount')
  if (!root || !pet || !rider || !seat) return { sex, visible: false, gap: null, feet_y: null, surface_gap: null }
  root.updateMatrixWorld(true)
  pet.updateMatrixWorld(true)
  const point = seat.getWorldPosition(new Vector3())
  return {
    sex,
    visible: root.visible,
    gap: rider.getWorldPosition(new Vector3()).distanceTo(point),
    feet_y: boot_floor(root),
    surface_gap: seat_surface_gap(pet, seat),
  }
}

export const create_riding_probe = async (
  canvas: HTMLCanvasElement,
  load_appearance: (classe: string, male: boolean) => Promise<CharacterAppearanceRender>,
  load_pet: (pet_type: string) => Promise<string | null>
) => {
  const renderer = new WebGPURenderer({ canvas, antialias: true })
  await renderer.init()
  renderer.setSize(innerWidth, innerHeight, false)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = NeutralToneMapping
  const scene = new Scene()
  scene.background = new Color('#18212c')
  const camera = new PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 100)
  const controls = new OrbitControls(camera, canvas)
  controls.target.set(0, 1.4, 0)
  camera.position.set(4, 3.2, 8)
  controls.update()
  scene.add(new HemisphereLight(0xffffff, 0x34303a, 2))
  const sun = new DirectionalLight(0xffeddd, 2)
  sun.position.set(2, 5, 4)
  scene.add(sun)
  const floor = new Mesh(new PlaneGeometry(30, 30), new MeshStandardMaterial({ color: '#465149', roughness: 1 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.02
  scene.add(floor)
  const entities = create_entity_layer({ scene })
  let specs: readonly EntityRender[] = []
  let moving = false
  let clock = performance.now()
  let previous = clock
  const choose = async (pet_type: string, classe = 'senshi') => {
    const pet_url = await load_pet(pet_type)
    if (!pet_url) throw new Error(`Missing pet ${pet_type}`)
    specs = (
      await Promise.all(
        [true, false].map(async (male) => {
          const sex = male ? 'male' : 'female'
          const appearance = await load_appearance(classe, male)
          return [
            {
              id: sex,
              kind: 'character',
              appearance,
              anchor: { kind: 'mount', entity_id: `pet_${sex}` },
              facing: { kind: 'yaw', yaw: 0 },
              animation: { name: 'SIT', time_scale: 1 },
            },
            {
              id: `pet_${sex}`,
              kind: 'mob',
              model_url: pet_url,
              anchor: { kind: 'world', position: [male ? -1.5 : 1.5, 0, 0] },
              facing: { kind: 'yaw', yaw: 0 },
              animation: { name: moving ? 'RUN' : 'IDLE', time_scale: 1 },
            },
          ] satisfies EntityRender[]
        })
      )
    ).flat()
    entities.set(specs)
  }
  const draw = (now: number) => {
    clock += Math.min(50, now - previous)
    previous = now
    entities.tick(clock)
    renderer.render(scene, camera)
    requestAnimationFrame(draw)
  }
  requestAnimationFrame(draw)
  const probe = {
    choose,
    moving: (next: boolean) => {
      moving = next
      specs = specs.map((spec) =>
        spec.kind === 'mob' ? { ...spec, animation: { name: moving ? 'RUN' : 'IDLE', time_scale: 1 } } : spec
      )
      entities.set(specs)
    },
    view: (x: number, y: number, z: number) => {
      camera.position.set(x, y, z)
      controls.update()
    },
    frame: () => {
      const height = Math.max(entities.live_crown('male')?.y ?? 2, entities.live_crown('female')?.y ?? 2)
      controls.target.set(0, height / 2, 0)
      camera.position.set(4, height / 2 + 2, 8)
      controls.update()
    },
    snapshot: () => ['male', 'female'].map((sex) => sample_rider(scene, sex)),
  }
  return probe
}
