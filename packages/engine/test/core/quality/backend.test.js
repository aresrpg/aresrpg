// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-20 backend-selection unit tests. pick_renderer_backend is the PURE gate that forks the engine
// between the full WebGPU stack and the minimal WebGL heightmap fallback. It reads only an injected
// navigator.gpu presence bit + a force flag, so it tests with zero GPU.

import { test, expect, describe } from 'bun:test'

import { pick_renderer_backend } from '../../../src/core/quality/backend.js'

describe('pick_renderer_backend', () => {
  test('webgpu when navigator.gpu is present and not forced', () => {
    expect(pick_renderer_backend({ navigator_gpu: {} })).toBe('webgpu')
    expect(pick_renderer_backend({ navigator_gpu: { requestAdapter: () => {} } })).toBe('webgpu')
  })

  test('webgl when navigator.gpu is absent (undefined or null)', () => {
    expect(pick_renderer_backend({ navigator_gpu: undefined })).toBe('webgl')
    expect(pick_renderer_backend({ navigator_gpu: null })).toBe('webgl')
  })

  test('force_webgl overrides a present navigator.gpu', () => {
    expect(pick_renderer_backend({ navigator_gpu: {}, force_webgl: true })).toBe('webgl')
  })

  test('force_webgl:false with present gpu stays webgpu', () => {
    expect(pick_renderer_backend({ navigator_gpu: {}, force_webgl: false })).toBe('webgpu')
  })

  test('force_webgl wins even with no gpu (still webgl, no throw)', () => {
    expect(pick_renderer_backend({ navigator_gpu: null, force_webgl: true })).toBe('webgl')
  })
})
