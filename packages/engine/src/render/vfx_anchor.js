// FLAGSHIP VFX — the ENTITY ANCHOR (follow primitive). A persistent aura preset is a LOOP whose particles are
// placed in WORLD space by the runtime's `origin` uniform (NOT root.position — see vfx_preset_engine). So making
// an aura "ride the rig" is exactly the moving-emitter primitive the projectile already uses (fight_cast_vfx
// drives `origin` along a trajectory), generalised to FOLLOW an Object3D: each frame we copy the target's WORLD
// position (+ an optional body-local `lift`, mirroring the cast presets' chest/ground anchor) into `handle.origin`.
//
// The aura's body-local layout (torso-height offsets, the L1 ellipsoid, the L2 orbit) lives in the PRESET; this
// only tracks the entity's world transform, so the whole composition rides the body as it walks/animates. Follow a
// named BONE (opts.bone) to ride an animated skeleton joint (chest) instead of the entity root.
//
// TEARDOWN — REMOVE-ONLY on skeleton clones (SkeletonUtils law): detach() removes the aura Group from its parent
// and frees the AURA's OWN geometry/material (handle.dispose), but NEVER touches the entity's shared skeleton or
// skinned mesh — those outlive the aura. The aura Group is a sibling/child, never a skinned mesh sharing the rig.

import { Vector3 } from 'three'

/** @typedef {import('./vfx_preset_engine.js').VfxHandle} VfxHandle */

/**
 * Bind a persistent VFX handle to FOLLOW an entity: `update()` writes the target's world position (+ `lift`) into
 * the handle's `origin` uniform every frame, so the aura rides the rig. Mirrors the projectile moving-emitter
 * primitive. Nothing moves until you call `update()` in your frame loop (alongside `handle.update(dt)` for age).
 * @param {VfxHandle} handle a LOOP preset handle (create_vfx_preset) — its `origin`/`object3d`/`dispose`
 * @param {import('three').Object3D} target the entity root to follow
 * @param {{ lift?:number, bone?:import('three').Object3D }} [opts]
 *   `lift` = extra world-Y added to the tracked point (the chest/ground anchor choice); `bone` = follow this rig
 *   joint's world position instead of the entity root (ride an animated skeleton).
 * @returns {{ update:()=>void, detach:()=>void }}
 */
export function follow_entity(handle, target, opts = {}) {
  const lift = opts.lift ?? 0
  const source = opts.bone ?? target
  const scratch = new Vector3()
  return {
    update() {
      // getWorldPosition flushes the source's world matrix — the aura tracks the LIVE animated joint, not a cached xform.
      source.getWorldPosition(scratch)
      handle.origin.value.set(scratch.x, scratch.y + lift, scratch.z)
    },
    detach() {
      // REMOVE-ONLY: unparent the aura Group, then free the aura's own geo/mat. Never disposes the entity/skeleton.
      handle.object3d.parent?.remove(handle.object3d)
      handle.dispose()
    },
  }
}
