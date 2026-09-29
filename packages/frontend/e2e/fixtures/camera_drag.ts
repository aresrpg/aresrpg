// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create_fight_addon } from '../../src/game/core/cameras.ts'
import { create_camera_drag } from '../../src/game/core/camera_drag.ts'
const canvas = document.querySelector('canvas')!
const hud = document.querySelector<HTMLButtonElement>('#hud')!
document.body.dataset.rotations = '0'
const controls = new URLSearchParams(location.search).has('fight')
  ? create_fight_addon({
      board: () => ({ origin: { x: 0, y: 0, z: 0 }, grid_w: 20, grid_h: 20, cell_size: 1 }),
    })
  : create_camera_drag({
      on_rotate: () => {
        document.body.dataset.rotations = String(Number(document.body.dataset.rotations) + 1)
      },
    })
controls.attach?.(canvas)
hud.onclick = () => {
  document.body.dataset.clicked = 'true'
}

if ('get_state' in controls) {
  const publish = () => {
    document.body.dataset.camera = JSON.stringify(controls.get_state())
  }
  globalThis.addEventListener('pointermove', publish)
  publish()
  hud.onclick = () => {
    controls.detach?.()
    document.body.dataset.detached = 'true'
  }
}
