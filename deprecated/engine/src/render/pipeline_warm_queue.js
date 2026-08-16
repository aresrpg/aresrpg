// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// [C1 SLICED PIPELINE COMPILE — the residual warm freeze] Frame-budgeted pipeline warm for renderables
// that arrive AFTER the D221 boot pre-warm: entity/avatar/cosmetic GLBs (loaded async, post-login) whose
// first visible frame otherwise SYNC-compiles every scene-pass + shadow-depth pipeline variant on the
// main thread — the measured 4×-throttle ~5s one-time stall (BACKLOG C1). MAIN-THREAD LAW: distribute
// over frames.
//
// Mechanism (the far_field mount_pipeline_warmers pattern, generalized): a queued root is mounted INTO
// the live scene for exactly ONE rendered frame, epsilon-scaled with per-mesh frustum culling forced
// off, so the REAL composite render compiles its pipelines at the render path's own RenderContext —
// the only warm that works (engine.js D1 SHADER-DIET: a depth-0 renderer.compileAsync forges duplicate
// RenderObjects + fresh WGSL; RenderContexts key on callDepth). Epsilon scale, never zero: a zero world
// matrix collapses every vertex to clip w=0 (undefined rasterization) and makes the normal matrix
// singular — ε keeps the math finite while rasterizing zero pixels. `request_shadow_update` re-renders
// the sun shadow map during the warm frame so the rig's shadow-depth pipeline variants (castShadow
// entities) compile in the SAME sliced frame, not at the next terrain shadow re-bake.
//
// Budget: ≤1 entry mounts per tick — one first-use compile burst per frame (the S4 wall-clock spirit;
// a rig's materials compile together, so the rig is the atomic slice). flush_all() batches every
// pending entry into the D221 boot warm frame, where the veil hides the cost entirely.

/** Epsilon warm scale — degenerate (zero-pixel) but non-singular. */
const WARM_SCALE = 1e-6
/** Cap on named labels — see hitch_probe's report cap; here it bounds restore bookkeeping only. */

/**
 * @typedef {object} PipelineWarmQueue
 * @property {(root: import('three').Object3D) => Promise<void>} warm queue a DETACHED root; resolves
 *   after the frame that rendered it (its pipelines are then cached for the real mount).
 * @property {(key: string, root: import('three').Object3D) => Promise<void>} warm_once dedupe by key
 *   (one warm per GLB url per queue lifetime — a new renderer session gets a new queue = fresh cache).
 * @property {() => void} tick once per frame BEFORE the composite render: releases the previous warm
 *   frame's entries (resolving their promises) and mounts at most one pending entry.
 * @property {() => void} flush_all mounts EVERY pending entry now (the D221 boot warm frame — behind
 *   the veil the batch is free); the next tick releases them all.
 * @property {() => number} pending_count queued + mounted entries (diagnostics).
 * @property {() => void} dispose releases everything, restores entry state, resolves all promises —
 *   a torn-down engine must never hang a consumer await.
 */

/**
 * @param {object} opts
 * @param {import('three').Scene} opts.scene the live render scene (warm mounts ride the real frame).
 * @param {() => void} [opts.request_shadow_update] flips the sun shadow map dirty so caster depth
 *   pipelines compile inside the warm frame (engine wires sun.shadow.needsUpdate; optional for tests).
 * @returns {PipelineWarmQueue}
 */
export function create_pipeline_warm_queue({ scene, request_shadow_update }) {
  /** @typedef {{ root: any, resolve: () => void, restore: () => void }} Entry */
  /** @type {Entry[]} */
  const pending = []
  /** @type {Entry[]} */
  const mounted = []
  /** @type {Map<string, Promise<void>>} */
  const warmed_keys = new Map()
  let disposed = false

  /** Mount one entry for the coming render: epsilon scale + culling off, exact restore captured. */
  function mount(/** @type {Entry} */ entry) {
    const { root } = entry
    const prev_scale = root.scale.clone()
    /** @type {Array<{ mesh: any, culled: boolean }>} */
    const culling = []
    root.traverse((/** @type {any} */ object) => {
      if (!object.isMesh && !object.isSkinnedMesh) return
      culling.push({ mesh: object, culled: object.frustumCulled })
      object.frustumCulled = false // parked at its load-time position — never let the frustum skip the compile
    })
    root.scale.setScalar(WARM_SCALE)
    scene.add(root)
    entry.restore = () => {
      scene.remove(root)
      root.scale.copy(prev_scale)
      for (const { mesh, culled } of culling) mesh.frustumCulled = culled
    }
    mounted.push(entry)
    request_shadow_update?.() // compile the rig's shadow-depth variants in the same sliced frame
  }

  function release_mounted() {
    for (const entry of mounted) {
      entry.restore()
      entry.resolve()
    }
    mounted.length = 0
  }

  return {
    warm(root) {
      if (disposed) return Promise.resolve()
      return new Promise((resolve) => {
        pending.push({ root, resolve, restore: () => {} })
      })
    },

    warm_once(key, root) {
      const prior = warmed_keys.get(key)
      if (prior) return prior
      const p = this.warm(root)
      warmed_keys.set(key, p)
      return p
    },

    tick() {
      if (disposed) return
      release_mounted() // last frame rendered them — their pipelines are cached now
      const next = pending.shift()
      if (next) mount(next)
    },

    flush_all() {
      if (disposed) return
      while (pending.length > 0) mount(/** @type {Entry} */ (pending.shift()))
    },

    pending_count() {
      return pending.length + mounted.length
    },

    dispose() {
      if (disposed) return
      disposed = true
      release_mounted()
      for (const entry of pending) entry.resolve() // best-effort: never hang a consumer on a dead engine
      pending.length = 0
      warmed_keys.clear()
    },
  }
}

// ── Module registry — the seam the shared GLB factories reach without an engine handle ────────────
// (mob_model.js / character_avatar.js / worn_cosmetics.js are module-level SDKs, same idiom as their
// own module-level loader caches). engine.js registers the live queue at boot and clears it on dispose;
// with no queue registered every warm resolves immediately (unit tests / headless — behavior unchanged).

/** @type {PipelineWarmQueue | null} */
let active_queue = null

/** @param {PipelineWarmQueue | null} queue */
export function set_active_pipeline_warm_queue(queue) {
  active_queue = queue
}

/** Clear the registry ONLY if `queue` is still the active one — a tier-swap reboot may register the
 *  replacement session's queue before the old session's teardown runs (same guard shape as the cpu-span
 *  sink restore in hitch_probe.js). @param {PipelineWarmQueue} queue */
export function clear_active_pipeline_warm_queue(queue) {
  if (active_queue === queue) active_queue = null
}

/**
 * Warm `root`'s pipelines through the active queue, once per `key` (GLB url) per queue lifetime.
 * Resolves immediately when no queue is registered. The root must be DETACHED (not yet scene-mounted);
 * the caller mounts it for real after the resolve — every first-use pipeline is then a cache hit.
 * @param {string} key @param {import('three').Object3D} root @returns {Promise<void>}
 */
export function warm_pipelines_once(key, root) {
  return active_queue ? active_queue.warm_once(key, root) : Promise.resolve()
}
