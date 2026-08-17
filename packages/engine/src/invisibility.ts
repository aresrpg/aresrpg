// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The retained invisibility treatment: a faint body trace plus a skinned screen-space heat-haze shell.
import { DoubleSide, Material, Mesh, SkinnedMesh, type Object3D } from 'three'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import {
  Fn,
  If,
  float,
  mix,
  normalLocal,
  normalView,
  positionLocal,
  positionViewDirection,
  positionWorld,
  screenUV,
  uniform,
  vec2,
  vec3,
  vec4,
  viewportOpaqueMipTexture,
} from 'three/tsl'

export type InvisibilityEffect = Readonly<{ update: (delta_seconds: number) => void; dispose: () => void }>

type HazeRecord = Readonly<{
  source: Mesh
  original: Material | Material[]
  faded: Material | Material[]
  shell: Mesh
  material: MeshBasicNodeMaterial
  cast_shadow: boolean
}>

const BODY_OPACITY = 0.07
const HAZE_ALPHA = 0.7
const HAZE_RIM_ALPHA = 0.16
const DISTORTION = 0.006
const BLUR_MIP = 2
const SHELL_GROW = 0.018

const invisibility_color_node = (age: Node<'float'>, active: Node<'float'>): Node<'vec4'> =>
  Fn(() => {
    const out_rgb = vec3(0).toVar()
    const out_alpha = float(0).toVar()
    If(active.greaterThan(float(0.001)), () => {
      const wave_x = positionWorld.y
        .mul(11.3)
        .add(age.mul(3.7))
        .sin()
        .add(positionWorld.z.mul(5.1).sub(age.mul(2.2)).sin().mul(0.45))
      const wave_y = positionWorld.x
        .mul(9.7)
        .sub(age.mul(3.1))
        .sin()
        .add(positionWorld.y.mul(4.3).add(age.mul(1.8)).sin().mul(0.4))
      const distorted_uv = screenUV.add(vec2(wave_x, wave_y).mul(float(DISTORTION)).mul(active))
      const warped_uv = vec2(distorted_uv.x.clamp(0.002, 0.998), distorted_uv.y.clamp(0.002, 0.998))
      const backdrop = (viewportOpaqueMipTexture(warped_uv, float(BLUR_MIP)) as Node<'vec4'>).rgb
      const rim = normalView.dot(positionViewDirection).abs().oneMinus().pow(2).clamp(0, 1)
      out_rgb.assign(mix(backdrop, vec3(0.72, 0.9, 0.94), rim.mul(0.1)))
      out_alpha.assign(float(HAZE_ALPHA).add(rim.mul(HAZE_RIM_ALPHA)).mul(active))
    })
    return vec4(out_rgb, out_alpha)
  })() as Node<'vec4'>

const haze_material = (age: Node<'float'>, active: Node<'float'>): MeshBasicNodeMaterial => {
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide })
  material.positionNode = positionLocal.add(normalLocal.normalize().mul(float(SHELL_GROW)))
  material.colorNode = invisibility_color_node(age, active)
  return material
}

const faded_material = (source: Material | Material[]): Material | Material[] => {
  const fade = (material: Material): Material => {
    const faded = material.clone()
    faded.transparent = true
    faded.opacity = BODY_OPACITY
    faded.depthWrite = false
    faded.needsUpdate = true
    return faded
  }
  return Array.isArray(source) ? source.map(fade) : fade(source)
}

const dispose_material = (material: Material | Material[]): void => {
  if (Array.isArray(material)) material.forEach((row) => row.dispose())
  else material.dispose()
}

export const attach_invisibility = (root: Object3D): InvisibilityEffect => {
  const age = uniform(0) as Node<'float'> & { value: number }
  const active = uniform(1) as Node<'float'>
  const records: HazeRecord[] = []
  const seen = new WeakSet<Mesh>()
  let disposed = false

  const attach_new_meshes = (): void => {
    root.traverse((object) => {
      const source = object as Mesh
      if (!source.isMesh || seen.has(source) || source.userData.__invisibility_shell) return
      seen.add(source)
      const original = source.material
      const faded = faded_material(original)
      const cast_shadow = source.castShadow
      source.material = faded
      source.castShadow = false
      const material = haze_material(age, active)
      const shell =
        source instanceof SkinnedMesh
          ? (() => {
              const skinned = new SkinnedMesh(source.geometry, material)
              skinned.bind(source.skeleton, source.bindMatrix)
              skinned.bindMode = source.bindMode
              return skinned
            })()
          : new Mesh(source.geometry, material)
      shell.userData.__invisibility_shell = true
      shell.frustumCulled = false
      shell.castShadow = false
      shell.receiveShadow = false
      shell.renderOrder = 999
      source.add(shell)
      records.push(Object.freeze({ source, original, faded, shell, material, cast_shadow }))
    })
  }

  attach_new_meshes()
  return Object.freeze({
    update: (delta_seconds) => {
      if (disposed) return
      attach_new_meshes()
      age.value += Math.max(0, delta_seconds)
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      records.forEach(({ source, original, faded, shell, material, cast_shadow }) => {
        shell.removeFromParent()
        material.dispose()
        if (source.material === faded) source.material = original
        source.castShadow = cast_shadow
        dispose_material(faded)
      })
      records.length = 0
    },
  })
}
