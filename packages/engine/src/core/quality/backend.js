// ENG-20 — RENDERER BACKEND SELECTION. 2026-07-05.
// ============================================================================================
// Design rule: when WebGPU is unavailable the engine boots a MINIMAL three.js WebGL renderer
// (render/webgl_fallback.js) — a colored heightmap of basic blocks, no lighting model / post /
// atmosphere — instead of the full WebGPU stack. This is the PURE decision that picks between the
// two boot paths, split out so it unit-tests with an injected navigator.gpu (no real GPU) and both
// engine.js and the tests share one home for "which backend".
//
// The DEEP capability probe (adapter score → tier) still lives in detect.js; this is only the coarse
// yes/no gate that runs BEFORE the renderer is created: navigator.gpu present at all + a forced
// override. A missing adapter (navigator.gpu present but requestAdapter() → null) is caught later by
// the WebGPU boot path itself (engine.js falls back on that too — see resolve_backend usage), so this
// pure fn only needs the presence bit + the force flag it can decide synchronously.

/** @typedef {'webgl' | 'webgpu'} RendererBackend */

/**
 * Picks the renderer backend from injected signals (pure, synchronous — no GPU touch).
 *
 * `webgl` when: the caller forces it (`force_webgl`, the demo's `?force_webgl=1` test lever), OR
 * `navigator.gpu` is absent (no WebGPU implementation in this browser at all). Otherwise `webgpu` —
 * the full stack is attempted, and a later adapter-request failure downgrades to webgl in the engine
 * boot (this fn can't await requestAdapter, so it decides on presence only).
 *
 * @param {object} signals
 * @param {unknown} signals.navigator_gpu the `navigator.gpu` value (or undefined) — presence is the
 *   only thing read; a truthy value means a WebGPU implementation exists to attempt.
 * @param {boolean} [signals.force_webgl] hard override (demo `?force_webgl=1`) — always picks webgl.
 * @returns {RendererBackend}
 */
export function pick_renderer_backend({ navigator_gpu, force_webgl = false }) {
  if (force_webgl) return 'webgl'
  if (navigator_gpu == null) return 'webgl'
  return 'webgpu'
}
