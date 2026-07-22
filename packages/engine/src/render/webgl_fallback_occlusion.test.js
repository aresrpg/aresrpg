// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_board_occlusion } from '../tactical/board_occlusion.js'

import { webgpu_only_stubs } from './webgl_fallback.js'

test('the headless WebGL fallback exposes the complete tactical board occlusion surface', () => {
  const canonical_occlusion = create_board_occlusion()
  const occlusion = webgpu_only_stubs(canonical_occlusion).get_board_occlusion()

  // This is the exact occlusion lifecycle create_tactical_board.build() drives without a GPU.
  occlusion.set_screen([0, 0], [0.5, 0.5], 12, 3, [4, 4], 8)
  occlusion.set_active(true)
  occlusion.set_footprint_clear([4, 4], [5, 5], true)
  occlusion.set_active(false)

  expect(occlusion).toBe(canonical_occlusion)
})
