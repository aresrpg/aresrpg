// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-18 — standalone entry for the world-border demo (border.html). Thin bootstrap: grab the canvas +
// gate and hand off to boot_border_demo. Kept separate from main.js so the border acceptance surface is
// independent of the concurrent ENG-19/20 main.js rewrite.
import { boot_border_demo } from './border_demo.js'

const params = new URLSearchParams(location.search)
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'))
const gate = /** @type {HTMLDivElement} */ (document.getElementById('gate'))

boot_border_demo(canvas, gate, params).catch((error) => {
  gate.dataset.hidden = 'false'
  gate.textContent = `Border demo failed: ${/** @type {Error} */ (error)?.message ?? error}`
  console.error('[border demo]', error)
})
