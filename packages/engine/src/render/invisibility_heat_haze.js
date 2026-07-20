// INVISIBILITY — a real vanish, not a visibility toggle. The body is reduced to a faint translucent trace and
// replaced by a skinned heat-haze shell that samples a blurred, wobble-offset copy of the opaque scene behind it.
// The shell shares each source mesh's geometry/skeleton, so the distortion follows idle/walk/cast animation.

import { DoubleSide, Mesh, SkinnedMesh } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
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

const BODY_OPACITY = 0.07
const HAZE_ALPHA = 0.7
const HAZE_RIM_ALPHA = 0.16
const DISTORTION = 0.006
const BLUR_MIP = 2
const SHELL_GROW = 0.018

/** Build the conditional output graph for one haze shell. The `If` lives INSIDE the colorNode `Fn`: a
 * build-scope conditional would never join the material output graph under WebGPU. @param {*} age @param {*} active */
export function invisibility_color_node(age, active) {
  return Fn(() => {
    const out_rgb = vec3(0).toVar()
    const out_alpha = float(0).toVar()
    If(active.greaterThan(float(0.001)), () => {
      const p = positionWorld
      const wave_x = p.y
        .mul(11.3)
        .add(age.mul(3.7))
        .sin()
        .add(p.z.mul(5.1).sub(age.mul(2.2)).sin().mul(0.45))
      const wave_y = p.x
        .mul(9.7)
        .sub(age.mul(3.1))
        .sin()
        .add(p.y.mul(4.3).add(age.mul(1.8)).sin().mul(0.4))
      const distorted_uv = screenUV.add(vec2(wave_x, wave_y).mul(float(DISTORTION)).mul(active))
      const warped_uv = vec2(distorted_uv.x.clamp(0.002, 0.998), distorted_uv.y.clamp(0.002, 0.998))
      const blurred_backdrop = /** @type {*} */ (viewportOpaqueMipTexture(warped_uv, float(BLUR_MIP))).rgb
      const rim = normalView.dot(positionViewDirection).abs().oneMinus().pow(2).clamp(0, 1)
      const haze_tint = vec3(0.72, 0.9, 0.94)
      out_rgb.assign(mix(blurred_backdrop, haze_tint, rim.mul(0.1)))
      out_alpha.assign(float(HAZE_ALPHA).add(rim.mul(HAZE_RIM_ALPHA)).mul(active))
    })
    return vec4(out_rgb, out_alpha)
  })()
}

/** @param {*} age @param {*} active */
function make_haze_material(age, active) {
  const material = new MeshBasicNodeMaterial()
  material.transparent = true
  material.depthWrite = false
  material.side = DoubleSide
  material.positionNode = positionLocal.add(normalLocal.normalize().mul(float(SHELL_GROW)))
  material.colorNode = invisibility_color_node(age, active)
  return material
}

/** Clone a body's material lane into a nearly-transparent trace. The originals are retained verbatim and
 * restored when the status clears; no shared GLB material is mutated. @param {any} material */
function faded_material(material) {
  const fade_one = (/** @type {any} */ source) => {
    const faded = source.clone()
    faded.transparent = true
    faded.opacity = BODY_OPACITY
    faded.depthWrite = false
    faded.needsUpdate = true
    return faded
  }
  return Array.isArray(material) ? material.map(fade_one) : fade_one(material)
}

/** @param {any} material */
function dispose_material(material) {
  if (Array.isArray(material)) material.forEach((m) => m?.dispose?.())
  else material?.dispose?.()
}

/**
 * Attach a blurry-transparent heat-haze vanish to every loaded body mesh under `root`.
 * @param {import('three').Object3D} root
 * @returns {{ count:number, update:(dt:number)=>void, set_active:(next:boolean)=>void, dispose:()=>void }}
 */
export function attach_invisibility_heat_haze(root) {
  const age = uniform(0)
  const active = uniform(1)
  /** @type {{ source:any, original:any, faded:any, shell:any, material:any, cast_shadow:boolean }[]} */
  const records = []
  const seen = new WeakSet()
  /** @type {any[]} */
  const targets = []
  let disposed = false

  const attach_source = (/** @type {any} */ source) => {
    const original = source.material
    const faded = faded_material(original)
    const cast_shadow = source.castShadow
    source.material = faded
    source.castShadow = false
    const material = make_haze_material(age, active)
    /** @type {any} */
    let shell
    if (source.isSkinnedMesh) {
      shell = new SkinnedMesh(source.geometry, material)
      shell.bind(source.skeleton, source.bindMatrix)
      shell.bindMode = source.bindMode
    } else {
      shell = new Mesh(source.geometry, material)
    }
    shell.userData.__invisibility_shell = true
    shell.frustumCulled = false
    shell.castShadow = false
    shell.receiveShadow = false
    shell.renderOrder = 999
    source.add(shell)
    records.push({ source, original, faded, shell, material, cast_shadow })
  }

  // Hair/cosmetic meshes load independently after avatar.ready. Re-scan from update so no late opaque piece can
  // reveal the vanished fighter; `seen` makes the steady-state pass allocation-free apart from traversal itself.
  const attach_new_meshes = () => {
    targets.length = 0
    root.traverse((/** @type {any} */ object) => {
      if (
        object.isMesh &&
        !seen.has(object) &&
        !object.userData.__outline_shell &&
        !object.userData.__status_overlay &&
        !object.userData.__invisibility_shell
      )
        targets.push(object)
    })
    for (const source of targets) {
      seen.add(source)
      attach_source(source)
    }
  }
  attach_new_meshes()

  return {
    get count() {
      return records.length
    },
    update(dt) {
      if (disposed) return
      attach_new_meshes()
      age.value += Math.max(0, dt)
    },
    set_active(next) {
      if (!disposed) active.value = next ? 1 : 0
    },
    dispose() {
      if (disposed) return
      disposed = true
      active.value = 0
      for (const record of records) {
        record.shell.removeFromParent()
        record.material.dispose()
        if (record.source.material === record.faded) record.source.material = record.original
        record.source.castShadow = record.cast_shadow
        dispose_material(record.faded)
      }
      records.length = 0
    },
  }
}
