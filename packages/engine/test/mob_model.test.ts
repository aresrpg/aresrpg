// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { AnimationClip, BoxGeometry, Group, Mesh, MeshBasicMaterial, VectorKeyframeTrack } from 'three'

import { prepare_mob_model_root } from '../src/mob_model.ts'

describe('mob model preparation', () => {
  test('grounds an animated mob from its idle pose instead of its authored rest pose', () => {
    const root = new Group()
    const body = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    body.name = 'Body'
    body.position.y = -2
    root.add(body)
    const idle = new AnimationClip('IDLE', 1, [new VectorKeyframeTrack('Body.position', [0, 1], [0, 0, 0, 0, 0, 0])])

    const min_y = prepare_mob_model_root(root, [idle], 'offset fixture')

    expect(body.position.y).toBe(0)
    expect(min_y).toBeCloseTo(-0.25)
  })
})
