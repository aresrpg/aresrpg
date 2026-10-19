// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Offline integration of the authored spell shader. Preview drawing never enters the runtime artifact.
const BRIDGE = `
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
const replace_once = (source, before, after) => {
  if (source.split(before).length !== 2) throw new Error(`Authored shader boundary changed: ${before.slice(0, 60)}`)
  return source.replace(before, after)
}
const replace_section = (source, start, end, replacement = '') => {
  if (source.split(start).length !== 2 || source.split(end).length !== 2)
    throw new Error(`Authored shader section changed: ${start}`)
  const begin = source.indexOf(start),
    finish = source.indexOf(end)
  if (finish <= begin) throw new Error(`Authored shader section is reversed: ${start}`)
  return source.slice(0, begin) + replacement + source.slice(finish)
}

export const compile_spell_shader = (fragment) => {
  let source = replace_once(fragment, 'vec3 ro, fw, rt, up; vec2 uv;', `vec3 ro; vec2 uv;\n${BRIDGE}`)
  source = replace_once(
    source,
    'vec3 prj(vec3 P){ vec3 d = P - ro; float z = max(dot(d, fw), .05); return vec3(vec2(dot(d, rt), dot(d, up)) * F / z, z); }',
    `vec3 prj(vec3 P){
      vec4 p = aresProjection * vec4(P, 1.); float w = max(p.w, .001);
      return vec3(p.xy / w * vec2(uRes.x / uRes.y, 1.) * .5, w * F / aresVerticalScale);
    }`
  )
  source = replace_once(
    source,
    'ro = uCam; fw = normalize(uLook - ro); rt = normalize(cross(fw, vec3(0., 1., 0.))); up = cross(rt, fw);',
    'ro = aresOrigin();'
  )
  source = replace_once(source, 'vec3 rd = normalize(fw * F + rt * uv.x + up * uv.y);', 'vec3 rd = aresRay();')
  source = replace_once(
    source,
    'vec3 col = mix(vec3(.03, .025, .055), vec3(.075, .05, .13), uv.y + .5);',
    'vec3 col = aresBackground();'
  )
  source = replace_section(source, 'float box(', '// a spike built from stacked blocks:')
  source = replace_section(source, 'void dummy(', '// strands of light streaming up')
  source = replace_section(source, 'float in_area(', 'vec3 spot(')
  source = replace_section(
    source,
    'vec3 spot(',
    'float spot_on(',
    'vec3 spot(int i){ for (int j = 0; j < 7; j++) if (i == j) return aresSpots[j]; return vec3(0.); }\n'
  )
  source = replace_section(
    source,
    'float spot_on(',
    'void ground(',
    'float spot_on(int i){ return i < aresSpotCount ? 1. : 0.; }\n\n'
  )
  source = replace_once(
    source,
    'vec2 c = floor(g + .5), fc = g - c;',
    'vec2 c = floor(g + .5), fc = fract(aresBoardPoint(g)) - .5;'
  )
  source = replace_section(
    source,
    '  float inb = step(abs(c.x), 7.)',
    '  vec2 d = g - uCst.xz;',
    '  float inb = aresCell(g).r;\n  float edge = max(abs(fc.x), abs(fc.y));\n\n'
  )
  source = replace_once(
    source,
    'vec2 rc = c - floor(uTgt.xz + .5);',
    'vec2 rc = floor(aresBoardPoint(g)) - floor(aresBoardPoint(uTgt.xz));'
  )
  source = replace_once(source, 'float area = in_area(rc) * inb, dist =', 'float area = aresCell(g).g * inb, dist =')
  source = replace_once(source, '  vec3 n, nn; float t = 1e9, tt; vec3 bc = vec3(0.);\n', '')
  source = replace_section(source, '  tt = box(ro, rd, uCst + vec3(0., .5, 0.),', '  float ti = uI;')
  source = replace_section(
    source,
    '  float hit = (uEl == 4',
    '  if (uSky > .5 && rd.y < -.001) {',
    '  col = mix(col, aresBackground(), texture2D(aresActors, aresPixel()).r);\n\n'
  )
  // The real Yogan model owns his bow; spell charge and arrow effects remain authored.
  source = replace_once(
    source,
    `  if (uClass == 0) {
    float limb = ln(lx - (.14 - ly * ly * 1.15), .035) * step(abs(ly), .56);
    col = mix(col, mix(vec3(.75, .62, .42), uC1, charge), limb);
    col += uC2 * exp(-abs(lx - (.14 - ly * ly * 1.15)) * 22.) * step(abs(ly), .6) * charge * .6;
    col += (vec3(.7) + uC1 * charge) * ln(lx - mix(-.22 - pull, -.22, abs(ly) / .56), .014) * step(abs(ly), .56) * .8;
  }
`,
    ''
  )
  // uDum and ghost values still position/tint spells; only preview-only inputs are removed.
  source = replace_once(source, ', uDum2', '')
  source = replace_once(source, ', uCam, uLook', '')
  source = replace_once(
    source,
    '  gl_FragColor = vec4(pow(max(col, 0.), vec3(.9)), 1.);',
    `  gl_FragColor = vec4(pow(max(col, 0.), vec3(.9)), 1.);
  if (aresComposite) gl_FragColor = aresOverlay(gl_FragColor.rgb);`
  )
  if (/\baresGame\b|\bdummy\s*\(|\bbox\s*\(|\bin_area\s*\(|\buDum2\b|\buCam\b|\buLook\b/.test(source))
    throw new Error('Preview shader dependencies remain after gameplay integration')
  return source
}
