// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  BackSide,
  Color,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  type PerspectiveCamera,
  type Scene,
} from 'three'

import { HACK_LATTICE, HACK_PALETTE } from './hack_palette.ts'

export type HackPresentation = Readonly<{
  tick: (delta_seconds: number, camera: PerspectiveCamera) => void
  set_ground_y: (y: number) => void
  dispose: () => void
}>

const color_uniforms = Object.fromEntries(
  Object.entries(HACK_PALETTE).map(([name, value]) => [name, { value: new Color(value) }])
)

const sky_vertex = `
varying vec3 v_direction;
void main() {
  v_direction = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// Direct GLSL extraction of the legacy TSL hack sky: fixed striped sun, analytic
// glow, static faceted ridge, violet drift, and reduced-motion clock gate.
const sky_fragment = `
uniform float u_time;
uniform float u_motion;
uniform vec3 bg_zenith;
uniform vec3 bg_mid;
uniform vec3 bg_drift;
uniform vec3 horizon_glow;
uniform vec3 ground;
uniform vec3 sun_top;
uniform vec3 sun_bottom;
uniform vec3 ridge_fill;
uniform vec3 ridge_rim;
varying vec3 v_direction;

float phase(float hz) { return u_time * hz * 6.28318530718 * u_motion; }

void main() {
  vec3 view = normalize(v_direction);
  float up = view.y;
  vec3 mid_live = mix(bg_mid, bg_drift, sin(phase(0.011)) * 0.5 + 0.5);
  vec3 sky = mix(mix(ground, mid_live, smoothstep(-0.3, 0.0, up)), bg_zenith, smoothstep(0.0, 0.55, up));
  float bands = sin(up * 16.0 - phase(0.04)) * 0.085 * smoothstep(0.02, 0.5, up);
  sky += ridge_rim * max(bands, 0.0);

  float horizon = 1.0 - smoothstep(0.0, 0.05, abs(up));
  float elevation = radians(6.0);
  float radius = radians(11.0);
  vec3 sun_dir = vec3(0.0, sin(elevation), cos(elevation));
  float cos_sun = dot(view, sun_dir);
  float disc = smoothstep(cos(radius), cos(radius * 0.985), cos_sun);
  float disc_t = clamp(up / (sin(elevation) + sin(radius)), 0.0, 1.0);
  vec3 sun_rgb = mix(sun_bottom, sun_top, pow(disc_t, 1.7)) * 0.82;
  float stripes = smoothstep(0.34, 0.46, fract(disc_t * 7.0 - phase(0.008)));
  float sun_mask = mix(1.0, stripes, smoothstep(0.55, 0.1, disc_t));
  float breath = sin(phase(0.1)) * 0.12 + 1.0;
  float glow_core = pow(clamp(cos_sun, 0.0, 1.0), 210.0) * 0.5;
  float glow_wide = pow(clamp(cos_sun, 0.0, 1.0), 22.0) * 0.22;
  vec3 glow = mix(sun_bottom, sun_top, 0.35) * glow_core + sun_bottom * glow_wide;

  float ridge_raw = sin(view.x * 11.7 + view.z * 4.3) * 0.5
    + sin(view.x * 23.3 - view.z * 9.7) * 0.3
    + sin(view.z * 41.9 + view.x * 6.1) * 0.2;
  float faceted = floor((ridge_raw * 0.5 + 0.5) * 26.0) / 26.0;
  float valley = mix(0.34, 1.0, 1.0 - smoothstep(0.86, 1.0, view.z));
  float ridge_h = pow(faceted, 2.1) * 0.155 * valley + 0.012;
  float aa = max(fwidth(up), 0.00001);
  float ridge_mask = (1.0 - smoothstep(ridge_h - aa, ridge_h + aa, up)) * smoothstep(0.0, aa + 0.0001, up);
  float rim = smoothstep(ridge_h - 0.0035, ridge_h, up)
    * (1.0 - smoothstep(ridge_h, ridge_h + 0.0035, up)) * smoothstep(0.0, 0.004, up);

  vec3 before_ridge = mix(sky, sun_rgb, disc * sun_mask) + glow * breath * (1.0 - disc);
  vec3 result = mix(before_ridge, ridge_fill, ridge_mask) + ridge_rim * rim * 0.42;
  result += horizon_glow * horizon * 1.4 * breath;
  gl_FragColor = vec4(result, 1.0);
}
`

const grid_vertex = `
varying vec2 v_local;
void main() {
  v_local = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const grid_fragment = `
uniform float u_time;
uniform float u_motion;
uniform vec3 bg_mid;
uniform vec3 bg_drift;
uniform vec3 ground;
uniform vec3 grid_minor;
uniform vec3 grid_major;
uniform vec3 ridge_rim;
uniform vec3 sun_top;
varying vec2 v_local;

float phase(float hz) { return u_time * hz * 6.28318530718 * u_motion; }
float lattice(vec2 p, vec2 px, float spacing, float half_width) {
  vec2 cell = p / spacing;
  vec2 distance_to_line = (0.5 - abs(fract(cell) - 0.5)) * spacing;
  vec2 aa = max(px, vec2(0.00001));
  vec2 coverage = (1.0 - smoothstep(vec2(half_width), vec2(half_width) + aa, distance_to_line))
    * clamp(vec2(2.0 * half_width) / aa, 0.0, 1.0);
  return max(coverage.x, coverage.y);
}

void main() {
  vec2 p = v_local;
  vec2 px = fwidth(p);
  float distance_from_camera = length(p);
  float fade = 1.0 - smoothstep(140.0, 400.0, distance_from_camera);
  vec3 mid_live = mix(bg_mid, bg_drift, sin(phase(0.011)) * 0.5 + 0.5);
  vec3 base = mix(ground, mid_live, smoothstep(400.0, 2600.0, distance_from_camera));
  float shimmer = sin(p.y * 0.05 - u_time * 1.1 * u_motion) * 0.12 + 0.88;
  float breath = sin(phase(0.25)) * 0.12 + 1.0;
  float pulse = sin(distance_from_camera * 6.28318530718 / 110.0 - phase(0.13));
  float pulse_gain = smoothstep(0.55, 1.0, pulse) * 0.45 + 1.0;
  float cycle = sin(phase(0.0297)) * 0.5 + 0.5;
  vec3 minor_rgb = mix(grid_minor, ridge_rim, cycle * 0.35);
  vec3 major_rgb = mix(grid_major, sun_top, (1.0 - cycle) * 0.22);
  vec3 minor = minor_rgb * lattice(p, px, ${HACK_LATTICE.minor_m.toFixed(1)}, 0.02) * 0.15 * breath * fade;
  vec3 major = major_rgb * lattice(p, px, ${HACK_LATTICE.major_m.toFixed(1)}, 0.05) * 1.21 * shimmer * breath * pulse_gain * fade;
  gl_FragColor = vec4(base + minor + major, 1.0);
}
`

export const create_hack_presentation = (scene: Scene): HackPresentation => {
  const reduced_motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
  const shared_uniforms = { ...color_uniforms, u_time: { value: 0 }, u_motion: { value: reduced_motion ? 0 : 1 } }
  const sky_material = new ShaderMaterial({
    uniforms: shared_uniforms,
    vertexShader: sky_vertex,
    fragmentShader: sky_fragment,
    side: BackSide,
    depthWrite: false,
  })
  const sky_geometry = new SphereGeometry(1500, 24, 12)
  const sky = new Mesh(sky_geometry, sky_material)
  sky.renderOrder = -2

  const grid_material = new ShaderMaterial({
    uniforms: shared_uniforms,
    vertexShader: grid_vertex,
    fragmentShader: grid_fragment,
  })
  const grid_geometry = new PlaneGeometry(32_000, 32_000)
  grid_geometry.rotateX(-Math.PI / 2)
  const grid = new Mesh(grid_geometry, grid_material)
  grid.frustumCulled = false
  grid.renderOrder = -1
  scene.add(sky, grid)

  return Object.freeze({
    tick: (delta_seconds: number, camera: PerspectiveCamera) => {
      shared_uniforms.u_time.value += delta_seconds
      sky.position.copy(camera.position)
      grid.position.x = Math.round(camera.position.x / HACK_LATTICE.major_m) * HACK_LATTICE.major_m
      grid.position.z = Math.round(camera.position.z / HACK_LATTICE.major_m) * HACK_LATTICE.major_m
    },
    set_ground_y: (y: number) => {
      grid.position.y = y
    },
    dispose: () => {
      scene.remove(sky, grid)
      sky_geometry.dispose()
      sky_material.dispose()
      grid_geometry.dispose()
      grid_material.dispose()
    },
  })
}
