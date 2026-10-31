// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// Port of the owner-approved prototype. Each family retains its silhouette, moving pattern and palette.
export const WING_PATTERNS = /* wgsl */ `
fn wing_shadow(p: vec2f, deployed: f32, style: WingStyle) -> vec4f {
  let d = wing_scythes(p, deployed, 0., style.clock) + (wing_noise(p * 42.) - .5) * .014;
  let dg = wing_scythes(p / 1.22 + vec2f(0., .012 * sin(style.clock * 1.3)), deployed, .05, style.clock);
  let inside = wing_smooth(.004, -.004, d); let back = wing_smooth(.01, -.01, dg) * (1. - inside);
  let r = length(p);
  let body = inside * (.55 + .45 * wing_smooth(.2, .5, wing_fbm(p * vec2f(9., 14.) - vec2f(style.clock * .8, 0.)) + (1. - r) * .6));
  let vo = wing_voro(p * vec2f(8., 12.), 0.); let pulse = .5 + .5 * sin(r * 18. - style.clock * 5.);
  let veins = wing_smooth(.07, 0., vo.x) * inside * (.12 + .88 * pulse * pulse);
  let facet = step(.78, vo.y) * inside * (.55 + .45 * sin(style.clock * 2. + vo.y * 40.));
  let rim = wing_smooth(-.03, 0., d) * inside;
  let flame = wing_fbm(vec2f(p.x * 8. - style.clock * 2.5, p.y * 14. - style.clock * 1.5));
  let aura = exp(-max(d, 0.) * (26. - 14. * flame)) * (1. - inside) * (.2 + .7 * flame);
  let ghost = back * (.5 + .5 * wing_fbm(vec2f(p.x * 6. - style.clock * 1.5, p.y * 9.)));
  let color = style.shade * body + style.primary * (veins * 1.1 + rim * .9 + facet * .7 + aura + ghost * .35)
    + style.secondary * (veins * pulse * .5 + exp(-r * 14.) * .8 * deployed * wing_smooth(0., .12, p.x));
  return vec4f(color, body * .85 + ghost * .3 + aura * .2);
}
fn wing_bones(p: vec2f, deployed: f32, style: WingStyle) -> vec4f {
  var intensity = 0.; var membrane = 0.; var membrane_color = 0.; var hem = 0.;
  var previous_b = 0.; var previous_a = 0.; var previous_span = 0.;
  for (var i = 0; i < 4; i++) {
    let k = f32(i) / 3.; let angle = mix(-.3, .22, k) + .02 * sin(style.clock * 1.5 + k * 5.);
    let span = mix(.55, 1., k) * wing_stagger(k, deployed);
    if (span < .02) { continue; }
    let d = vec2f(cos(angle), sin(angle)); let a = dot(p, d); let b = dot(p, vec2f(-d.y, d.x));
    let s = clamp(a / span, 0., 1.); let bc = b + .12 * s * s * span;
    intensity += exp(-wing_sq(bc / .009)) * step(0., a) * step(a, span);
    intensity += exp(-(wing_sq(a - span * .4) + wing_sq(bc)) / wing_sq(.013))
      + exp(-(wing_sq(a - span * .75) + wing_sq(bc)) / wing_sq(.011))
      + exp(-(wing_sq(a - span) + wing_sq(bc)) / wing_sq(.009));
    if (previous_span > 0. && previous_b > 0. && bc < 0.) {
      let t = previous_b / (previous_b - bc);
      let edge = mix(previous_span, span, t) * (1. - .28 * sin(WING_PI * t));
      let am = mix(previous_a, a, t); let sm = am / max(edge, .001);
      if (am > 0. && sm < 1.) {
        let f = wing_fbm(vec2f(am * 7. - style.clock * 2.2, t * 3. + k * 9. + style.clock * .3)) * 1.5 - .35 - .6 * wing_smooth(.45, 1., sm);
        let mask = wing_smooth(0., .2, f); let level = floor(clamp(f * 1.6, 0., .999) * 3.) / 2.;
        membrane += mask * (.5 + .5 * level); membrane_color = max(membrane_color, level * mask);
        hem += wing_smooth(.04, 0., 1. - sm) * .6;
      }
    }
    previous_b = bc; previous_a = a; previous_span = span;
  }
  return vec4f(mix(style.primary, style.secondary, membrane_color) * membrane * 1.1
    + style.primary * hem * .5 + style.secondary * min(intensity, 1.5) * .9,
    membrane * .25 + min(intensity, 1.) * .5);
}
fn wing_puffs(p: vec2f, deployed: f32, style: WingStyle) -> vec4f {
  var d = 1.;
  for (var i = 0; i < 5; i++) {
    let fi = f32(i); let center = vec2f(.1 + .19 * fi, .02 + .028 * fi + .03 * sin(style.clock * 2. + fi * 1.4)) * deployed;
    let di = length(p - center) - (.16 - .022 * fi) * deployed;
    let h = clamp(.5 + .5 * (d - di) / .05, 0., 1.); d = mix(d, di, h) - .05 * h * (1. - h);
  }
  d += (wing_fbm(p * 14. - vec2f(style.clock * 1.5, 0.)) - .5) * .035;
  let inside = wing_smooth(.01, -.01, d); let depth = clamp(-d / .08, 0., 1.); let level = floor(depth * 3.) / 3.;
  let under = wing_smooth(.02, -.08, p.y - .1 * p.x) * inside;
  let swirl = wing_smooth(.06, 0., abs(fract(depth * 2.5 - style.clock * .6) - .5)) * inside;
  return vec4f((mix(style.shade * .75, style.shade, level) * (.6 + .4 * level) * style.variant + style.primary * under * .35) * inside
    + style.secondary * swirl * .2 + style.secondary * exp(-max(d, 0.) * 40.) * .3 * (1. - inside),
    inside * style.variant * (.6 + .4 * level));
}
fn wing_aurora(p: vec2f, x: f32, profile: f32, gate: f32, style: WingStyle) -> vec4f {
  var color = vec3f(0.); var alpha = 0.; let width = .17 * profile + .002; let mask = gate * min(profile * 2.5, 1.);
  for (var k = 0; k < 3; k++) {
    let fk = f32(k); let y = .09 * p.x + (fk - 1.) * .05 * x + .035 * sin(x * 7. - style.clock * 2. + fk * 2.1) * x;
    let d = p.y - y; var intensity = exp(-wing_sq(d / .012));
    if (d > 0.) { intensity = exp(-d / width); }
    intensity *= (.45 + .55 * wing_noise(vec2f(x * 46. - style.clock * 1.2 + fk * 9., style.clock * .4))) * mask;
    color += mix(style.primary, style.secondary, clamp(d / width * .6, 0., 1.)) * intensity * .8; alpha += intensity * .2;
  }
  let streamer_mask = wing_smooth(0., .08, x) * wing_smooth(1.3, 1.05, x);
  for (var k = 0; k < 2; k++) {
    let fk = f32(k); let y = .09 * p.x - .06 + fk * .06 + .05 * sin(x * 8. - style.clock * 2.6 + fk * 2.5) * x;
    let width = .004 + .022 * abs(cos(x * 10. - style.clock * 2. + fk * 1.3));
    let intensity = (1. - wing_smooth(width * .6, width, abs(p.y - y))) * streamer_mask;
    color += (vec3f(.8) + style.primary * .3) * intensity; alpha += intensity * .3;
  }
  return vec4f(color, alpha);
}
fn wing_surf(p: vec2f, x: f32, gate: f32, style: WingStyle) -> vec4f {
  var color = vec3f(0.); var alpha = 0.;
  let height = .25 * pow(clamp(1. - x, 0., 1.), .6) * wing_smooth(0., .12, x);
  for (var k = 0; k < 3; k++) {
    let fk = f32(k); let phase = x * (5. + fk) - style.clock * (1.6 + .5 * fk) + fk * 1.7; let saw = fract(phase);
    var crest = 1. - (saw - .8) / .2; if (saw < .8) { crest = wing_sq(saw / .8); }
    let top = height * (1. - .25 * fk) * (.35 + .65 * crest); let y = p.y - (.09 * p.x - .03 - .02 * fk);
    let fill = wing_smooth(-.02, .02, y) * (1. - wing_smooth(top - .012, top, y)) * gate;
    let foam = wing_smooth(.022, 0., abs(y - top)) * gate;
    color += style.primary * fill * (.25 + .12 * fk) * (.7 + .3 * sin(y * 120. + phase * 6.)) + style.secondary * foam * .8;
    alpha += fill * .18 + foam * .3;
  }
  return vec4f(color, alpha);
}
fn wing_fin(p: vec2f, deployed: f32, gate: f32, style: WingStyle) -> vec4f {
  let d = min(wing_blade(p, .12, deployed, .27, .22), min(wing_blade(p - vec2f(.05, -.02), -.25, .55 * deployed, .13, .1), wing_blade(p, .34, .45 * deployed, .1, .25)));
  let inside = wing_smooth(.004, -.004, d);
  let caustic = wing_smooth(.72, 1., sin(p.x * 40. + sin(p.y * 30. + style.clock * 2.) * 1.5 - style.clock * 3.) * .5 + .5);
  let rim = wing_smooth(-.02, 0., d) * inside;
  var color = (style.primary * (.35 + .25 * caustic) + style.secondary * (caustic * .35 + rim * .8)) * inside;
  var alpha = inside * .4;
  let q = vec2f(p.x * 13. - style.clock * 1.2, p.y * 13. + .2 * sin(style.clock * 1.5 + p.x * 6.) - style.clock * .4);
  let f = fract(q) - vec2f(.5); let h = wing_hash(floor(q)); let radius = .16 + .24 * fract(h * 17.);
  var ring = wing_smooth(.07, 0., abs(length(f) - radius)) + wing_smooth(.08, 0., length(f - vec2f(-.35, .35) * radius)) * .8;
  ring *= step(.45, h) * step(d, .1) * (1. - inside) * gate;
  color += style.secondary * ring * .85; alpha += ring * .25;
  return vec4f(color, alpha);
}
fn wing_shards(p: vec2f, x: f32, gate: f32, style: WingStyle) -> vec4f {
  let v = (p.y - .17 * sin(WING_PI * pow(clamp(x, 0., 1.), .75))) / max(.001, .11 * (1. - .6 * x));
  let envelope = wing_smooth(1., .85, abs(v)) * gate;
  let vo = wing_voro(vec2f(x * 7., v * 1.1), style.clock * 1.2);
  let plate = wing_smooth(.1, .2, vo.x - .25 * x * x) * envelope;
  let band = wing_smooth(.16, .08, abs(v - (abs(fract(x * 8. + vo.y) - .5) * 1.6 - .4)));
  let leak = (1. - plate) * envelope * wing_smooth(.3, 0., vo.x) * (.5 + .5 * sin(style.clock * 4. + x * 20.)) * (1. - x * .6);
  return vec4f((style.shade * .5 * (1. - band) + style.primary * band * (.7 + .3 * sin(style.clock * 3. + vo.y * 6.283))) * plate
    + style.primary * leak * .7, plate * .55 + leak * .15);
}
fn wing_slats(p: vec2f, x: f32, gate: f32, style: WingStyle) -> vec4f {
  let y = p.y - .09 * p.x; let xs = x - y * 1.2;
  let cell = floor(xs * 18.); let fx = fract(xs * 18.); let cx = (cell + .5) / 18.;
  let height = .3 * (1. - .8 * cx) * (.45 + .55 * wing_noise(vec2f(cell * .7, style.clock * 2.2 + cell * 1.3)));
  let intensity = step(.2, fx) * step(fx, .8) * step(-height * .35, y) * step(y, height) * step(.25, fract(y * 45.)) * step(.03, cx) * step(cx, 1.);
  let rail = wing_smooth(.006, .002, abs(y + .02)) * gate;
  return vec4f(mix(style.primary, style.secondary, wing_smooth(height * .6, height, y)) * intensity + style.shade * rail * .6,
    intensity * .5 + rail * .4);
}
// Candle k opens at price k and closes at price k + 1, so the chart is one continuous series.
fn wing_candle_price(k: f32) -> f32 {
  return (wing_noise(vec2f(k * .18, 5.)) - .5) * .34 + (wing_hash(vec2f(k, 9.)) - .5) * .1;
}
// A haunted chart: candles are born at the hinge, slide to the tip and dissolve. Primary rises, secondary falls.
// Each wing trades its own series on its own clock, so the pair never mirrors.
fn wing_candles(p: vec2f, x: f32, gate: f32, style: WingStyle) -> vec4f {
  let count = 22.; let scroll = style.clock * .9 + style.side * .25; let c = x * count - fract(scroll);
  let cell = floor(c); let fx = fract(c); let k = cell - floor(scroll) + style.side * 97.;
  let y = (p.y - .09 * p.x) / (1. - .5 * clamp((cell + .5) / count, 0., 1.));
  let grow = clamp(cell + fract(scroll), 0., 1.);
  // The live candle ticks around its path to the close and stretches its wicks to the extremes it touched.
  let open = wing_candle_price(k);
  let tick = (wing_noise(vec2f(style.clock * 7., k * 5.)) - .5) * .09 * sin(WING_PI * grow);
  let close = mix(open, wing_candle_price(k + 1.), grow) + tick;
  let up = step(open, close); let tint = mix(style.secondary, style.primary, up);
  let low_body = min(open, close); let high_body = max(open, close) + .006;
  let high = high_body + (.006 + .035 * wing_hash(vec2f(k, 1.))) * grow + max(tick, 0.) * .5;
  let low = low_body - (.006 + .035 * wing_hash(vec2f(k, 2.))) * grow + min(tick, 0.) * .5;
  let span = step(0., cell) * step(cell, count - 1.) * gate * wing_smooth(0., .15, grow);
  // Distance outside the body and wick, in cell widths horizontally and chart units vertically.
  let body_x = abs(fx - .5) - .36; let body_y = abs(y - (low_body + high_body) * .5) - (high_body - low_body) * .5;
  let body = wing_smooth(.03, 0., body_x) * wing_smooth(.003, 0., body_y);
  let wick = wing_smooth(.05, .03, abs(fx - .5)) * wing_smooth(.003, 0., abs(y - (low + high) * .5) - (high - low) * .5);
  // A neon haunt glows around each candle and the live one flares while it trades.
  let halo = exp(-max(body_x, 0.) * 9. - max(body_y, 0.) * 60.) * (1. - body) * .35;
  let live = 1. + .7 * (1. - grow) * step(cell, 1.);
  let dissolve = 1. - wing_smooth(.6, 1., x) * (.4 + .6 * wing_fbm(p * 22. - vec2f(style.clock, 0.)));
  let shape = max(body, wick * .9) * live * span * dissolve; let glow = halo * span * dissolve;
  let color = tint * (shape * (.8 + .2 * up) + glow) + style.shade * body * span * .3;
  return vec4f(color, clamp(shape * .7 + glow * .2, 0., 1.));
}
fn wing_fan(p: vec2f, deployed: f32, family: f32, style: WingStyle) -> vec4f {
  var intensity = 0.; var packet = 0.; var core = 0.;
  for (var i = 0; i < 5; i++) {
    let fi = f32(i); let feather = wing_feather(fi, deployed, style.clock); let span = feather.y;
    if (span < .02) { continue; }
    let d = vec2f(cos(feather.x), sin(feather.x)); let a = dot(p, d); let b = dot(p, vec2f(-d.y, d.x)); let s = a / span;
    if (family == 0.) {
      let on = step(.05, a) * step(a, span);
      packet += exp(-wing_sq((fract(s - style.clock * .5 - fi * .23) - .5) * 9.)) * wing_smooth(.02, 0., abs(b)) * on;
      intensity += step(max(abs(a - span), abs(b)), .024) * 1.2 + exp(-abs(b) * 70.) * on * .25;
      if (style.variant > .5) {
        let sw = sign(sin(a * 60.)); let trace = abs(fract(a * 60. / WING_PI + .5) - .5) * WING_PI / 60.;
        intensity += (wing_smooth(.006, .002, abs(b - .012 * sw)) + step(trace, .003) * step(abs(b), .015)) * on;
      } else {
        intensity += wing_smooth(.006, .002, abs(b)) * on;
        let pb = -b - .01; let panel = step(0., pb) * step(pb, a * .06) * step(.3 * span, a) * step(a, .88 * span);
        let q = vec2f(a * 46., pb * 46.); let grid = max(step(.7, fract(q.x)), step(.7, fract(q.y)));
        let visible = step(.15 + .7 * wing_smooth(.3, .9, s), wing_hash(floor(q * .5) + vec2f(floor(style.clock * 6.) * .37 + fi)));
        intensity += panel * visible * (grid * .8 + .15);
      }
    } else if (family == 2.) {
      let sc = clamp(s, 0., 1.); let width = .048 * pow(max(sin(WING_PI * sc), 0.), .6) + .001;
      let on = step(0., s) * step(s, 1.); let bb = (b + style.variant * .18 * sc * sc * span) / width;
      let shimmer = .55 + .45 * sin(s * 16. - style.clock * 4.5 + fi * 2.);
      intensity += exp(-bb * bb) * on * shimmer * (.75 + .25 * sin(bb * 6. + a * 90.));
      core += exp(-wing_sq(bb / .3)) * on * shimmer;
    } else {
      let on = step(0., s) * step(s, 1.); let bs = b - .05 * sin(a * 16. - style.clock * 3. + fi * 2.) * s;
      let stem = exp(-wing_sq(bs / .005)); let cell = a * 13. + fi * .37; let la = fract(cell);
      let lb = bs * ((floor(cell) - floor(floor(cell) / 2.) * 2.) * 2. - 1.);
      let width = max(.0005, .05 * sin(WING_PI * la) * (1. - .4 * s) + .0005);
      let leaf = step(0., lb) * (1. - wing_smooth(width * .3, width, lb));
      intensity += (stem + leaf * .7) * on * (.7 + .3 * sin(s * 10. - style.clock * 4. + fi)); core += stem * on;
    }
  }
  if (family == 0.) {
    intensity *= .75 + .25 * step(.5, fract(p.y * 60. - style.clock * 2.));
    let flicker = .9 + .1 * step(.5, wing_hash(vec2f(floor(style.clock * 14.), 3.)));
    return vec4f(style.primary * min(intensity, 1.1) * flicker + style.secondary * packet, clamp(intensity + packet, 0., 1.) * .55);
  }
  return vec4f(style.primary * intensity * .75 + style.secondary * core * .6, clamp(intensity, 0., 1.) * .12);
}
fn wing_pattern(point: vec2f, deployed: f32, family: f32, style: WingStyle) -> vec4f {
  if (point.x < 0. || deployed < .01) { return vec4f(0.); }
  let p = point - vec2f(0., wing_bend(point.x, style.clock)); let x = p.x / deployed;
  let profile = pow(clamp(x, 0., 1.), .4) * pow(clamp(1. - x, 0., 1.), .7);
  let v = (p.y - .09 * p.x) / (.2 * profile + .001); let gate = step(x, 1.) * wing_smooth(0., .08, x);
  var result: vec4f;
  switch i32(family) {
    case 10: { result = wing_shadow(p, deployed, style); }
    case 3: { result = wing_bones(p, deployed, style); }
    case 1: { result = wing_puffs(p, deployed, style); }
    case 4: { result = wing_aurora(p, x, profile, gate, style); }
    case 5: { result = wing_surf(p, x, gate, style); }
    case 6: { result = wing_fin(p, deployed, gate, style); }
    case 7: { result = wing_shards(p, x, gate, style); }
    case 9: { result = wing_slats(p, x, gate, style); }
    case 11: { result = wing_candles(p, x, gate, style); }
    default: { result = wing_fan(p, deployed, family, style); }
  }
  let q = vec2f(p.x * 26. - style.clock * 1.6, p.y * 26. + style.clock * .5); let f = fract(q) - vec2f(.5);
  let h = wing_hash(floor(q));
  var mote = step(.88, h) * wing_smooth(.22, 0., abs(f.x) + abs(f.y)) * (.5 + .5 * sin(style.clock * 5. + h * 40.));
  mote *= step(abs(v), 2.2) * step(x, 1.1) * wing_smooth(0., .1, x);
  return result + vec4f(mix(style.primary, vec3f(1.), .5) * mote, mote * .3);
}
`
