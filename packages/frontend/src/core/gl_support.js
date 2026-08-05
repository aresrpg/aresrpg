// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE ONE HOME of "can this browser draw 3D at all" (#2235). A browser with graphics acceleration
// turned off (Chrome: Settings → System → "Use graphics acceleration when available") answers `null`
// to every WebGL context request and disables WebGPU with it — chrome://gpu reads WebGL/WebGPU/OpenGL
// all "Disabled" on hardware that runs the game fine with the switch on. That is a BROWSER STATE, not
// weak hardware, and it is detectable in one synchronous call before anything tries to render.
//
// WebGL alone is the oracle on purpose: `navigator.gpu` still EXISTS with acceleration off (only the
// async `requestAdapter()` answers null), so its presence proves nothing, while a browser that can
// create a WebGL context always has the GPU process the WebGPU renderer needs. One probe, one answer.
//
// Consumers: embed.js (never boots the engine into a dead context) and the world slot's recovery door
// (WorldCharacterCreate.jsx). Nothing else may re-derive this — import it.

/**
 * Can this browser create a WebGL context right now? Never throws: a browser that refuses the context
 * may answer null OR throw out of `getContext`, and both mean the same thing to a player.
 *
 * Deliberately NOT memoized — the recovery door's retry re-asks after the player flips the setting and
 * relaunches, and a cached "no" would answer for a browser that no longer exists.
 *
 * @param {() => HTMLCanvasElement} [create_canvas] injection seam for tests (this repo's bun:test has no DOM)
 * @returns {boolean}
 */
export function probe_gl_context(create_canvas = () => document.createElement('canvas')) {
  try {
    const canvas = create_canvas()
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (!context) return false
    // Hand the context straight back: probing must not eat one of the browser's few live GL contexts,
    // which is itself a way to make the next real renderer fail.
    const lose = /** @type {{ getExtension?: (name: string) => { loseContext?: () => void } | null }} */ (context)
    lose.getExtension?.('WEBGL_lose_context')?.loseContext?.()
    return true
  } catch {
    return false
  }
}
