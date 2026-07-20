// Thin bootstrap for the in-engine VFX AgX capture (vfx_fight.html). Grabs the canvas + gate and hands off to
// boot_vfx_fight_demo (kept separate from main.js so the capture surface is independent of the main demo).
import { boot_vfx_fight_demo } from './vfx_fight_demo.js'

const params = new URLSearchParams(location.search)
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'))
const gate = /** @type {HTMLDivElement} */ (document.getElementById('gate'))

boot_vfx_fight_demo(canvas, gate, params).catch((error) => {
  gate.dataset.hidden = 'false'
  gate.textContent = `VFX demo failed: ${/** @type {Error} */ (error)?.message ?? error}`
  console.error('[vfx demo]', error)
})
