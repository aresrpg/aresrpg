// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The night sky, shared by the analytic and Hillaire skies so the tiers cannot drift: a boundary-free
// moon glow and halo (a windowed corona reads as a lamp), a blue-grey base, hashed-cell stars in four
// tiers, a seed-oriented milky way with dust lanes, optional nebula clouds and two drifting planets.
// The world seed orients the galaxy and planet orbits. Everything passes a night gate that is exactly 0
// in daylight. Only the sky background reads this node; fog and ambient light never see it.

import { Vector3 } from 'three'
import type { Node } from 'three/webgpu'
import {
  clamp,
  exp,
  float,
  fract,
  floor,
  hash,
  length,
  mix,
  mx_fractal_noise_float,
  pow,
  smoothstep,
  sin,
  time,
  uniform,
  vec3,
} from 'three/tsl'

import { hash01 } from '../textures/noise.ts'

import {
  SKY_NIGHT,
  MOON_DISC_COS,
  MOON_DISC_INNER_COS,
  MOON_DISC_RGB,
  disc_space_uv,
  type Rgb,
  type SkyPalette,
} from './shared.ts'

type HorizonFade = Readonly<{ start_deg: number; end_deg: number }>
type NebulaRegion = Readonly<{ rgb: Rgb; k: number; gain: number }>
type NightSkyCfg = Readonly<{
  base_palette: SkyPalette | null
  star_thresh_shift: number
  star_bright_mul: number
  mw_intensity: number
  mw_rgb: Rgb
  mw_width: number
  planet_scale: number
  planet_count: number
  ringed_planet: number
  moon_glow_mul: number
  star_cluster: number
  star_red_giant: number
  arcane_tint: Readonly<{ rgb: Rgb; amount: number }> | null
  horizon_fade: HorizonFade | null
  nebula: Readonly<{
    intensity: number
    along_band: number
    orange_core: number
    orange_core_k: number
    blue: Rgb
    purple: Rgb
    orange: Rgb
    regions?: readonly NebulaRegion[]
  }>
}>

type Orbit = Readonly<{ a: Rgb; b: Rgb; phase: number; drift: number }>
type NightSkyParams = Readonly<{
  galaxy_n: Rgb
  galaxy_a: Rgb
  galaxy_b: Rgb
  planets: readonly Orbit[]
  density_shift: number
  lattice_offset: number
  regions: readonly Readonly<{ dir: Rgb }>[]
}>

// Moon glow: an inverse-power dome illumination plus a rational-spike and pow-tail halo, with no window.
const MOON_SKY_GLOW = 0.1
const MOON_SKY_GLOW_K = 40
const MOON_SKY_GLOW_P = 1.4
const MOON_SKY_GLOW_RGB: Rgb = [0.58, 0.7, 1.0]
/** The glow grows up to (1 + lift) as the view drops to the horizon. */
const MOON_HORIZON_LIFT = 0.5
const MOON_HALO_VIS = 0.0016
const MOON_HALO_SPIKE_GAIN = 0.12
const MOON_HALO_POW = 260
const MOON_HALO_TAIL_GAIN = 0.22

// The night gate starts about 2 degrees below the horizon and is full by about 8 degrees below.
const NIGHT_GATE_HI = -0.03
const NIGHT_GATE_LO = -0.14

/** Star tiers: lattice frequency in cells per radian, existence threshold, brightness and radius in cell
 *  units. Tier 4 is fine dust that mostly exists inside the milky-way band. Radii stay at least 2 px at
 *  800 px so stars survive the night exposure. band_boost lowers the threshold inside the band. */
const STAR_TIERS = [
  { freq: 14, thresh: 0.98, bright: 1.7, radius: 0.13, twinkle: false, band_boost: 0.03, band_bright: 0 },
  { freq: 26, thresh: 0.93, bright: 1.5, radius: 0.12, twinkle: false, band_boost: 0.08, band_bright: 0.2 },
  { freq: 44, thresh: 0.82, bright: 1.2, radius: 0.13, twinkle: true, band_boost: 0.08, band_bright: 0.2 },
  { freq: 90, thresh: 0.986, bright: 0.6, radius: 0.3, twinkle: false, band_boost: 0.12, band_bright: 0 },
]
const STAR_COOL_RGB: Rgb = [0.72, 0.82, 1.0]
const STAR_WARM_RGB: Rgb = [1.0, 0.86, 0.7]
/** Only the extreme hash tail reaches the red-giant colour. */
const STAR_RED_RGB: Rgb = [1.0, 0.55, 0.42]
/** Stars fade to this fraction inside the full moon glow. */
const STAR_MOON_SUPPRESS = 0.85
/** Narrow horizon cutoff on view elevation; planets and configs without `horizon_fade` use it. */
const STAR_HORIZON_FADE = [0.02, 0.12]
/** Under the wide `horizon_fade` ramp, stars dim to this floor instead of vanishing. */
const STAR_HORIZON_FLOOR = 0.5

const MW_DUST_STRENGTH = 0.65
const MW_MOON_HUMILITY = 0.6 // ×(1 − this·moonglow): humble near the moon, full on the far side

const PLANET_TINTS: readonly Readonly<{ rgb: Rgb; intensity: number }>[] = [
  { rgb: [1.0, 0.82, 0.62], intensity: 1.7 }, // the warm one
  { rgb: [0.85, 0.92, 1.0], intensity: 1.3 }, // the pale one
]
const PLANET_COS_OUTER = Math.cos(0.005)
const PLANET_COS_INNER = Math.cos(0.002)
/** A ring is an annulus in the band plane, drawn in the planet's disc-space uv. */
const RING_INNER = 1.7 // ×disc radius
const RING_OUTER = 2.9
const RING_SQUASH = 0.32 // v-axis squash → the ring reads as a tilted ellipse
const RING_RGB: Rgb = [0.9, 0.78, 0.55]
const RING_INTENSITY = 0.9

// Nebula: low-frequency fBm over the galactic frame, tinted blue to purple to orange and concentrated
// toward the band. It is chroma-dominant because saturated darks survive tone mapping where luminance greys.

/** The shipped night sky: a near-black violet dome, three nebula regions of distinct hue, clustered stars
 *  with red giants, a faint arcane wash and two planets. */
const NIGHT_SKY_LIVE: NightSkyCfg = {
  base_palette: { zenith: [0.004, 0.005, 0.017], horizon: [0.011, 0.011, 0.03], nadir: [0.004, 0.005, 0.015] },
  star_thresh_shift: -0.06,
  star_bright_mul: 1.0,
  star_cluster: 0.35,
  star_red_giant: 0.06,
  // A lower milky-way intensity and a stronger nebula keep the Hillaire night base from greying the band.
  mw_intensity: 0.1,
  mw_rgb: [0.82, 0.8, 0.95],
  mw_width: 0.12,
  planet_scale: 3.2,
  planet_count: 2,
  // Off until the planet body renders inside the ring; the annulus alone reads as a white torus.
  ringed_planet: -1,
  moon_glow_mul: 0.3,
  arcane_tint: { rgb: [0.04, 0.05, 0.08], amount: 0.012 },
  // Band and nebula sink into the terrain line over the last 14 degrees instead of cutting against it.
  horizon_fade: { start_deg: 14, end_deg: 0 },
  nebula: {
    intensity: 0.9,
    along_band: 0.35,
    orange_core: 1.1,
    orange_core_k: 3.5,
    blue: [0.06, 0.14, 0.32], // cold blue-violet
    purple: [0.26, 0.07, 0.34], // violet-magenta
    orange: [0.62, 0.24, 0.06], // ember core
    regions: [
      { rgb: [0.08, 0.06, 0.3], k: 2.0, gain: 0.8 }, // cold blue-violet field
      { rgb: [0.55, 0.14, 0.16], k: 2.8, gain: 0.9 }, // warm amber-magenta core
      { rgb: [0.04, 0.22, 0.22], k: 3.2, gain: 0.7 }, // teal wisp
    ],
  },
}

const cross3 = (a: Rgb, b: Rgb): Rgb => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const norm3 = (a: Rgb): Rgb => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1e-9
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Per-world night-sky parameters, derived deterministically from the world seed. */
function derive_night_sky_params(seed: string | number): NightSkyParams {
  const codes = typeof seed === 'number' ? [seed | 0] : [...String(seed)].map((c) => c.codePointAt(0) ?? 0)
  const h = (i: number): number => hash01(...codes, i)
  // galactic pole: uniform azimuth; elevation kept in |y| ≤ 0.72 so the band never degenerates into a
  // horizon ring (half-hidden) and cross(n, up) below never degenerates.
  const gy = (h(1) * 2 - 1) * 0.72
  const gaz = h(2) * Math.PI * 2
  const gr = Math.sqrt(Math.max(0, 1 - gy * gy))
  const galaxy_n: Rgb = [gr * Math.cos(gaz), gy, gr * Math.sin(gaz)]
  const galaxy_a = norm3(cross3(galaxy_n, [0, 1, 0]))
  const galaxy_b = cross3(galaxy_n, galaxy_a)
  // planets: each orbits a great circle tilted off the galactic plane by its own hash.
  const planets = [0, 1].map((i) => {
    const tilt = 0.25 + 0.5 * h(10 + i)
    const n_i = norm3([
      galaxy_n[0] + tilt * galaxy_a[0],
      galaxy_n[1] + tilt * galaxy_a[1],
      galaxy_n[2] + tilt * galaxy_a[2],
    ])
    const up: Rgb = Math.abs(n_i[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
    const a = norm3(cross3(n_i, up))
    const b = cross3(n_i, a)
    return { a, b, phase: h(12 + i) * Math.PI * 2, drift: 0.04 + 0.04 * h(14 + i) }
  })
  // Three nebula directions spread along the band, each lifted off the plane by its own hash.
  const regions = [0, 1, 2].map((i) => {
    const ang = (i / 3) * Math.PI * 2 + h(20 + i) * 1.2
    const lift = (h(23 + i) - 0.5) * 0.7
    const d = norm3([
      galaxy_a[0] * Math.cos(ang) + galaxy_b[0] * Math.sin(ang) + galaxy_n[0] * lift,
      galaxy_a[1] * Math.cos(ang) + galaxy_b[1] * Math.sin(ang) + galaxy_n[1] * lift,
      galaxy_a[2] * Math.cos(ang) + galaxy_b[2] * Math.sin(ang) + galaxy_n[2] * lift,
    ])
    return { dir: d }
  })
  return {
    galaxy_n,
    galaxy_a,
    galaxy_b,
    planets,
    regions,
    density_shift: (h(7) - 0.5) * 0.04,
    lattice_offset: Math.floor(h(8) * 512),
  }
}

/** Planet world direction at a sun azimuth; the tick below uses it. */
function planet_dir_js(p: Orbit, sun_az: number): Rgb {
  const th = p.phase + sun_az * p.drift
  const c = Math.cos(th)
  const s = Math.sin(th)
  return norm3([p.a[0] * c + p.b[0] * s, p.a[1] * c + p.b[1] * s, p.a[2] * c + p.b[2] * s])
}

/** The night-sky node added to a sky background, plus its per-frame planet-drift tick. */
export function create_night_sky_node({
  seed = 'aresrpg',
  sun_dir,
  view_dir,
  with_base = false,
  with_milky_way = false,
  cfg = NIGHT_SKY_LIVE,
}: Readonly<{
  seed?: string | number
  sun_dir: Node<'vec3'>
  view_dir: Node<'vec3'>
  with_base?: boolean
  with_milky_way?: boolean
  cfg?: NightSkyCfg
}>) {
  const P = derive_night_sky_params(seed)
  const c3 = (c: Rgb): Node<'vec3'> => vec3(c[0], c[1], c[2])

  // NOTE: smoothstep edges must be ASCENDING (edge0>edge1 is UB in WGSL) — invert via oneMinus.
  const night_f = float(1).sub(smoothstep(float(NIGHT_GATE_LO), float(NIGHT_GATE_HI), sun_dir.y))
  const moon_dir = sun_dir.mul(-1)
  const moon_up = clamp(moon_dir.y.add(0.02).div(0.14), 0, 1)
  const cos_vm = view_dir.dot(moon_dir)
  const view_up = clamp(view_dir.y, 0, 1)
  // The moon body occludes stars, planets and the milky way, which also bounds the worst-case luminance.
  const moon_occ = float(1).sub(smoothstep(float(MOON_DISC_COS), float(MOON_DISC_INNER_COS), cos_vm).mul(moon_up))

  const glow_shape = float(1).div(
    pow(float(1).add(float(MOON_SKY_GLOW_K).mul(float(1).sub(cos_vm))), float(MOON_SKY_GLOW_P))
  )
  const glow_norm = glow_shape.mul(moon_up)
  const horizon_lift = float(1).add(float(MOON_HORIZON_LIFT).mul(float(1).sub(view_up)))
  const sky_glow = c3(MOON_SKY_GLOW_RGB).mul(glow_norm.mul(MOON_SKY_GLOW * (cfg.moon_glow_mul ?? 1)).mul(horizon_lift))
  const vm = clamp(cos_vm, 0, 1)
  const vm4 = vm.mul(vm).mul(vm).mul(vm)
  const halo_spike = float(MOON_HALO_VIS)
    .div(vm4.mul(-(1 - MOON_HALO_VIS)).add(1))
    .sub(float(MOON_HALO_VIS))
  const halo = c3(MOON_DISC_RGB).mul(
    halo_spike
      .mul(MOON_HALO_SPIKE_GAIN)
      .add(pow(vm, float(MOON_HALO_POW)).mul(MOON_HALO_TAIL_GAIN))
      .mul(moon_up)
  )

  // Horizon extinction sinks night content into the terrain silhouette. Degrees convert to the sine of
  // view_dir.y once in JS, so the shader needs no asin.
  const hf = cfg.horizon_fade
    ? smoothstep(
        float(Math.sin((cfg.horizon_fade.end_deg * Math.PI) / 180)),
        float(Math.sin((cfg.horizon_fade.start_deg * Math.PI) / 180)),
        view_dir.y
      )
    : null
  // Planets and configs without `horizon_fade` keep the narrow cutoff.
  const old_horizon_cut = smoothstep(float(STAR_HORIZON_FADE[0]), float(STAR_HORIZON_FADE[1]), view_dir.y)
  const ext_band = hf ?? old_horizon_cut // milky way + nebula: fade all the way to 0 at the horizon
  const ext_star = hf ? mix(float(STAR_HORIZON_FLOOR), float(1), hf) : old_horizon_cut // stars: floor at 50%

  const base_pal = cfg.base_palette ?? SKY_NIGHT
  let base: Node<'vec3'> = with_base
    ? mix(
        mix(c3(base_pal.nadir), c3(base_pal.horizon), smoothstep(-0.35, 0.0, view_dir.y)),
        c3(base_pal.zenith),
        smoothstep(0.0, 0.55, view_dir.y)
      )
    : vec3(0, 0, 0)
  if (with_base && cfg.arcane_tint) base = base.add(c3(cfg.arcane_tint.rgb).mul(cfg.arcane_tint.amount))

  // The band factor comes before the stars so they can concentrate inside it; it is 0 without the band.
  const q = with_milky_way
    ? vec3(view_dir.dot(c3(P.galaxy_a)), view_dir.dot(c3(P.galaxy_b)), view_dir.dot(c3(P.galaxy_n)))
    : null
  const band_coordinate = q ? q.z.div(cfg.mw_width) : float(0)
  const band = q ? exp(band_coordinate.mul(band_coordinate).negate()) : float(0)

  const star_fade = float(1).sub(glow_norm.mul(STAR_MOON_SUPPRESS)).mul(ext_star)
  // One low-frequency field groups stars into clusters and voids.
  const cluster_gate =
    cfg.star_cluster > 0
      ? mix(
          float(1),
          smoothstep(0.34, 0.76, mx_fractal_noise_float(view_dir.mul(1.5), 2, float(2), float(0.5)).mul(0.5).add(0.5)),
          float(cfg.star_cluster)
        )
      : null
  let stars: Node<'vec3'> = vec3(0, 0, 0)
  for (const tier of STAR_TIERS) {
    const p = view_dir.mul(tier.freq)
    const off = 200 + P.lattice_offset // per-world lattice decorrelation
    const cell = floor(p).add(vec3(off, off, off))
    const f = fract(p).sub(0.5)
    // One per-cell seed feeds four decorrelated PCG hashes.
    const s = cell.dot(vec3(127.1, 311.7, 74.7))
    const h_exist = hash(s)
    const h_ox = hash(s.add(19.19))
    const h_oy = hash(s.add(47.47))
    const h_oz = hash(s.add(73.73))
    const h_tint = hash(s.add(101.7))
    const o = vec3(h_ox, h_oy, h_oz).sub(0.5).mul(0.7)
    // The radius shrinks with the offset so a star never crosses its cell border.
    const r = float(tier.radius).mul(float(1).sub(length(o).mul(0.8)))
    const d = length(f.sub(o))
    const core = clamp(float(1).sub(d.div(r)), 0, 1)
    const t0 = tier.thresh + P.density_shift + cfg.star_thresh_shift
    const exists = smoothstep(float(t0), float(t0 + 0.004), h_exist.add(band.mul(tier.band_boost)))
    const temp2 = h_tint.mul(2)
    let tint: Node<'vec3'> = mix(
      mix(c3(STAR_COOL_RGB), vec3(1, 1, 1), clamp(temp2, 0, 1)),
      c3(STAR_WARM_RGB),
      clamp(temp2.sub(1), 0, 1)
    )
    if (cfg.star_red_giant > 0) {
      const rg = cfg.star_red_giant
      tint = mix(tint, c3(STAR_RED_RGB), smoothstep(float(1 - rg), float(1 - rg * 0.4), h_tint))
    }
    const twinkle = tier.twinkle
      ? float(0.72).add(float(0.28).mul(sin(time.mul(h_ox.mul(2.5).add(1.5)).add(h_oy.mul(6.283)))))
      : float(1)
    const band_bright = float(1).add(band.mul(tier.band_bright))
    const bright = tier.bright * cfg.star_bright_mul
    let contrib: Node<'float'> = core.mul(core).mul(exists).mul(bright).mul(twinkle).mul(band_bright)
    if (cluster_gate) contrib = contrib.mul(cluster_gate)
    stars = stars.add(tint.mul(contrib))
  }
  stars = stars.mul(star_fade).mul(moon_occ)

  // Milky-way glow: the band times wispy fBm minus dust lanes.
  let milky_way: Node<'vec3'> = vec3(0, 0, 0)
  if (q) {
    // Low frequency along the band and high across it stretch the wisps into streaks.
    const qa = vec3(q.x.mul(2.2), q.y.mul(2.2), q.z.mul(6.0))
    const wisp = mx_fractal_noise_float(qa, 3, float(2.2), float(0.55)).mul(0.5).add(0.5)
    const dust = smoothstep(
      float(0.35),
      float(0.65),
      mx_fractal_noise_float(qa.mul(0.55).add(31.7), 2, float(2.0), float(0.5)).mul(0.5).add(0.5)
    )
    const lane = exp(
      band_coordinate
        .mul(band_coordinate)
        .div(0.55 * 0.55)
        .negate()
    )
    milky_way = c3(cfg.mw_rgb)
      .mul(band.mul(wisp.mul(0.6).add(0.4)).mul(float(1).sub(dust.mul(MW_DUST_STRENGTH).mul(lane))))
      .mul(cfg.mw_intensity)
      .mul(float(1).sub(glow_norm.mul(MW_MOON_HUMILITY)))
      .mul(ext_band)
      .mul(moon_occ)
  }

  // Nebula density and hue come from two decorrelated fBm channels in the galactic frame; a fixed in-band
  // core adds a warm pocket. It shares the milky way's moon, horizon and occlusion fades.
  let nebula: Node<'vec3'> | null = null
  if (q && cfg.nebula.intensity > 0) {
    const nb = cfg.nebula
    const nf = vec3(q.x.mul(1.3), q.y.mul(1.3), q.z.mul(2.6))
    const dens = mx_fractal_noise_float(nf, 3, float(2.0), float(0.55)).mul(0.5).add(0.5)
    const hue = mx_fractal_noise_float(nf.mul(0.6).add(17.3), 2, float(2.0), float(0.5)).mul(0.5).add(0.5)
    const band_conc = mix(float(1), band, float(nb.along_band)) // 0 = whole-dome haze, 1 = hugs the band
    const core = exp(
      float(1)
        .sub(view_dir.dot(c3(P.galaxy_a)))
        .mul(-nb.orange_core_k)
    ).mul(nb.orange_core)
    let tint: Node<'vec3'> = mix(
      mix(c3(nb.blue), c3(nb.purple), clamp(hue.mul(1.6), 0, 1)),
      c3(nb.orange),
      clamp(core, 0, 1)
    )
    // Seed-placed regions blend distinct hues over the shared density with directional falloffs only.
    const regions = nb.regions ?? []
    for (let i = 0; i < regions.length && i < P.regions.length; i += 1) {
      const w = exp(
        float(1)
          .sub(view_dir.dot(c3(P.regions[i].dir)))
          .mul(-regions[i].k)
      ).mul(regions[i].gain)
      tint = mix(tint, c3(regions[i].rgb), clamp(w, 0, 1))
    }
    nebula = tint
      .mul(dens.mul(dens))
      .mul(band_conc)
      .mul(nb.intensity)
      .mul(float(1).sub(glow_norm.mul(MW_MOON_HUMILITY)))
      .mul(ext_band)
      .mul(moon_occ)
  }

  // Planets are CPU-ticked, non-twinkling discs; a ringed planet gets a tilted annulus.
  // Scale 1 skips an acos(cos) round trip that could drift the constant.
  const one = cfg.planet_scale === 1
  const p_outer = one ? PLANET_COS_OUTER : Math.cos(Math.acos(PLANET_COS_OUTER) * cfg.planet_scale)
  const p_inner = one ? PLANET_COS_INNER : Math.cos(Math.acos(PLANET_COS_INNER) * cfg.planet_scale)
  const p_ang = Math.acos(p_outer) // planet disc angular radius (rad) — the ring uv normalizer
  const u_planets = P.planets.map((p) => uniform(new Vector3().fromArray(planet_dir_js(p, 0))))
  let planets: Node<'vec3'> = vec3(0, 0, 0)
  const n_planets = Math.max(0, Math.min(cfg.planet_count, u_planets.length))
  for (let i = 0; i < n_planets; i += 1) {
    const disc = smoothstep(float(p_outer), float(p_inner), view_dir.dot(u_planets[i]))
    planets = planets.add(c3(PLANET_TINTS[i].rgb).mul(disc.mul(PLANET_TINTS[i].intensity)))
    if (i === cfg.ringed_planet) {
      const ruv = disc_space_uv(view_dir, u_planets[i]).div(p_ang)
      const ry = ruv.y.div(RING_SQUASH)
      const e = ruv.x.mul(ruv.x).add(ry.mul(ry)).sqrt() // elliptical disc-space radius (edge-on ring)
      const ring = smoothstep(float(RING_INNER), float(RING_INNER + 0.2), e).mul(
        float(1).sub(smoothstep(float(RING_OUTER - 0.2), float(RING_OUTER), e))
      )
      planets = planets.add(c3(RING_RGB).mul(ring.mul(RING_INTENSITY)))
    }
  }
  planets = planets
    .mul(float(1).sub(glow_norm.mul(0.4)))
    .mul(old_horizon_cut)
    .mul(moon_occ)

  let sky_add: Node<'vec3'> = base.add(sky_glow).add(halo).add(stars).add(milky_way)
  if (nebula) sky_add = sky_add.add(nebula)
  const node = sky_add.add(planets).mul(night_f)

  const tick = (sd: Readonly<{ x: number; y: number; z: number }>): void => {
    const az = Math.atan2(sd.x, sd.z)
    for (let i = 0; i < u_planets.length; i += 1) u_planets[i].value.fromArray(planet_dir_js(P.planets[i], az))
  }

  return { node, tick, params: P }
}
