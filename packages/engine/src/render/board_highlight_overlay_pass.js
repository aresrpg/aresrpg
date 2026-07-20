// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BOARD-HIGHLIGHT POST-AgX OVERLAY PASS — the display-space ALPHA composite that holds tactical board
// highlights colour-CONSTANT across the day↔night auto-exposure swing (reported: "highlight colors washed
// at night"). PRECEDENT-MIRROR of vfx_overlay_pass.js — same isolated-layer + post-AgX composite CLASS; the
// content differs (highlights are semi-transparent UI WASHES → alpha OVER, not the pack's additive glow).
//
// ROOT CAUSE (same family as the fight-VFX wash, pixel-proven there): board highlights already render UNLIT +
// fog-exempt (MeshBasicNodeMaterial, toneMapped=false, fog=false — board_highlight_materials.js), but they
// mount into the MAIN scene, and post_stack.renderOutput() AgX-tonemaps the WHOLE composite with a LIVE
// auto-exposure (auto_exposure.js drives renderer.toneMappingExposure across 0.85–1.4). At night the servo
// LIFTS exposure toward 1.4, pushing the highlight colour up into AgX's desaturating shoulder → the wash.
// material.toneMapped=false is a NO-OP here (the tonemap is a whole-pass op, see vfx_overlay_pass.js header),
// and no per-material blend escapes it. The faithful fix (proven by the VFX pack): render highlights in a
// SEPARATE pass and composite them AFTER AgX, in display space, at a FIXED exposure — the night swing then
// physically cannot reach them.
//
// LAYER: route_board_highlight_overlay moves every highlight mesh to BOARD_HIGHLIGHT_LAYER (11). The main
// scene pass, on the camera's DEFAULT layer-0 mask, auto-EXCLUDES it (never AgX-tonemaps a highlight); this
// pass, setLayers()'d to ONLY layer 11, isolates it. depthWrite ON + depthTest OFF (mirrors route_overlay_
// group): the pass records a representative floor-level depth for composite()'s occlusion mask, while the
// washes still BLEND by renderOrder (depthTest off ⇒ none occlude one another — the D150 layered-wash look is
// preserved). Blending stays UNCHANGED (NormalBlending) — highlights are alpha washes, not additive glow.
//
// COLOUR — DAYTIME INVARIANCE (cited transform chain). The scene's own output transform is
// renderOutput(col, AgX, sRGB) = toneMapping(AgX, LIVE_exposure) → linear→sRGB (post_stack:440). This overlay
// reproduces it at a FIXED exposure — toneMapping(AgX, EXPOSURE_BASELINE=1.1) → linear→sRGB — so a DAYTIME
// frame (the servo rests at the tuned 1.1, auto_exposure EXPOSURE_BASELINE) lands close to today while
// NIGHT no longer washes (the highlight is decoupled from the servo). Note the composite is post-AgX, so it
// alpha-blends a tonemapped wash OVER a tonemapped board — today blended BEFORE the shared tonemap; those two
// orders cannot be made byte-identical (that is the whole point — decoupling from the shared AgX), so
// "daytime unchanged" is a CLOSE match, not a bit-match. The pass texture is premultiplied (colour·α on a
// black clear); composite() un-premultiplies (ε-guarded — the OVER weight is α, so the divide is moot as
// α→0) BEFORE the non-linear tonemap, then does a standard OVER onto the graded sRGB frame. Live knob
// window.__highlight_overlay.exposure lets the screenshot rider grade it; for the punchier authored-sRGB look
// (D150 target: "punchy, never wishy-washy") the rider drops the toneMapping() wrap — a one-line pixel-pass
// choice, deferred here by design (no browser).
//
// OCCLUSION: composite() hides the wash where the MAIN scene surface sits IN FRONT of it (a fighter's body
// over a cell) — reproducing today's depthTest leg-occludes-wash read (board_highlights entity-anchor note)
// now that the wash left the main pass. A HARD step (not the VFX soft fade — a flat wash sits only ~0.07
// above the slab, which a wide fade would erase), matching today's binary depthTest. No tuned runtime number
// to guess ("never hardcode a runtime-dependent number" law).
//
// BACKGROUND SUPPRESSION (mirrors vfx_overlay_pass.js): three's Background draws scene.backgroundNode into
// EVERY scene render IGNORING the layer mask, so the sky would render into this isolated pass and ping-pong
// the shared sky RenderObject's light-config cache key (the recompile storm). Null it across THIS pass's own
// updateBefore only (restored synchronously — the main pass still draws the sky).

import { AgXToneMapping, Layers, LinearSRGBColorSpace, SRGBColorSpace } from 'three'
import { convertColorSpace, float, pass, perspectiveDepthToViewZ, step, toneMapping, uniform, vec4 } from 'three/tsl'

import { EXPOSURE_BASELINE } from './lighting/auto_exposure.js'

/** The dedicated scene LAYER board highlights render on when routed to the POST-AgX overlay. The main
 *  camera's default mask is layer 0, so the main scene pass AUTO-EXCLUDES this layer (never AgX-tonemaps a
 *  highlight); the overlay pass isolates it and composites it at a FIXED exposure so day and night read the
 *  same. NOT 0 (default) / 10 (FIGHT_VFX_LAYER) / 31 (webgl_fallback park) — layer 11 is otherwise unused. */
export const BOARD_HIGHLIGHT_LAYER = 11

/**
 * Route the board-highlight subtree onto the POST-AgX overlay: every mesh moves to BOARD_HIGHLIGHT_LAYER (so
 * the main pass auto-excludes it from AgX), depthWrite ON so the overlay pass records a representative floor
 * depth for composite()'s scene-occlusion mask, depthTest OFF so overlapping washes still BLEND by renderOrder
 * (the D150 layered look — none occlude one another). Blending is left UNCHANGED (NormalBlending — these are
 * alpha washes, NOT the VFX additive glow). PURE (mirrors route_overlay_group — traverse, touch only objects
 * with a material); idempotent; returns how many meshes were routed. The highlight controller calls it on
 * every mesh it creates (washes / traps / feel-cues / entity anchors) at creation.
 * @param {import('three').Object3D} root a highlight mesh or subtree (a flat Mesh, or the trap blob+spike Group)
 * @returns {number} meshes routed
 */
export function route_board_highlight_overlay(root) {
  let routed = 0
  root.traverse((/** @type {*} */ o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    if (mats.length === 0) return
    o.layers.set(BOARD_HIGHLIGHT_LAYER)
    for (const m of mats) {
      m.depthWrite = true // record a representative floor depth for the occlusion mask
      m.depthTest = false // overlapping washes still blend by renderOrder (none occlude one another)
    }
    routed += 1
  })
  return routed
}

/**
 * @typedef {object} HighlightOverlay
 * @property {(out: *) => *} composite wraps the graded display-space vec4 — composites the depth-masked,
 *   fixed-exposure-AgX board highlights OVER it. Call inside build_output AFTER renderOutput (safe to re-call
 *   on a graph rebuild — it only wires nodes).
 * @property {*} exposure the FIXED tonemap-exposure uniform (live knob — window.__highlight_overlay.exposure).
 * @property {() => void} dispose releases the overlay pass's render target.
 * @property {*} hl_pass the underlying PassNode (bench/probe handle).
 */

/**
 * Build the board-highlight post-AgX overlay. Creates the isolated layer-11 pass ONCE (outside build_output
 * so a godrays remount never leaks a second pass); composite() is the per-build wiring.
 * @param {object} opts
 * @param {import('three').Scene} opts.scene the main scene (highlights live on it, on BOARD_HIGHLIGHT_LAYER)
 * @param {import('three').Camera} opts.camera the scene camera (shared — same view/proj as the main pass)
 * @param {*} opts.scene_depth the MAIN scene pass depth texture node (post_stack: scene_pass.getTextureNode('depth'))
 * @returns {HighlightOverlay}
 */
export function create_highlight_overlay({ scene, camera, scene_depth }) {
  const hl_pass = pass(scene, camera)
  const only = new Layers()
  only.set(BOARD_HIGHLIGHT_LAYER) // render ONLY the board-highlight overlay layer
  hl_pass.setLayers(only)

  // NO SKY IN THE OVERLAY (mirrors vfx_overlay_pass.js's recompile-storm fix): three's Background draws
  // scene.backgroundNode into EVERY scene render ignoring the pass layer mask, so the sky sphere would render
  // into this isolated pass and ping-pong the shared sky RenderObject's light-config cache key (a per-frame
  // pipeline recompile). Suppress the background for THIS pass's own render only; restore it synchronously in
  // the same updateBefore so the MAIN pass still draws the sky normally.
  const orig_update_before = hl_pass.updateBefore.bind(hl_pass)
  hl_pass.updateBefore = (/** @type {*} */ frame) => {
    const saved_node = scene.backgroundNode
    const saved_background = scene.background
    scene.backgroundNode = null
    scene.background = null
    try {
      orig_update_before(frame)
    } finally {
      scene.backgroundNode = saved_node
      scene.background = saved_background
    }
  }

  const hl_color = hl_pass.getTextureNode() // premultiplied wash colour·α on black (NormalBlending over the clear)
  const hl_depth = hl_pass.getTextureNode('depth') // representative floor depth (materials depthWrite ON via route)
  // the pass's OWN scene-camera near/far (PassNode refreshes these from its camera each updateBefore) — the
  // reversed-Z→viewZ linearisation the occlusion mask needs, WITHOUT the display-quad camera trap.
  const cam_near = /** @type {any} */ (hl_pass)._cameraNear
  const cam_far = /** @type {any} */ (hl_pass)._cameraFar
  // FIXED tonemap exposure = the tuned rest point (EXPOSURE_BASELINE 1.1). Decoupling the highlight from
  // the LIVE servo exposure is the whole fix; a live knob lets the screenshot rider grade it.
  const u_exposure = uniform(EXPOSURE_BASELINE)
  if (typeof window !== 'undefined') /** @type {any} */ (window).__highlight_overlay = { exposure: u_exposure }

  return {
    composite(out) {
      // OCCLUSION (hard — today's binary depthTest reproduced): linearise both depths to view-space Z
      // (perspectiveDepthToViewZ is reversed-Z-aware; NEARER = larger) and show the wash ONLY where it sits IN
      // FRONT of the main scene surface (gap ≥ 0) — a flat wash is always in front of the slab it lies on, and
      // hidden under a fighter's body that is nearer. No fade band (a flat wash sits ~0.07 above the slab; a
      // wide fade would erase it — and there is no runtime number safe to guess here). Where no wash drew,
      // hl_color is black with α 0 ⇒ the OVER contribution is 0 regardless.
      const gap = perspectiveDepthToViewZ(hl_depth.r, cam_near, cam_far).sub(
        perspectiveDepthToViewZ(scene_depth.r, cam_near, cam_far)
      )
      const vis = step(0, gap) // 1 where the wash is in front of the scene surface, else 0 (occluded)
      const a = hl_color.a.mul(vis) // effective coverage after occlusion
      // Un-premultiply the authored linear colour (ε-guarded: the OVER weight is `a`, so any inaccuracy as
      // α→0 is multiplied by ~0), re-tonemap it with AgX at the FIXED baseline exposure, encode to sRGB —
      // reproducing the scene's daytime transform (renderOutput AgX→sRGB) FROZEN against the night swing.
      const lin = hl_color.rgb.div(hl_color.a.max(1e-4))
      const display = convertColorSpace(
        toneMapping(AgXToneMapping, u_exposure, lin),
        LinearSRGBColorSpace,
        SRGBColorSpace
      )
      // standard OVER onto the graded sRGB frame: out·(1−a) + display·a.
      return vec4(out.rgb.mul(float(1).sub(a)).add(display.mul(a)), 1)
    },
    exposure: u_exposure,
    dispose() {
      hl_pass.dispose?.()
    },
    hl_pass,
  }
}
