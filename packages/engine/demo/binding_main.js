// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S-17a — standalone entry for the world-binding-seams demo (binding.html). Thin bootstrap: grab the
// canvas + gate and hand off to boot_binding_demo (kept separate from main.js so the seam acceptance
// surface is independent of the main demo).
import { boot_binding_demo } from './binding_demo.js'

const params = new URLSearchParams(location.search)
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'))
const gate = /** @type {HTMLDivElement} */ (document.getElementById('gate'))
const hud = /** @type {HTMLDivElement} */ (document.getElementById('hud'))

boot_binding_demo(canvas, gate, hud, params).catch((error) => {
  gate.dataset.hidden = 'false'
  gate.textContent = `Binding demo failed: ${/** @type {Error} */ (error)?.message ?? error}`
  console.error('[binding demo]', error)
})
