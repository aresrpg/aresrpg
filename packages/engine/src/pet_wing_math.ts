// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// Shared by the wing fragment and ribbon vertex programs. Coordinates are normalized hinge-to-tip.
export const WING_MATH = /* wgsl */ `
struct WingStyle { clock: f32, variant: f32, primary: vec3f, secondary: vec3f, shade: vec3f }
const WING_PI: f32 = 3.14159265;
fn wing_sq(a: f32) -> f32 { return a * a; }
// The prototype deliberately reverses many smoothstep edges. WGSL leaves that undefined.
fn wing_smooth(a: f32, b: f32, x: f32) -> f32 {
  let d = select(0.000001, b - a, abs(b - a) > 0.000001);
  let t = clamp((x - a) / d, 0., 1.);
  return t * t * (3. - 2. * t);
}
fn wing_hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn wing_hash2(p: vec2f) -> vec2f {
  return fract(sin(vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)))) * 43758.5453);
}
fn wing_noise(p: vec2f) -> f32 {
  let i = floor(p); var f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(wing_hash(i), wing_hash(i + vec2f(1., 0.)), f.x),
    mix(wing_hash(i + vec2f(0., 1.)), wing_hash(i + vec2f(1., 1.)), f.x), f.y);
}
fn wing_fbm(p: vec2f) -> f32 {
  return wing_noise(p) * .55 + wing_noise(p * 2.1 + vec2f(7.3)) * .3 + wing_noise(p * 4.3 + vec2f(1.7)) * .15;
}
fn wing_voro(q: vec2f, clock: f32) -> vec2f {
  let id = floor(q); let f = fract(q); var cid = id; var first = 9.; var second = 9.;
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    let g = vec2f(f32(i), f32(j));
    let d = length(g + vec2f(.5) + .38 * sin(vec2f(clock) + 6.283 * wing_hash2(id + g)) - f);
    if (d < first) { second = first; first = d; cid = id + g; }
    else if (d < second) { second = d; }
  }}
  return vec2f(second - first, wing_hash(cid + vec2f(3.)));
}
fn wing_bend(x: f32, clock: f32) -> f32 {
  return (.04 + .09 * sin(clock * 1.7)) * x * x + .015 * sin(x * 9. - clock * 3.2) * x;
}
fn wing_stagger(k: f32, deployed: f32) -> f32 { return wing_smooth(k * .3, k * .3 + .7, deployed); }
fn wing_feather(fi: f32, deployed: f32, clock: f32) -> vec2f {
  let k = fi / 4.;
  return vec2f(mix(-.18, .3, k) + .04 * sin(clock * 1.3 + fi * 1.7), mix(.62, 1., k) * wing_stagger(k, deployed));
}
fn wing_scythe(k: f32, deployed: f32, clock: f32) -> vec3f {
  return vec3f(mix(-.42, .36, k) + .03 * sin(clock * 1.6 + k * 8.),
    mix(.38, 1., k) * wing_stagger(k, deployed), mix(.02, .22, k));
}
fn wing_blade(p: vec2f, angle: f32, span: f32, width: f32, curve: f32) -> f32 {
  if (span < .02) { return 1.; }
  let d = vec2f(cos(angle), sin(angle)); let a = dot(p, d);
  var b = dot(p, vec2f(-d.y, d.x)); let s = a / span;
  if (s < 0.) { return 1.; }
  let sc = min(s, 1.); b += curve * sc * sc * span;
  if (s > 1.) { return length(vec2f(a - span, b)); }
  return abs(b) - width * pow(sc, .35) * (1. - sc);
}
fn wing_scythes(p: vec2f, deployed: f32, off: f32, clock: f32) -> f32 {
  var d = 1.;
  for (var i = 0; i < 7; i++) {
    let k = f32(i) / 6.; let blade = wing_scythe(k, deployed, clock);
    d = min(d, wing_blade(p, blade.x + off, blade.y, mix(.06, .115, k), blade.z));
  }
  return d;
}
fn wing_tip(fi: f32, deployed: f32, family: f32, clock: f32) -> vec2f {
  let k = fi / 4.; var blade = vec3f(wing_feather(fi, deployed, clock), 0.);
  if (family == 10.) { blade = wing_scythe(k, deployed, clock); }
  else if (family == 3.) { blade = vec3f(mix(-.3, .22, k), mix(.55, 1., k) * wing_stagger(k, deployed), .12); }
  return blade.y * vec2f(cos(blade.x), sin(blade.x)) + vec2f(sin(blade.x), -cos(blade.x)) * blade.z * blade.y;
}
`
