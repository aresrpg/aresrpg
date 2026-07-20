import { createHash } from 'node:crypto'

import { describe, expect, test } from 'bun:test'
import { Texture } from 'three'
import { vec4 } from 'three/tsl'

import { LENS_WATER, create_lens_water } from './lens_water.js'

const WET_GRAPH_SHA256 = '548cb341ddbb94225fe80b1ca7cabaa925a918aba17914d9d9e9c4d1ce1a6537'

describe('lens-water graph parity', () => {
  test('dry apply is the exact source node and allocates no render target', () => {
    const lens = create_lens_water()
    const source = vec4(0.1, 0.2, 0.3, 1)
    const original_clone = Texture.prototype.clone
    let render_target_texture_clones = 0
    Texture.prototype.clone = function () {
      render_target_texture_clones += 1
      return original_clone.call(this)
    }
    try {
      const output = lens.apply(source, false)
      expect({ dry_output_is_source: output === source, render_target_texture_clones }).toEqual({
        dry_output_is_source: true,
        render_target_texture_clones: 0,
      })
    } finally {
      Texture.prototype.clone = original_clone
      lens.dispose()
    }
  })

  test('wet graph callback and field knobs retain the pre-optimization fingerprint', () => {
    const lens = create_lens_water()
    try {
      const wet = lens.apply(vec4(0.1, 0.2, 0.3, 1), true)
      const wet_source = wet.node.shaderNode.jsFunc.toString()
      const digest = createHash('sha256')
        .update(wet_source + JSON.stringify(LENS_WATER))
        .digest('hex')
      expect(digest).toBe(WET_GRAPH_SHA256)
    } finally {
      lens.dispose()
    }
  })
})
