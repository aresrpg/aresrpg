// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Context adapter only. All authored drawing functions and effect sections come from the source verbatim.
import { FRAGMENT } from './generated/claude_spell_fragment.js'

const BRIDGE = `
uniform bool aresGame;
uniform bool aresComposite;
uniform sampler2D aresScene, aresActors, aresCells;
uniform sampler2D aresOriginal;
uniform mat4 aresProjection, aresInverseProjection, aresLocalToWorld;
uniform vec4 aresBoard;
uniform vec2 aresBoardSize;
uniform float aresVerticalScale;
uniform vec3 aresSpots[7];
uniform int aresSpotCount;
vec2 aresPixel() { return gl_FragCoord.xy / uRes; }
vec3 aresBackground() {
  vec3 finalColor = texture2D(aresScene, aresPixel()).rgb;
  float vignette = max(.05, 1. - .35 * dot(uv, uv));
  vec3 linearColor = pow(finalColor, vec3(1. / .9)) / vignette;
  return linearColor / max(vec3(.001), 1. - linearColor * .22);
}
vec2 aresBoardPoint(vec2 g) {
  vec3 world = (aresLocalToWorld * vec4(g.x, 0., g.y, 1.)).xyz;
  return (world.xz - aresBoard.xy) / aresBoard.z;
}
vec4 aresCell(vec2 g) {
  vec2 index = floor(aresBoardPoint(g));
  if (any(lessThan(index, vec2(0.))) || any(greaterThanEqual(index, aresBoardSize))) return vec4(0.);
  return texture2D(aresCells, (index + .5) / aresBoardSize);
}
vec3 aresOrigin() {
  vec4 nearPoint = aresInverseProjection * vec4(aresPixel() * 2. - 1., 0., 1.);
  return nearPoint.xyz / nearPoint.w;
}
vec3 aresRay() {
  if (!aresGame) return normalize(fw * F + rt * uv.x + up * uv.y);
  vec4 farPoint = aresInverseProjection * vec4(aresPixel() * 2. - 1., 1., 1.);
  return normalize(farPoint.xyz / farPoint.w - ro);
}
// Separate the authored change from its background so only the effect is upsampled.
// The canvas compositor blends display-space colors; an unchanged pixel has zero opacity.
vec4 aresOverlay(vec3 color) {
  vec3 background = texture2D(aresOriginal, aresPixel()).rgb;
  vec3 difference = clamp(color, 0., 1.) - background;
  vec3 opacity = max(difference / max(vec3(.001), 1. - background), -difference / max(vec3(.001), background));
  float alpha = clamp(max(opacity.r, max(opacity.g, opacity.b)), 0., 1.);
  return alpha < .001 ? vec4(0.) : vec4(background + difference / alpha, alpha);
}
`
const replace_once = (source: string, before: string, after: string): string => {
  if (source.split(before).length !== 2)
    throw new Error(`Authored shader integration boundary changed: ${before.slice(0, 60)}`)
  return source.replace(before, after)
}

export const claude_spell_game_shader = (): string => {
  let source = replace_once(FRAGMENT, 'vec3 ro, fw, rt, up; vec2 uv;', `vec3 ro, fw, rt, up; vec2 uv;\n${BRIDGE}`)
  source = replace_once(
    source,
    'vec3 prj(vec3 P){ vec3 d = P - ro; float z = max(dot(d, fw), .05); return vec3(vec2(dot(d, rt), dot(d, up)) * F / z, z); }',
    `vec3 prj(vec3 P){
      if (aresGame) { vec4 p = aresProjection * vec4(P, 1.); float w = max(p.w, .001);
        return vec3(p.xy / w * vec2(uRes.x / uRes.y, 1.) * .5, w * F / aresVerticalScale); }
      vec3 d = P - ro; float z = max(dot(d, fw), .05); return vec3(vec2(dot(d, rt), dot(d, up)) * F / z, z);
    }`
  )
  source = replace_once(
    source,
    'vec3 rd = normalize(fw * F + rt * uv.x + up * uv.y);',
    'if (aresGame) ro = aresOrigin();\n  vec3 rd = aresRay();'
  )
  source = replace_once(
    source,
    'vec3 col = mix(vec3(.03, .025, .055), vec3(.075, .05, .13), uv.y + .5);',
    'vec3 col = aresGame ? aresBackground() : mix(vec3(.03, .025, .055), vec3(.075, .05, .13), uv.y + .5);'
  )
  source = replace_once(
    source,
    'float inb = step(abs(c.x), 7.) * step(abs(c.y), 3.);',
    'float inb = aresGame ? aresCell(g).r : step(abs(c.x), 7.) * step(abs(c.y), 3.);'
  )
  source = replace_once(source, 'col = mix(col, gc, inb);', 'if (!aresGame) col = mix(col, gc, inb);')
  source = replace_once(
    source,
    'float area = in_area(rc) * inb, dist =',
    'float area = (aresGame ? aresCell(g).g : in_area(rc)) * inb, dist ='
  )
  const caster_start = '  tt = box(ro, rd, uCst + vec3(0., .5, 0.),'
  const caster_end = '  float ti = uI;'
  const begin = source.indexOf(caster_start),
    end = source.indexOf(caster_end, begin)
  if (begin < 0 || end < 0) throw new Error('Authored dummy boundary changed')
  source = source.slice(0, begin) + '  if (!aresGame) {\n' + source.slice(begin, end) + '  }\n' + source.slice(end)
  source = replace_once(
    source,
    '  dummy(col, rd, uDum, hit * (1. - uGhostD), tint, uGhostD);',
    '  if (!aresGame) dummy(col, rd, uDum, hit * (1. - uGhostD), tint, uGhostD);'
  )
  source = replace_once(source, '  if (uDum2.y > -1.) dummy', '  if (!aresGame && uDum2.y > -1.) dummy')
  source = replace_once(
    source,
    '  if (uSky > .5 && rd.y < -.001) {',
    '  if (aresGame) col = mix(col, aresBackground(), texture2D(aresActors, aresPixel()).r);\n\n  if (uSky > .5 && rd.y < -.001) {'
  )
  source = replace_once(
    source,
    'vec3 spot(int i){',
    'vec3 spot(int i){\n  if (aresGame) { for (int j = 0; j < 7; j++) if (i == j) return aresSpots[j]; }'
  )
  source = replace_once(
    source,
    'float spot_on(int i){ return',
    'float spot_on(int i){ if (aresGame) return i < aresSpotCount ? 1. : 0.; return'
  )
  source = replace_once(
    source,
    'vec2 c = floor(g + .5), fc = g - c;',
    'vec2 c = floor(g + .5), fc = aresGame ? fract(aresBoardPoint(g)) - .5 : g - c;'
  )
  source = replace_once(
    source,
    'vec2 rc = c - floor(uTgt.xz + .5);',
    'vec2 rc = aresGame ? floor(aresBoardPoint(g)) - floor(aresBoardPoint(uTgt.xz)) : c - floor(uTgt.xz + .5);'
  )
  // Yogan's accepted body owns the spectral bow. Its authored charge and arrow energy remain untouched.
  source = replace_once(
    source,
    '  if (uClass == 0) {\n    float limb',
    '  if (uClass == 0 && !aresGame) {\n    float limb'
  )
  source = replace_once(
    source,
    '  gl_FragColor = vec4(pow(max(col, 0.), vec3(.9)), 1.);',
    `  gl_FragColor = vec4(pow(max(col, 0.), vec3(.9)), 1.);
  if (aresGame && aresComposite) gl_FragColor = aresOverlay(gl_FragColor.rgb);`
  )
  return source
}
