// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The 3-colour mesh-recolour SSOT, ported 1:1 from the AresRPG production engine
// (`aresrpg-legacy/packages/engine/src/lib/helpers/customizable-texture.ts` +
// `fullscreen-quad.ts`). The character GLBs ship a `diffuse_base` albedo plus three mask
// layers `diffuse_color1/2/3` (and, for yajin, the matching `emissive_*` set). This composites
// the base then each mask painted with the chosen colour into ONE render-target texture that
// replaces the material's `map` / `emissiveMap` — so Skin/Armor/Trim recolour the REAL mesh on
// the GPU, never a UI swatch. Faithful port to JS+JSDoc (TS class -> factory of the same shape).

import {
  Color,
  CustomBlending,
  SrcAlphaFactor,
  OneMinusSrcAlphaFactor,
  ZeroFactor,
  OneFactor,
  Mesh,
  BufferGeometry,
  Float32BufferAttribute,
  PerspectiveCamera,
  RawShaderMaterial,
  SRGBColorSpace,
  WebGLRenderTarget,
} from 'three'

// Port of engine `createFullscreenQuad` — a 6-vertex (2-triangle) quad in [0,1] clip-ish space the
// apply-layer shader expands to full NDC. The attribute name is parameterised exactly as upstream.
const create_fullscreen_quad = (attribute_name) => {
  const geometry = new BufferGeometry()
  geometry.name = 'fullscreen-quad-geometry'
  geometry.setAttribute(attribute_name, new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2))
  geometry.setDrawRange(0, 6)
  const quad = new Mesh(geometry)
  quad.name = 'fullscreen-quad-mesh'
  quad.frustumCulled = false
  return quad
}

/**
 * @typedef {{ texture: import('three').Texture, color: Color }} TextureLayer
 */

/**
 * Build a customizable texture from one base albedo + N named mask layers. Mirrors the upstream
 * `CustomizableTexture` class API (`texture`, `needsUpdate`, `layerNames`, `setLayerColor`,
 * `getLayerColor`, `update(renderer)`, `dispose()`).
 *
 * @param {{ baseTexture: import('three').Texture, additionalTextures: ReadonlyMap<string, import('three').Texture> }} params
 * @returns {{
 *   texture: import('three').Texture,
 *   needsUpdate: () => boolean,
 *   layerNames: string[],
 *   setLayerColor: (name: string, color: Color) => void,
 *   getLayerColor: (name: string) => Color,
 *   update: (renderer: import('three').WebGLRenderer) => void,
 *   dispose: () => void,
 * }}
 */
export function create_customizable_texture({ baseTexture, additionalTextures }) {
  const base_image = /** @type {{ width: number, height: number }} */ (baseTexture.image)
  const render_target = new WebGLRenderTarget(base_image.width, base_image.height, {
    wrapS: baseTexture.wrapS,
    wrapT: baseTexture.wrapT,
    magFilter: baseTexture.magFilter,
    depthBuffer: false,
  })
  const out_texture = render_target.textures[0]
  if (!out_texture) throw new Error('Cannot get texture from rendertarget')
  // The composited result is an sRGB-authored albedo (the base + masks are sRGB PNGs), so tag it
  // sRGB to get the single correct decode when three samples it as the material map.
  out_texture.colorSpace = SRGBColorSpace

  /** @type {Map<string, TextureLayer>} */
  const layers = new Map()
  for (const [name, texture] of additionalTextures.entries()) layers.set(name, { texture, color: new Color(0xffffff) })

  let needs_update = true
  const fake_camera = new PerspectiveCamera()
  const fullscreen_quad = create_fullscreen_quad('aPosition')

  const uniforms = {
    layer: { value: /** @type {import('three').Texture | null} */ (null) },
    color: { value: new Color(0xffffff) },
    flipY: { value: 0 },
  }

  const shader = new RawShaderMaterial({
    glslVersion: '300 es',
    depthTest: false,
    blending: CustomBlending,
    blendSrc: SrcAlphaFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
    uniforms: {
      uLayerTexture: uniforms.layer,
      uLayerColor: uniforms.color,
      uFlipY: uniforms.flipY,
    },
    vertexShader: `
uniform float uFlipY;
in vec2 aPosition;
out vec2 vUv;
void main() {
  gl_Position = vec4(2.0 * aPosition - 1.0, 0, 1);
  vUv = vec2(aPosition.x, mix(aPosition.y, 1.0 - aPosition.y, uFlipY));
}`,
    fragmentShader: `
precision mediump float;
uniform sampler2D uLayerTexture;
uniform vec3 uLayerColor;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;
void main() {
  vec4 sampled = texture(uLayerTexture, vUv);
  if (sampled.a < 0.5) discard;
  sampled.rgb *= uLayerColor;
  fragColor = sampled;
}`,
  })
  fullscreen_quad.material = shader

  return {
    texture: out_texture,
    get layerNames() {
      return Array.from(layers.keys())
    },
    needsUpdate: () => needs_update,
    setLayerColor(name, color) {
      const layer = layers.get(name)
      if (!layer) throw new Error(`Unknown layer "${name}". Layers: ${Array.from(layers.keys()).join('; ')}.`)
      if (layer.color.equals(color)) return
      layer.color.set(color)
      needs_update = true
    },
    getLayerColor(name) {
      const layer = layers.get(name)
      if (!layer) throw new Error(`Unknown layer "${name}". Layers: ${Array.from(layers.keys()).join('; ')}.`)
      return layer.color.clone()
    },
    update(renderer) {
      const prev = {
        render_target: renderer.getRenderTarget(),
        clear_color: renderer.getClearColor(new Color()),
        clear_alpha: renderer.getClearAlpha(),
        auto_clear: renderer.autoClear,
        auto_clear_color: renderer.autoClearColor,
      }

      renderer.setRenderTarget(render_target)
      renderer.setClearColor(0x000000, 0)
      renderer.autoClear = false
      renderer.autoClearColor = false
      renderer.clear(true)

      // base layer first (full albedo, untinted), then each mask painted with its colour
      uniforms.layer.value = baseTexture
      uniforms.color.value = new Color(0xffffff)
      uniforms.flipY.value = Number(baseTexture.flipY)
      shader.uniformsNeedUpdate = true
      renderer.render(fullscreen_quad, fake_camera)

      for (const layer of layers.values()) {
        uniforms.layer.value = layer.texture
        uniforms.color.value = layer.color
        uniforms.flipY.value = Number(layer.texture.flipY)
        shader.uniformsNeedUpdate = true
        renderer.render(fullscreen_quad, fake_camera)
      }

      renderer.setRenderTarget(prev.render_target)
      renderer.setClearColor(prev.clear_color, prev.clear_alpha)
      renderer.autoClear = prev.auto_clear
      renderer.autoClearColor = prev.auto_clear_color

      needs_update = false
    },
    dispose() {
      render_target.dispose()
      fullscreen_quad.geometry.dispose()
      shader.dispose()
    },
  }
}
