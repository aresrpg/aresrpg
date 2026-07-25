// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SEAM S4 (docs/design/simulator_rebuild_spec.md §3) — THE model-miss body.
//
// A fighter whose GLB cannot be resolved (a class or mob with no published model — the simulator can seat any
// of them, and the live board can outrun a catalog) used to reach the board as an EMPTY GROUP: the entity was
// tracked, moved and beaten in silence while the player saw nothing at all. This is that one miss-path's body:
// a team-tinted CAPSULE standing exactly where the avatar would, at the avatar's own board height, so a
// missing model reads as "we have no art for this one" instead of an invisible fighter.
//
// ONE HOME: board_entities mounts this on the single upsert branch that resolves no glb url, and every
// consumer of the board (the game, the simulator, the demo) inherits it. Feet sit at the group origin — the
// same contract the loaded avatar honours (model.position.y -= min_y) — so placement, walks and the entity
// anchor need no special case for a placeholder body. The POLICY (who gets one, how tall, what tint) is the
// pure `placeholder_body_of` below, so it is provable without the avatar loader's GLB.

import { CapsuleGeometry, Mesh, MeshStandardMaterial, Color } from 'three'

/** Fight-only player height; mob size is normally intrinsic and owned by create_mob_model. */
export const BOARD_PLAYER_HEIGHT = 1.4

/** A model-less MOB has no intrinsic size to read (the factory never ran) — stand it a touch taller than a
 *  player so the two placeholder bands stay tellable apart on the board. */
export const MOB_PLACEHOLDER_HEIGHT = 1.7

/** The un-teamed body tint (a caller that passes no team color) — cold slate, clearly not a real skin. */
const NEUTRAL_COLOR = 0x8a8fa3

/**
 * THE model-miss policy: an entity spec with no resolvable glb url gets a stand-in body; anything with a url
 * gets none (the real avatar loads). The team tint is the caller's `outline` hex for BOTH kinds — unlike the
 * outline shell, which mobs never wear.
 * @param {{ glb_variant?: string, kind?: string, outline?: number | null }} spec the entity_upsert spec
 * @returns {{ height: number, color: number | null } | null} null ⇒ no placeholder needed
 */
export const placeholder_body_of = (spec) =>
  spec?.glb_variant
    ? null
    : {
        height: spec?.kind === 'player' ? BOARD_PLAYER_HEIGHT : MOB_PLACEHOLDER_HEIGHT,
        color: spec?.outline ?? null,
      }

/**
 * Build the model-miss placeholder body.
 * @param {object} args
 * @param {number} args.height full body height in blocks (the avatar height this fighter would have had)
 * @param {number | null} [args.color] the fighter's team color; null ⇒ neutral slate
 * @returns {Mesh} a capsule whose FEET rest at y = 0, ready to be added under the avatar's root group
 */
export function create_capsule_placeholder({ height, color = null }) {
  const body_height = Number.isFinite(height) && height > 0 ? height : BOARD_PLAYER_HEIGHT
  const radius = body_height * 0.22
  // CapsuleGeometry(radius, length, …): total height = length + 2·radius, centred on the origin.
  const length = Math.max(0.01, body_height - radius * 2)
  const tint = new Color(color ?? NEUTRAL_COLOR)
  const mesh = new Mesh(
    new CapsuleGeometry(radius, length, 4, 12),
    new MeshStandardMaterial({
      color: tint,
      // faintly emissive so the stand-in still reads under the fight board's iso lighting
      emissive: tint.clone().multiplyScalar(0.25),
      roughness: 0.65,
      metalness: 0,
    })
  )
  mesh.position.y = body_height / 2 // feet at the group origin, exactly like a loaded avatar's model
  mesh.castShadow = true
  mesh.receiveShadow = false
  mesh.name = 'entity_placeholder'
  return mesh
}

/** Free a placeholder's own GPU buffers (it shares nothing with the avatar tree). @param {Mesh | null} mesh */
export function dispose_capsule_placeholder(mesh) {
  if (!mesh) return
  mesh.removeFromParent()
  mesh.geometry.dispose()
  const { material } = mesh
  if (Array.isArray(material)) for (const one of material) one.dispose()
  else material.dispose()
}
