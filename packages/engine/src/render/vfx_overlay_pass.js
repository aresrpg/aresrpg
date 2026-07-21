// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHT-VFX POST-AgX OVERLAY PASS — the display-space additive composite that makes the purchased BinbunVFX
// pack read as authored (fixes "vfx look like flat washed-out images, miles from the pack").
//
// THE ROOT CAUSE (pixel-proven fidelity capture): fight-cast VFX mount into the MAIN scene, and
// post_stack.js renderOutput() AgX-tonemaps the WHOLE composite — VFX included. AgX aggressively DESATURATES
// highlights, so the pack's saturated emissive glow (authored on BLACK, never tonemapped) rolls to washed-out
// WHITE over the pale board. `material.toneMapped=false` is a NO-OP (the tonemap is a whole-pass op, not per
// material), and no material blend (normal desaturates under AgX, additive whitens) can escape it. The pack's look
// is additive glow that BYPASSES tonemap — so the only faithful fix is to render the VFX in a SEPARATE pass and
// composite it AFTER AgX, in DISPLAY space, as additive coloured light.
//
// HOW (fits the node-graph RenderPipeline with ZERO renderer.js change): fight-cast handles route onto
// FIGHT_VFX_LAYER (vfx_preset_engine.route_overlay_group). The main scene pass uses the camera's DEFAULT layer
// mask (layer 0), so it AUTO-EXCLUDES layer 10 — the VFX never reach AgX. This module builds a second pass
// (`pass(scene, camera)` masked to ONLY layer 10) whose texture node, being referenced in the output graph,
// makes the pipeline render it every frame (PassNode.updateBefore). `composite()` then adds that pass's colour —
// sRGB-encoded so authored hues land on the display buffer exactly like the pack preview — onto the graded frame.
//
// DEPTH / SOFT PARTICLES: PassNode forces renderer.autoClear=true, so a SHARED depth attachment is impossible (the
// vfx pass would wipe the scene depth before testing). Instead the vfx pass keeps its OWN depth (materials depthWrite
// ON, depthTest OFF ⇒ full additive accumulation + a representative nearest-particle depth), and composite() fades the
// contribution against the MAIN pass depth. Both raw reversed-Z depths are linearised to view-space Z (perspectiveDepth-
// ToViewZ, reversed-Z-aware) and the additive light is scaled by smoothstep(0, FADE, gap) where gap = how far the quad
// sits IN FRONT of the scene surface. This does TWO jobs with ONE ramp: (a) OCCLUSION — a particle behind a mob/pillar
// (gap ≤ 0) contributes 0; (b) SOFT PARTICLES — a quad that approaches the surface (gap → 0) MELTS to zero instead of
// slicing the terrain with a hard "PNG-on-a-plane" edge (the reported defect). The old binary NEARER-or-not mask was the
// gap ≥ 0 special case of this general fade. A single representative depth per pixel is the standard additive-particle
// approximation; it needs NO cross-pass attachment sharing and is resolution-robust (medium's 0.66 taau scene pass is
// sampled by uv()). The view-Z near/far are the vfx PASS's OWN scene-camera uniforms (live in PassNode.updateBefore),
// which sidesteps the display-quad camera trap that forces post_stack to hand-plumb its scene-camera matrices.
//
// FENCE: ONLY the fight-cast preset family routes here (route_overlay_group). World ambience / gather sparkles /
// dust_puff stay in the AgX'd main pass — they are tuned for the world lighting, not the pack's fight bar.

import { Layers } from 'three'
import { float, pass, perspectiveDepthToViewZ, smoothstep, uniform, vec4 } from 'three/tsl'

import { smoothstep as smoothstep_scalar } from '../core/math_utils.js'

import { FIGHT_VFX_LAYER } from './vfx_preset_engine.js'

/** SOFT-PARTICLE fade band, in WORLD UNITS (view-space Z ≈ metres). The additive light ramps from 0 (quad coplanar
 *  with the scene surface behind it) to full over this depth gap, so a billowing quad DISSOLVES into the terrain it
 *  crosses instead of showing a hard intersection line (fixes "PNG pasted on the terrain"). Also
 *  softens occluder edges (a glow emerges over ~this depth as it clears a wall). Tuned on the fight board so the flame
 *  base melts into the floor without eating the visible body; larger = more melt, smaller = crisper (was a hard 1e-4
 *  reversed-Z occlusion bias — the binary cut this fade generalises). */
const SOFT_FADE_DIST = 0.4

/**
 * The soft-particle depth-fade mask from a view-space gap (vfx viewZ − scene viewZ), mirroring the TSL
 * `composite()` math op-for-op (JS reference for the unit tests — same idiom as particles.js's
 * `sprite_falloff`; this function is NOT itself called by the shader, the TSL graph below mirrors it).
 *
 * #158 BACKEND-ROBUSTNESS: FAILS OPEN. A non-finite gap (NaN/±Infinity — e.g. `perspectiveDepthToViewZ`
 * dividing by a degenerate near≈far, or a backend depth-format mismatch corrupting the sampled depth —
 * renderer.js's reversedDepthBuffer correction fixes the known cause, this is the belt-and-suspenders
 * layer for any OTHER way the comparison goes degenerate) resolves to FULL VISIBILITY instead of
 * collapsing the mask to 0. A fade/occlusion miss is a cosmetic error (a particle reads unfaded through
 * a wall); an invisible fight-VFX pack is a functional one — never invert that priority.
 * @param {number} gap @param {number} [fade_dist] @returns {number} mask ∈ [0,1]
 */
export function depth_fade_mask(gap, fade_dist = SOFT_FADE_DIST) {
  return Number.isFinite(gap) ? smoothstep_scalar(0, fade_dist, gap) : 1
}

/** Display-space additive GAIN. The pack's emission (authored 1.6–2.2 for the AAA
 *  main-pass accumulation) ACCUMULATES across overlapping additive particles far past 1.0; added at full strength
 *  over the pale board it saturates every channel → the washed-out WHITE defect (now in display space
 *  instead of via AgX). Damping the ADD lands the coloured body under 1.0 so hue reads (fire orange, water blue,
 *  air cyan) while the concentrated core still clips to a white-hot centre — the pack's coloured-body + hot-core
 *  read. ONE global knob (live: window.__vfx_overlay.gain.value), NOT a per-preset re-tune. Measured on the fight
 *  board (bolt_air/fire/water sweep): 0.3 keeps fire's orange body + white-hot core without blowout, water/air read. */
const OVERLAY_GAIN = 0.3

/**
 * @typedef {object} VfxOverlay
 * @property {(out: *) => *} composite wraps the graded display-space vec4 — adds the depth-masked, sRGB-encoded
 *   fight-VFX light. Call it inside build_output (safe to re-call on a graph rebuild — it only wires nodes).
 * @property {*} gain the display-space additive-gain uniform (live knob — window.__vfx_overlay.gain).
 * @property {() => void} dispose releases the overlay pass's render target.
 * @property {*} vfx_pass the underlying PassNode (bench/probe handle).
 */

/**
 * Build the fight-VFX post-AgX overlay. Creates the isolated layer-10 pass ONCE (outside build_output so a godrays
 * remount never leaks a second pass); composite() is the per-build wiring.
 * @param {object} opts
 * @param {import('three').Scene} opts.scene the main scene (fight VFX live on it, on FIGHT_VFX_LAYER)
 * @param {import('three').Camera} opts.camera the scene camera (shared — same view/proj as the main pass)
 * @param {*} opts.scene_depth the MAIN scene pass depth texture node (post_stack: scene_pass.getTextureNode('depth'))
 * @returns {VfxOverlay}
 */
export function create_vfx_overlay({ scene, camera, scene_depth }) {
  const vfx_pass = pass(scene, camera)
  const only = new Layers()
  only.set(FIGHT_VFX_LAYER) // render ONLY the fight-cast overlay layer (everything else is the main pass's job)
  vfx_pass.setLayers(only)

  // NO SKY IN THE OVERLAY (2026-07-14 recompile-storm root fix, probe-convicted). three's Background draws
  // `scene.backgroundNode` into EVERY scene render, IGNORING the pass's layer mask (renderers/common/
  // Background.js unshifts the skybox mesh unconditionally). So the sky sphere is drawn into this isolated
  // layer-10 pass too — pure waste (composite()'s depth fade masks it to ~0) AND the cause of a per-frame
  // pipeline RECOMPILE STORM: this pass sets up 0 lights while the main scene pass sets up 3, so the SHARED
  // sky RenderObject's dynamic cache key (three's `Nodes.getCacheKey(scene, lightsNode)`) ping-pongs between
  // the two passes every frame → three dispose()s + rebuilds that RenderObject → the 23 KB background WGSL
  // re-compiles ~twice per frame forever (measured ~1900 redundant compiles/boot at low tier — the top
  // remaining boot-compile churn). Suppress the background for THIS pass only by nulling it across the pass's
  // own scene render (restored in the same synchronous updateBefore, so the MAIN pass still draws the sky
  // normally). Result: no sky sphere in the overlay ⇒ a stable single-light-config RenderObject ⇒ ONE compile,
  // and the pass finally is what its header claims — isolated VFX light on black. Node-based background only
  // (scene.backgroundNode); scene.background is nulled too for a belt-and-braces classic-background guard.
  const orig_update_before = vfx_pass.updateBefore.bind(vfx_pass)
  vfx_pass.updateBefore = (/** @type {*} */ frame) => {
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

  const vfx_color = vfx_pass.getTextureNode() // additive accumulation on black (the isolated VFX light)
  const vfx_depth = vfx_pass.getTextureNode('depth') // representative nearest-particle depth (materials depthWrite ON)
  // The vfx pass's OWN scene-camera near/far uniforms (PassNode sets these from its camera every frame in
  // updateBefore) — the reversed-Z→viewZ linearisation the soft-particle fade needs, WITHOUT tripping the display-quad
  // camera trap that makes the built-in cameraNear/Far nodes bind the wrong (ortho quad) camera in the output graph.
  const cam_near = /** @type {any} */ (vfx_pass)._cameraNear
  const cam_far = /** @type {any} */ (vfx_pass)._cameraFar
  const u_gain = uniform(OVERLAY_GAIN)
  if (typeof window !== 'undefined') /** @type {any} */ (window).__vfx_overlay = { gain: u_gain } // live-tuning knob (console access)

  return {
    composite(out) {
      // SOFT-PARTICLE DEPTH FADE (generalises the old binary occlusion mask). Linearise both depths to view-space Z
      // (perspectiveDepthToViewZ is reversed-Z-aware; viewZ ∈ [−near,−far], NEARER = larger) and take the gap by which
      // the representative particle sits IN FRONT of the scene surface behind it. smoothstep(0, FADE, gap): gap ≤ 0 ⇒ 0
      // (particle occluded — behind geometry); gap → 0 ⇒ fade to 0 (the quad MELTS into terrain it crosses, killing the
      // hard PNG-slice line); gap ≥ FADE ⇒ full. Where no particle drew, vfx_color is black ⇒ the factor is moot.
      const gap = perspectiveDepthToViewZ(vfx_depth.r, cam_near, cam_far).sub(
        perspectiveDepthToViewZ(scene_depth.r, cam_near, cam_far)
      )
      // FAIL-OPEN GUARD (#158, depth_fade_mask — unit-tested JS mirror above). `gap.notEqual(gap)` is
      // the IEEE-754 NaN test (NaN is the only float that compares unequal to itself): on a genuine NaN
      // gap the mask opens to fully VISIBLE instead of smoothstep's otherwise-degenerate result.
      const soft = gap.notEqual(gap).select(float(1), smoothstep(0, SOFT_FADE_DIST, gap))
      // ADD the isolated VFX as display-space light: the authored linear colour, damped by the gain (so the coloured
      // body reads instead of blowing to white), added straight onto the graded sRGB frame. Adding LINEAR values (no
      // sRGB lift) keeps the faint billboard fringe near-zero ⇒ no grey-quad halo; only real energy brightens.
      const light = vfx_color.rgb.mul(u_gain).mul(soft)
      return vec4(out.rgb.add(light), 1)
    },
    gain: u_gain,
    dispose() {
      vfx_pass.dispose?.()
    },
    vfx_pass,
  }
}
