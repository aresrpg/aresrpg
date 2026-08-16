// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// C9 Hillaire sky — the SHARED TSL PHYSICS consumed by all four LUT kernels and their samplers:
// medium (Rayleigh/Mie/ozone) sampling, the Rayleigh + Henyey-Greenstein phase functions, ray↔sphere
// geometry, and the transmittance + sky-view LUT parameterizations (both directions). Pure node-
// returning functions (they INLINE into kernels/samplers like sky_node.js's mirror pattern) — no
// texture reads here (those live in luts.js). Faithful to Hillaire's SkyAtmosphereCommon.hlsl.
//
// A `U` argument everywhere is the ATMOSPHERE UNIFORM BAG built by hillaire_sky.js (each field a
// `uniform()` node in KM / per-KM units) so set_atmosphere_params(...) retunes every kernel live.

import { acos, clamp, cos, exp, float, max, pow, sqrt, sub, vec2 } from 'three/tsl'

const { PI } = Math
const INV_4PI = 1 / (4 * PI)

/**
 * @typedef {object} AtmoUniforms  (all TSL `uniform()` nodes; km / per-km)
 * @property {*} rayleigh_scattering vec3 @property {*} rayleigh_density_h float
 * @property {*} mie_scattering float @property {*} mie_absorption float @property {*} mie_g float
 * @property {*} mie_density_h float @property {*} ozone_absorption vec3 @property {*} ozone_center float
 * @property {*} ozone_width float @property {*} ground_radius float @property {*} top_radius float
 * @property {*} ground_albedo vec3 @property {*} sun_illuminance vec3 @property {*} exposure float
 */

/**
 * @typedef {object} Medium  the local optical properties at an altitude (all vec3 nodes except mie_s).
 * @property {*} rayleigh_s vec3 — Rayleigh scattering σs (for the Rayleigh phase weight).
 * @property {*} mie_s float — Mie scattering σs (for the HG phase weight).
 * @property {*} scattering vec3 — total scattering (Rayleigh + Mie) — the multiple-scattering feed term.
 * @property {*} extinction vec3 — total extinction (scattering + Mie absorption + ozone absorption).
 */

/**
 * Sample the atmosphere medium at altitude `h_km` above the ground (Rayleigh/Mie exponential layers +
 * the ozone tent). @param {AtmoUniforms} U @param {*} h_km float node @returns {Medium}
 */
export function sample_medium(U, h_km) {
  const rayl_density = exp(h_km.div(U.rayleigh_density_h).negate())
  const mie_density = exp(h_km.div(U.mie_density_h).negate())
  // ozone tent: max(0, 1 − |h − center| / width)
  const ozo_density = max(float(0), float(1).sub(h_km.sub(U.ozone_center).abs().div(U.ozone_width)))
  const rayleigh_s = U.rayleigh_scattering.mul(rayl_density)
  const mie_s = U.mie_scattering.mul(mie_density)
  const mie_a = U.mie_absorption.mul(mie_density)
  const ozone_a = U.ozone_absorption.mul(ozo_density)
  const scattering = rayleigh_s.add(mie_s)
  const extinction = rayleigh_s.add(mie_s).add(mie_a).add(ozone_a)
  return { rayleigh_s, mie_s, scattering, extinction }
}

/**
 * Rayleigh phase: 3/(16π)·(1+cos²θ). @param {*} cos_theta float node @returns {*} float node
 */
export function rayleigh_phase(cos_theta) {
  return float(3 / (16 * PI)).mul(cos_theta.mul(cos_theta).add(1))
}

/**
 * Henyey-Greenstein Mie phase: 1/(4π)·(1−g²)/(1+g²−2g·cosθ)^1.5.
 * @param {*} g float node @param {*} cos_theta float node @returns {*} float node
 */
export function mie_phase_hg(g, cos_theta) {
  const g2 = g.mul(g)
  const denom = max(float(1).add(g2).sub(cos_theta.mul(g).mul(2)), float(1e-4))
  return float(INV_4PI).mul(float(1).sub(g2)).div(pow(denom, 1.5))
}

/**
 * Distance from a point at radius `r` (km) along a ray whose cosine-to-zenith is `mu` to the sphere
 * of `radius` (km) — the FAR (exit) root, 0 if the ray never reaches it. Used for the top of atmosphere.
 * @param {*} r float @param {*} mu float @param {*} radius float @returns {*} float
 */
export function dist_to_sphere_outer(r, mu, radius) {
  const disc = r.mul(r).mul(mu.mul(mu).sub(1)).add(radius.mul(radius))
  return max(float(0), sqrt(max(disc, float(0))).sub(r.mul(mu)))
}

/**
 * Boolean node: does a ray from radius `r` with zenith-cosine `mu` hit the ground sphere?
 * (mu < 0 AND the discriminant is non-negative.) @param {*} r @param {*} mu @param {*} ground @returns {*} bool
 */
export function ray_hits_ground(r, mu, ground) {
  const disc = r.mul(r).mul(mu.mul(mu).sub(1)).add(ground.mul(ground))
  return mu.lessThan(0).and(disc.greaterThanEqual(0))
}

/**
 * March length along a view ray from radius `r`, zenith-cosine `mu`: to the ground if it is hit,
 * else to the top of atmosphere. @param {AtmoUniforms} U @param {*} r @param {*} mu @returns {*} float
 */
export function ray_march_length(U, r, mu) {
  const disc_g = r.mul(r).mul(mu.mul(mu).sub(1)).add(U.ground_radius.mul(U.ground_radius))
  const hits = mu.lessThan(0).and(disc_g.greaterThanEqual(0))
  const d_ground = max(
    float(0),
    r
      .mul(mu)
      .negate()
      .sub(sqrt(max(disc_g, float(0))))
  )
  const d_top = dist_to_sphere_outer(r, mu, U.top_radius)
  return hits.select(d_ground, d_top)
}

// ── Transmittance LUT parameterization (256×64) — Bruneton/Hillaire (r, mu) ↔ (u, v) ────────────────

/**
 * uv → (r, mu) for the transmittance LUT texel. @param {AtmoUniforms} U @param {*} uv vec2
 * @returns {{ r:*, mu:* }}
 */
export function uv_to_transmittance_params(U, uv) {
  const ground = U.ground_radius
  const top = U.top_radius
  const H = sqrt(max(top.mul(top).sub(ground.mul(ground)), float(0)))
  const rho = H.mul(uv.y)
  const r = sqrt(rho.mul(rho).add(ground.mul(ground)))
  const d_min = top.sub(r)
  const d_max = rho.add(H)
  const d = max(d_min.add(uv.x.mul(d_max.sub(d_min))), float(1e-4))
  const mu = clamp(H.mul(H).sub(rho.mul(rho)).sub(d.mul(d)).div(r.mul(d).mul(2)), float(-1), float(1))
  return { r, mu }
}

/**
 * (r, mu) → uv for sampling the transmittance LUT. @param {AtmoUniforms} U @param {*} r @param {*} mu
 * @returns {*} vec2
 */
export function transmittance_params_to_uv(U, r, mu) {
  const ground = U.ground_radius
  const top = U.top_radius
  const H = sqrt(max(top.mul(top).sub(ground.mul(ground)), float(0)))
  const rho = sqrt(max(r.mul(r).sub(ground.mul(ground)), float(0)))
  const disc = r.mul(r).mul(mu.mul(mu).sub(1)).add(top.mul(top))
  const d = max(float(0), sqrt(max(disc, float(0))).sub(r.mul(mu)))
  const d_min = top.sub(r)
  const d_max = rho.add(H)
  const x_mu = d.sub(d_min).div(d_max.sub(d_min))
  const x_r = rho.div(H)
  return vec2(x_mu, x_r)
}

// ── Sky-View LUT parameterization (200×100) — the NON-LINEAR horizon packing ─────────────────────────

/**
 * uv → (viewZenithCos, lightViewCos) for a sky-view texel at camera radius `r`. The v axis concentrates
 * texels at the horizon via the sqrt packing (split at the horizon line into above/below halves).
 * @param {AtmoUniforms} U @param {*} uv vec2 @param {*} r float @returns {{ view_zenith_cos:*, light_view_cos:* }}
 */
export function uv_to_skyview_params(U, uv, r) {
  const ground = U.ground_radius
  const v_horizon = sqrt(max(r.mul(r).sub(ground.mul(ground)), float(0)))
  const cos_beta = clamp(v_horizon.div(r), float(-1), float(1))
  const beta = acos(cos_beta)
  const zenith_horizon = float(PI).sub(beta)
  const below = uv.y.lessThan(0.5)
  // above horizon (uv.y in [0,0.5]): vza = ZHA·(1 − (1 − 2y)²)
  const a = float(1).sub(pow(float(1).sub(uv.y.mul(2)), 2))
  const vza_up = zenith_horizon.mul(a)
  // below horizon (uv.y in [0.5,1]): vza = ZHA + β·(2y − 1)²
  const b = pow(uv.y.mul(2).sub(1), 2)
  const vza_dn = zenith_horizon.add(beta.mul(b))
  const view_zenith_cos = cos(below.select(vza_up, vza_dn))
  // azimuth: lightViewCos = 1 − 2·uv.x²
  const light_view_cos = float(1).sub(uv.x.mul(uv.x).mul(2))
  return { view_zenith_cos, light_view_cos }
}

/**
 * (viewZenithCos, lightViewCos) → uv for sampling the sky-view LUT (the inverse of the packing above).
 * @param {AtmoUniforms} U @param {*} intersect_ground bool node @param {*} view_zenith_cos @param {*} light_view_cos
 * @param {*} r @returns {*} vec2
 */
export function skyview_params_to_uv(U, intersect_ground, view_zenith_cos, light_view_cos, r) {
  const ground = U.ground_radius
  const v_horizon = sqrt(max(r.mul(r).sub(ground.mul(ground)), float(0)))
  const cos_beta = clamp(v_horizon.div(r), float(-1), float(1))
  const beta = acos(cos_beta)
  const zenith_horizon = float(PI).sub(beta)
  const vza = acos(clamp(view_zenith_cos, float(-1), float(1)))
  // above: coord = 1 − sqrt(1 − vza/ZHA); v = coord·0.5
  const uy_up = float(1)
    .sub(sqrt(max(float(1).sub(vza.div(zenith_horizon)), float(0))))
    .mul(0.5)
  // below: coord = sqrt((vza − ZHA)/β); v = coord·0.5 + 0.5
  const uy_dn = sqrt(max(vza.sub(zenith_horizon).div(beta), float(0)))
    .mul(0.5)
    .add(0.5)
  const uv_y = intersect_ground.select(uy_dn, uy_up)
  const uv_x = sqrt(clamp(sub(1, light_view_cos).mul(0.5), float(0), float(1)))
  return vec2(uv_x, uv_y)
}
