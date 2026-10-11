// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { CustomBlending, DoubleSide, OneFactor, OneMinusSrcAlphaFactor } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { attribute, cameraPosition, time, uv, wgslFn } from 'three/tsl'

import { WING_MATH } from './pet_wing_math.ts'
import { WING_PATTERNS } from './pet_wing_patterns.ts'

const wing_position = wgslFn(/* wgsl */ `
fn pet_wing_position(uv: vec2f, center: vec3f, right: vec3f, up: vec3f, forward: vec3f,
  motion: vec4f, profile: vec4f, clock: f32, eye: vec3f, ribbon: f32) -> vec3f {
  let deployed = motion.x * motion.x * (3. - 2. * motion.x);
  let side = motion.y; let width = 2.4 * motion.z;
  let span = normalize(vec3f(mix(.25, 1., deployed), .16 + .04 * sin(clock * 1.7), -mix(1.3, .32, deployed)));
  let vertical = normalize(vec2f(-span.y, span.x));
  let along = right * span.x * side + up * span.y + forward * span.z;
  let above = right * vertical.x * side + up * vertical.y;
  let hinge = center + right * .3 * side - forward * .2;
  if (ribbon < .5) { return hinge + (along * (uv.x * 1.65) + above * (uv.y * 2. - 1.)) * width; }
  let tip = wing_tip(motion.w, deployed, profile.x, clock);
  if (tip.x < .05) { return hinge; }
  let start = hinge + (along * tip.x + above * (tip.y + wing_bend(tip.x, clock))) * width;
  let distance = uv.x * 4.8 * deployed;
  let behind = normalize(-forward - up * .06);
  let point = start + behind * distance + above * sin(distance * 2.2 - clock * 3. + motion.w) * .05 * distance;
  let view = normalize(eye - point);
  let cross_axis = cross(behind, view);
  let across = cross_axis / max(length(cross_axis), .001);
  return point + across * (uv.y * 2. - 1.) * .28;
}
${WING_MATH}`)

const wing_color = wgslFn(/* wgsl */ `
fn pet_wing_color(uv: vec2f, motion: vec4f, profile: vec4f, primary: vec3f, secondary: vec3f, shade: vec3f, clock: f32) -> vec4f {
  let deployed = motion.x * motion.x * (3. - 2. * motion.x);
  if (deployed < .01) { return vec4f(0.); }
  let p = vec2f(uv.x * 1.65, uv.y * 2. - 1.);
  let style = WingStyle(clock, profile.z, primary, secondary, shade);
  let main = wing_pattern(p, deployed, profile.x, style);
  let radius = length(p); let pulse = .5 + .5 * sin(radius * 14. - clock * 5.);
  var color = main.rgb * (.85 + .5 * pulse * pulse); var alpha = main.a;
  if (profile.w > .5) {
    let ghost = wing_pattern(p / 1.28 + vec2f(0., .015), deployed, profile.x,
      WingStyle(clock - .3, profile.z, primary, secondary, shade));
    let flame = wing_fbm(vec2f(p.x * 7. - clock * 2.5, p.y * 12. - clock * 1.2));
    let behind = 1. - clamp(main.a * 1.5, 0., 1.);
    color += (ghost.rgb * .35 + primary * ghost.a * .5) * (.35 + .9 * flame) * behind;
    alpha += ghost.a * .25 * behind;
  }
  color += secondary * exp(-radius * 14.) * .7 * deployed * wing_smooth(0., .12, p.x);
  // A sparse field of motes rides the unfolding surface and vanishes at full deployment.
  let fade = wing_smooth(0., 1., motion.x);
  let birth = sin(WING_PI * motion.x);
  let cells = p * 24. - vec2f(motion.x * 3., motion.x * 1.5);
  let cell = floor(cells); let seed = wing_hash2(cell);
  let point = fract(cells) - (.2 + seed * .6);
  let spark = exp(-dot(point, point) * 220.) * step(.72, seed.x)
    * wing_smooth(.015, .15, main.a) * birth;
  color = color * fade + mix(primary, secondary, seed.y) * spark * 2.5;
  alpha = alpha * fade + spark * .5;
  return vec4f(max(color, vec3f(0.)), clamp(alpha, 0., .95));
}
${WING_MATH}
${WING_PATTERNS}`)

const trail_color = wgslFn(/* wgsl */ `
fn pet_trail_color(uv: vec2f, motion: vec4f, profile: vec4f, primary: vec3f, secondary: vec3f, shade: vec3f, clock: f32) -> vec4f {
  let deployed = motion.x * motion.x * (3. - 2. * motion.x);
  if (deployed < .01) { return vec4f(0.); }
  let fi = motion.w; let distance = abs(uv.y * 2. - 1.) * .28 / 1.6;
  let u = uv.x; let along = u * 4.8 * deployed; let fade = pow(max(1. - u, 0.), 1.6);
  var color = vec3f(0.); var alpha = 0.;
  switch i32(profile.y) {
    case 0: {
      let intensity = (wing_smooth(.02, .008, distance) + exp(-distance * 40.) * .3)
        * step(.4, fract(along * 2.2 - clock * 2.6 + fi * .37)) * fade;
      color = primary * intensity; alpha = min(intensity, 1.) * .5;
    }
    case 1: {
      let noise = wing_noise(vec2f(along * 2.5 - clock * 2., fi * 5.)); let width = .05 + .09 * noise * u;
      let mask = (1. - wing_smooth(width * .5, width, distance)) * fade;
      color = shade * mask * profile.z + primary * mask * .4 * (1. - u); alpha = mask * profile.z * .7;
    }
    case 2: {
      let width = .05 * (1. - u) + .006; let mask = 1. - wing_smooth(width * .6, width, distance);
      color = (primary * mask + vec3f(.8) * (1. - wing_smooth(width * .15, width * .35, distance))) * fade;
      alpha = mask * fade * .35;
    }
    case 3: {
      let noise = wing_fbm(vec2f(along * 2.5 - clock * 2.4, fi * 4.)); let width = (.02 + .12 * noise) * (1. - u * .6);
      let mask = (1. - wing_smooth(width * .4, width, distance)) * fade;
      color = mix(secondary, primary, wing_smooth(width * .2, width * .6, distance)) * mask; alpha = mask * .3;
    }
    default: {
      let width = .05 * (1. - u * .5);
      let mask = exp(-wing_sq(distance / width)) * fade * (.5 + .5 * wing_noise(vec2f(along * 6. - clock * 3., fi)));
      color = mix(primary, secondary, u) * mask; alpha = mask * .25;
    }
  }
  return vec4f(color * deployed, clamp(alpha * deployed, 0., .95));
}
${WING_MATH}`)

export const create_pet_wing_material = (ribbon: boolean) => {
  const motion = attribute<'vec4'>('wing_motion', 'vec4')
  const profile = attribute<'vec4'>('wing_profile', 'vec4')
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
  })
  material.forceSinglePass = true
  const clock = time.mul(1.7)
  material.positionNode = wing_position(
    uv(),
    attribute<'vec3'>('wing_center', 'vec3'),
    attribute<'vec3'>('wing_right', 'vec3'),
    attribute<'vec3'>('wing_up', 'vec3'),
    attribute<'vec3'>('wing_forward', 'vec3'),
    motion,
    profile,
    clock,
    cameraPosition,
    Number(ribbon)
  )
  material.fragmentNode = (ribbon ? trail_color : wing_color)(
    uv(),
    motion,
    profile,
    attribute<'vec3'>('wing_primary', 'vec3'),
    attribute<'vec3'>('wing_secondary', 'vec3'),
    attribute<'vec3'>('wing_shade', 'vec3'),
    clock
  )
  return material
}
