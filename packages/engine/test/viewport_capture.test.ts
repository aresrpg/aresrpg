// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'
import { DepthTexture, FramebufferTexture, RenderTarget } from 'three'
import { screenUV, viewportTexture } from 'three/tsl'

import { create_viewport_capture } from '../src/viewport_capture.ts'

test('refraction samples share one copy per target and release it with the target or world', () => {
  for (const texture of [new FramebufferTexture(1, 1), new DepthTexture(1, 1)]) {
    const capture = create_viewport_capture(viewportTexture(screenUV, null, texture))
    const first = capture.sample(screenUV)
    const second = capture.sample(screenUV.add(0.01))
    const main = new RenderTarget(100, 80)
    const reflection = new RenderTarget(40, 32)
    const main_copy = first.getTextureForReference(main)
    const reflection_copy = second.getTextureForReference(reflection)
    expect(second.getTextureForReference(main)).toBe(main_copy)
    expect(main_copy).not.toBe(reflection_copy)
    const main_dispose = spyOn(main_copy, 'dispose')
    const reflection_dispose = spyOn(reflection_copy, 'dispose')
    const default_dispose = spyOn(texture, 'dispose')
    main.dispose()
    expect(main_dispose).toHaveBeenCalledTimes(1)
    expect(reflection_dispose).not.toHaveBeenCalled()
    capture.dispose()
    expect(main_dispose).toHaveBeenCalledTimes(1)
    expect(reflection_dispose).toHaveBeenCalledTimes(1)
    expect(default_dispose).toHaveBeenCalledTimes(1)
    main_dispose.mockRestore()
    reflection_dispose.mockRestore()
    default_dispose.mockRestore()
    reflection.dispose()
  }
})
