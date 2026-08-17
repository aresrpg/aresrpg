// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { PerspectiveCamera, Vector3 } from 'three'

import { project_screen_anchor } from '../src/screen_projection.ts'

describe('entity screen projection', () => {
  test('projects a world anchor into canvas client coordinates', () => {
    const camera = new PerspectiveCamera(90, 1, 0.1, 100)
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()

    const projected = project_screen_anchor(new Vector3(0, 1, 0), camera, {
      left: 10,
      top: 20,
      width: 100,
      height: 100,
    })

    expect(projected?.x).toBeCloseTo(60)
    expect(projected?.y).toBeCloseTo(60)
  })

  test('drops anchors behind the camera', () => {
    const camera = new PerspectiveCamera(90, 1, 0.1, 100)
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)

    expect(
      project_screen_anchor(new Vector3(0, 0, 10), camera, { left: 0, top: 0, width: 100, height: 100 })
    ).toBeNull()
  })
})
