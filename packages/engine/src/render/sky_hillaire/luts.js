// C9 Hillaire sky — THE FOUR LUTs as WebGPU/TSL compute kernels (the house `Fn(()=>{…}).compute(N)`
// idiom, copied from render/sky/clouds.js's bake kernels) + their sampler nodes. One thread per texel;
// `renderer.computeAsync(kernel)` runs them. All math is in KM (physics.js); the atmosphere uniform bag
// `U` + the dynamic uniform bag `dyn` (sun dir, camera altitude, aerial frustum basis) drive them.
//
//   1. TRANSMITTANCE 256×64  — optical depth to the top of atmosphere (no scattering). Param-only rebuild.
//   2. MULTIPLE-SCATTERING 32² — the isotropic ≥2nd-order geometric-series trick F_ms = 1/(1−f_ms),
//      sphere-sampled directions. Param-only rebuild (sun is a LUT AXIS, not fixed).
//   3. SKY-VIEW 200×100     — in-scatter along the view ray, non-linear horizon packing. Per-frame.
//   4. AERIAL-PERSPECTIVE 32³ — camera-frustum froxels: RGB in-scatter + A mean transmittance. Per-frame.

import { HalfFloatType } from 'three'
import { Storage3DTexture, StorageTexture } from 'three/webgpu'
import {
  Fn,
  Loop,
  clamp,
  cos,
  exp,
  float,
  instanceIndex,
  length,
  max,
  pow,
  sin,
  sqrt,
  texture,
  texture3D,
  textureStore,
  uvec2,
  uvec3,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

import {
  mie_phase_hg,
  ray_hits_ground,
  ray_march_length,
  rayleigh_phase,
  sample_medium,
  skyview_params_to_uv,
  transmittance_params_to_uv,
  uv_to_skyview_params,
  uv_to_transmittance_params,
} from './physics.js'

const { PI } = Math

/**
 * Allocate the four LUT textures + build the kernel factories and sampler nodes.
 * @param {object} args
 * @param {import('./physics.js').AtmoUniforms} args.U atmosphere uniform bag (km / per-km).
 * @param {*} args.dyn dynamic uniform bag: { sun_dir vec3, cam_height_km float, cam_fwd/cam_right/cam_up
 *   vec3, tan_half_x/tan_half_y float, aerial_range_km float, aerial_depth_power float }.
 * @param {import('./atmosphere_params.js').SkyTier} args.tier resolutions + step counts.
 */
export function create_luts({ U, dyn, tier }) {
  // ── textures (HalfFloat RGBA — HDR luminance; the paper's tiny LUTs) ──────────────────────────────
  const transmittance = new StorageTexture(tier.transmittance_w, tier.transmittance_h)
  transmittance.type = HalfFloatType
  transmittance.generateMipmaps = false
  const multiscatter = new StorageTexture(tier.multiscatter_res, tier.multiscatter_res)
  multiscatter.type = HalfFloatType
  multiscatter.generateMipmaps = false
  const skyview = new StorageTexture(tier.skyview_w, tier.skyview_h)
  skyview.type = HalfFloatType
  skyview.generateMipmaps = false
  const aerial = new Storage3DTexture(tier.aerial_res, tier.aerial_res, tier.aerial_slices)
  aerial.type = HalfFloatType

  // float-coerce the radii (the uniform bag is typed `*`; `.mul(any)` would otherwise default to vec3).
  const ground = float(U.ground_radius)
  const top = float(U.top_radius)

  // ── sampler nodes (read the LUTs from other shaders) ──────────────────────────────────────────────
  /** Transmittance to the top of atmosphere from radius `r` along zenith-cosine `mu`. @param {*} r @param {*} mu @returns {*} vec3 */
  const sample_transmittance = (r, mu) => texture(transmittance, transmittance_params_to_uv(U, r, mu), 0).xyz
  /** Multiple-scattering Psi_ms at radius `r` for sun zenith-cosine `sun_cos`. @param {*} r @param {*} sun_cos @returns {*} vec3 */
  const sample_multiscatter = (r, sun_cos) => {
    const u = sun_cos.mul(0.5).add(0.5)
    const v = r.sub(ground).div(top.sub(ground))
    return texture(multiscatter, vec2(clamp(u, 0, 1), clamp(v, 0, 1)), 0).xyz
  }
  /** Sun transmittance INCLUDING the planet-shadow terminator (0 when the sun ray hits the ground).
   *  @param {*} r @param {*} sun_cos @returns {*} vec3 */
  const sun_transmittance = (r, sun_cos) =>
    ray_hits_ground(r, sun_cos, ground).select(vec3(0), sample_transmittance(r, sun_cos))

  // ── 1. TRANSMITTANCE kernel ───────────────────────────────────────────────────────────────────────
  const build_transmittance_kernel = () => {
    const W = tier.transmittance_w
    const H = tier.transmittance_h
    const N = tier.transmittance_steps
    const k = Fn(() => {
      const i = instanceIndex
      // ComputeNode auto-prepends the `i ≥ count` bounds guard (count = W·H); a manual guard here emits a
      // REDUNDANT second `return` — avoids an unreachable-return lint warning. Rely on the auto-guard.
      const x = i.mod(W)
      const y = i.div(W)
      const uv = vec2(float(x).add(0.5).div(W), float(y).add(0.5).div(H))
      const { r, mu } = uv_to_transmittance_params(U, uv)
      const t_max = ray_march_length(U, r, mu)
      const dt = t_max.div(N)
      const optical_depth = vec3(0).toVar()
      Loop(N, ({ i: si }) => {
        const t = float(si).add(0.5).mul(dt)
        // |P| = sqrt(r² + 2·r·mu·t + t²); altitude h = |P| − ground.
        const r_s = sqrt(r.mul(r).add(r.mul(mu).mul(t).mul(2)).add(t.mul(t)))
        const m = sample_medium(U, max(r_s.sub(ground), float(0)))
        optical_depth.addAssign(m.extinction.mul(dt))
      })
      textureStore(transmittance, uvec2(x.toUint(), y.toUint()), vec4(exp(optical_depth.negate()), 1)).toWriteOnly()
    })().compute(W * H)
    k.setName('hillaireTransmittance')
    return k
  }

  // ── 2. MULTIPLE-SCATTERING kernel (isotropic geometric series) ────────────────────────────────────
  const build_multiscatter_kernel = () => {
    const R = tier.multiscatter_res
    const M = tier.multiscatter_steps
    const SQRT = tier.multiscatter_sqrt_samples
    const N_DIR = SQRT * SQRT
    const UNIFORM_PHASE = float(1 / (4 * PI))
    const SPHERE_W = (4 * PI) / N_DIR // sphere-INTEGRAL weight (∫·dω ≈ 4π/N·Σ) — for the radiance terms
    const F_MS_W = 1 / N_DIR // sphere-AVERAGE weight — the feedback factor f_ms is the mean single-scatter
    //   albedo (bounded <1), NOT an integral; a 4π/N weight would push f_ms>1 and diverge 1/(1−f_ms).
    const k = Fn(() => {
      const i = instanceIndex
      // ComputeNode auto-guards `i ≥ count` (count = R·R); no manual bounds-return (was the unreachable-return).
      const x = i.mod(R)
      const y = i.div(R)
      const sun_cos = float(x).add(0.5).div(R).mul(2).sub(1) // u → cos sun zenith [−1,1]
      const r = float(y).add(0.5).div(R).mul(top.sub(ground)).add(ground) // v → radius
      const sun = vec3(sqrt(max(float(1).sub(sun_cos.mul(sun_cos)), float(0))), sun_cos, 0)
      const origin = vec3(0, r, 0)

      const lum_2nd = vec3(0).toVar() // Σ L (2nd-order in-scatter)
      const f_ms = vec3(0).toVar() // Σ MultiScatAs1 (feedback factor)
      Loop(N_DIR, ({ i: d }) => {
        // uniform-sphere direction from stratified (i,j).
        const ii = d.mod(SQRT)
        const jj = d.div(SQRT)
        const rand_a = float(ii).add(0.5).div(SQRT)
        const rand_b = float(jj).add(0.5).div(SQRT)
        const theta = rand_a.mul(2 * PI)
        const cos_phi = float(1).sub(rand_b.mul(2)) // 1 − 2·rand_b — uniform-sphere cos(latitude)
        const sin_phi = sqrt(max(float(1).sub(cos_phi.mul(cos_phi)), float(0)))
        const dir = vec3(cos(theta).mul(sin_phi), cos_phi, sin(theta).mul(sin_phi))

        const mu = dir.y // dir zenith-cosine (origin is on +Y axis)
        const t_max = ray_march_length(U, r, mu)
        const dt = t_max.div(M)
        const throughput = vec3(1).toVar()
        Loop(M, ({ i: si }) => {
          const t = float(si).add(0.5).mul(dt)
          const p = origin.add(dir.mul(t))
          const r_s = length(p)
          const up = p.div(r_s)
          const m = sample_medium(U, max(r_s.sub(ground), float(0)))
          const sun_cos_s = up.dot(sun)
          const t_sun = sun_transmittance(r_s, sun_cos_s)
          const step_t = exp(m.extinction.mul(dt).negate())
          // 2nd-order in-scatter: uniform phase, sun transmittance, NO multiscatter feedback.
          const s_in = t_sun.mul(m.scattering).mul(UNIFORM_PHASE)
          lum_2nd.addAssign(throughput.mul(s_in.sub(s_in.mul(step_t)).div(m.extinction.max(float(1e-6)))).mul(SPHERE_W))
          // feedback factor: the sphere-AVERAGE of ∫ throughput·scattering ds (bounded by the albedo <1).
          f_ms.addAssign(
            throughput.mul(m.scattering.sub(m.scattering.mul(step_t)).div(m.extinction.max(float(1e-6)))).mul(F_MS_W)
          )
          throughput.mulAssign(step_t)
        })
        // ground bounce: if the ray reached the planet, add the diffuse-reflected sunlight (Lambert).
        const p_g = origin.add(dir.mul(t_max))
        const r_g = length(p_g)
        const up_g = p_g.div(r_g)
        const sun_cos_g = up_g.dot(sun)
        const bounce = sun_transmittance(ground, sun_cos_g)
          .mul(U.ground_albedo)
          .mul(1 / PI)
          .mul(max(sun_cos_g, float(0)))
        // the ground reflection enters the field isotropically (uniform-phase convention) → same net 1/N weight.
        lum_2nd.addAssign(
          ray_hits_ground(r, mu, ground).select(throughput.mul(bounce).mul(UNIFORM_PHASE).mul(SPHERE_W), vec3(0))
        )
      })
      // geometric series: Psi_ms = L_2nd · 1/(1 − f_ms). f_ms clamped <0.95 so the series can't diverge.
      const psi = lum_2nd.div(float(1).sub(f_ms.min(float(0.95))))
      textureStore(multiscatter, uvec2(x.toUint(), y.toUint()), vec4(psi, 1)).toWriteOnly()
    })().compute(R * R)
    k.setName('hillaireMultiScatter')
    return k
  }

  // ── in-scatter march shared by SKY-VIEW + AERIAL (analytic step trick + multiscatter feedback) ────
  /**
   * March `origin → dir` for `n_steps` over `t_max` km, returning { L, throughput } after the ray.
   * @param {*} origin vec3 @param {*} dir vec3 @param {*} sun vec3 @param {*} t_max float @param {number} n_steps
   */
  const integrate_inscatter = (origin, dir, sun, t_max, n_steps) => {
    const cos_view_sun = dir.dot(sun)
    const rayl_ph = rayleigh_phase(cos_view_sun)
    const mie_ph = mie_phase_hg(U.mie_g, cos_view_sun)
    const dt = t_max.div(n_steps)
    const L = vec3(0).toVar()
    const throughput = vec3(1).toVar()
    Loop(n_steps, ({ i: si }) => {
      const t = float(si).add(0.5).mul(dt)
      const p = origin.add(dir.mul(t))
      const r_s = length(p)
      const up = p.div(r_s)
      const m = sample_medium(U, max(r_s.sub(ground), float(0)))
      const sun_cos_s = up.dot(sun)
      const t_sun = sun_transmittance(r_s, sun_cos_s)
      const psi_ms = sample_multiscatter(r_s, sun_cos_s)
      // phase-weighted single scatter + isotropic multiscatter feedback, all × sun illuminance.
      const phase_scatter = m.rayleigh_s.mul(rayl_ph).add(m.mie_s.mul(mie_ph))
      const s_in = U.sun_illuminance.mul(t_sun.mul(phase_scatter).add(psi_ms.mul(m.scattering)))
      const step_t = exp(m.extinction.mul(dt).negate())
      L.addAssign(throughput.mul(s_in.sub(s_in.mul(step_t)).div(m.extinction.max(float(1e-6)))))
      throughput.mulAssign(step_t)
    })
    return { L, throughput }
  }

  // ── 3. SKY-VIEW kernel ────────────────────────────────────────────────────────────────────────────
  const build_skyview_kernel = () => {
    const W = tier.skyview_w
    const H = tier.skyview_h
    const N = tier.skyview_steps
    const k = Fn(() => {
      const i = instanceIndex
      // ComputeNode auto-prepends the `i ≥ count` bounds guard (count = W·H); a manual guard here emits a
      // REDUNDANT second `return` — avoids an unreachable-return lint warning. Rely on the auto-guard.
      const x = i.mod(W)
      const y = i.div(W)
      const uv = vec2(float(x).add(0.5).div(W), float(y).add(0.5).div(H))
      const cam_r = dyn.cam_height_km.add(ground)
      const params = uv_to_skyview_params(U, uv, cam_r)
      const vzc = float(params.view_zenith_cos) // float-coerce (physics returns `*`)
      const lvc = float(params.light_view_cos)
      const vz_sin = sqrt(max(float(1).sub(vzc.mul(vzc)), float(0)))
      // view dir in the local frame where the sun's horizontal projection is +x.
      const lv_sin = sqrt(max(float(1).sub(lvc.mul(lvc)), float(0)))
      const dir = vec3(vz_sin.mul(lvc), vzc, vz_sin.mul(lv_sin))
      const sc = float(dyn.sun_dir.y)
      const sun = vec3(sqrt(max(float(1).sub(sc.mul(sc)), float(0))), sc, 0)
      const origin = vec3(0, cam_r, 0)
      const t_max = ray_march_length(U, cam_r, vzc)
      const { L } = integrate_inscatter(origin, dir, sun, t_max, N)
      textureStore(skyview, uvec2(x.toUint(), y.toUint()), vec4(L, 1)).toWriteOnly()
    })().compute(W * H)
    k.setName('hillaireSkyView')
    return k
  }

  // ── 4. AERIAL-PERSPECTIVE kernel (camera-frustum froxels) ────────────────────────────────────────
  // ONE thread per (x,y) ray (AR² threads, NOT AR²·slices): march the ray ONCE, writing each slice's
  // cumulative in-scatter + mean transmittance as it is crossed. The efficient Hillaire froxel build —
  // ~AS× fewer marches than a per-texel dispatch, which matters for the per-frame rebuild budget.
  const build_aerial_kernel = () => {
    const AR = tier.aerial_res
    const AS = tier.aerial_slices
    const k = Fn(() => {
      const i = instanceIndex
      // ComputeNode auto-guards `i ≥ count` (count = AR·AR); no manual bounds-return (was the unreachable-return).
      const x = i.mod(AR)
      const y = i.div(AR)
      // reconstruct the world view ray for this froxel column from the camera frustum basis.
      const ndc_x = float(x).add(0.5).div(AR).mul(2).sub(1)
      const ndc_y = float(y).add(0.5).div(AR).mul(2).sub(1)
      const dir = dyn.cam_fwd
        .add(dyn.cam_right.mul(ndc_x.mul(dyn.tan_half_x)))
        .add(dyn.cam_up.mul(ndc_y.mul(dyn.tan_half_y)))
        .normalize()
      const origin = vec3(0, dyn.cam_height_km.add(ground), 0)
      const sun = dyn.sun_dir
      const cos_vs = dir.dot(sun)
      const rayl_ph = rayleigh_phase(cos_vs)
      const mie_ph = mie_phase_hg(U.mie_g, cos_vs)
      const L = vec3(0).toVar()
      const throughput = vec3(1).toVar()
      const prev_d = float(0).toVar()
      Loop(AS, ({ i: s }) => {
        // near-dense slice far-edge (km); integrate the [prev_d, far_d] segment with one analytic step.
        const far_d = dyn.aerial_range_km.mul(pow(float(s).add(1).div(AS), dyn.aerial_depth_power))
        const seg = far_d.sub(prev_d)
        const p = origin.add(dir.mul(prev_d.add(seg.mul(0.5))))
        const r_s = length(p)
        const up = p.div(r_s)
        const m = sample_medium(U, max(r_s.sub(ground), float(0)))
        const sun_cos_s = up.dot(sun)
        const t_sun = sun_transmittance(r_s, sun_cos_s)
        const psi_ms = sample_multiscatter(r_s, sun_cos_s)
        const phase_scatter = m.rayleigh_s.mul(rayl_ph).add(m.mie_s.mul(mie_ph))
        const s_in = U.sun_illuminance.mul(t_sun.mul(phase_scatter).add(psi_ms.mul(m.scattering)))
        const step_t = exp(m.extinction.mul(seg).negate())
        L.addAssign(throughput.mul(s_in.sub(s_in.mul(step_t)).div(m.extinction.max(float(1e-6)))))
        throughput.mulAssign(step_t)
        const mean_t = throughput.x.add(throughput.y).add(throughput.z).div(3)
        textureStore(aerial, uvec3(x.toUint(), y.toUint(), s.toUint()), vec4(L, mean_t)).toWriteOnly()
        prev_d.assign(far_d)
      })
    })().compute(AR * AR)
    k.setName('hillaireAerial')
    return k
  }

  /**
   * Sky-view LUT sample for a world view direction (background + fog fallback). up = world +Y.
   * @param {*} dir vec3 world view dir (normalized) @returns {*} vec3 in-scatter radiance
   */
  const sample_skyview = (dir) => {
    const cam_r = dyn.cam_height_km.add(ground)
    const vzc = dir.y // view zenith cosine (up = +Y)
    // azimuth cosine between the view and sun horizontal projections.
    const vh = vec2(dir.x, dir.z)
    const sh = vec2(dyn.sun_dir.x, dyn.sun_dir.z)
    const lvc = clamp(vh.normalize().dot(sh.normalize()), -1, 1)
    const intersect = ray_hits_ground(cam_r, vzc, ground)
    const uv = skyview_params_to_uv(U, intersect, vzc, lvc, cam_r)
    return texture(skyview, clamp(uv, 0, 1)).xyz
  }

  /**
   * Aerial LUT sample at a screen position + view distance → { inscatter vec3, transmittance float }.
   * @param {*} screen_uv vec2 [0,1] @param {*} dist_km float @returns {{ inscatter:*, transmittance:* }}
   */
  const sample_aerial = (screen_uv, dist_km) => {
    const w = clamp(pow(dist_km.div(dyn.aerial_range_km).max(float(0)), float(1).div(dyn.aerial_depth_power)), 0, 1)
    const s = texture3D(aerial, vec3(screen_uv.x, screen_uv.y, w))
    return { inscatter: s.xyz, transmittance: s.w }
  }

  const dispose = () => {
    transmittance.dispose()
    multiscatter.dispose()
    skyview.dispose()
    aerial.dispose()
  }

  return {
    transmittance,
    multiscatter,
    skyview,
    aerial,
    sample_transmittance,
    sample_skyview,
    sample_aerial,
    build_transmittance_kernel,
    build_multiscatter_kernel,
    build_skyview_kernel,
    build_aerial_kernel,
    dispose,
  }
}
