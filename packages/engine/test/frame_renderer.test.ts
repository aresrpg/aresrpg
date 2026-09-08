// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, spyOn, test } from 'bun:test'
import { AgXToneMapping, DirectionalLight, PerspectiveCamera, Scene, SRGBColorSpace } from 'three'
import type { Renderer } from 'three/webgpu'
import { float } from 'three/tsl'
import BloomNode from 'three/addons/tsl/display/BloomNode.js'

import { create_frame_renderer } from '../src/frame_renderer.ts'
import { liquid_palette } from '../src/liquid_palette.ts'
import { create_sky_node } from '../src/sky/sky_node.ts'

test('leaving high quality and disposing the pipeline release owned bloom targets and materials', () => {
  const dispose = spyOn(BloomNode.prototype, 'dispose')
  const renderer = { toneMapping: AgXToneMapping, outputColorSpace: SRGBColorSpace } as Renderer
  const pipeline = create_frame_renderer(
    renderer,
    new Scene(),
    new PerspectiveCamera(),
    'high',
    'world',
    new DirectionalLight(),
    create_sky_node().sun_direction,
    float(0),
    float(0),
    liquid_palette([0, 0.1, 0.3])
  )
  try {
    pipeline.set_quality('medium')
    expect(dispose).toHaveBeenCalledTimes(1)
    pipeline.set_quality('high')
    pipeline.dispose()
    expect(dispose).toHaveBeenCalledTimes(2)
  } finally {
    dispose.mockRestore()
  }
})
