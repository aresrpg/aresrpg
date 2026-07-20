// CF-B (client half) — MOUNT = +50% roam movement speed. A character with a mount equipped moves ×1.5
// in the roam world. SINGLE home for the multiplier VALUE and the equip → scale SELECTION; the value is
// applied at exactly one place downstream (the controller's ground-speed knob, via embed_voxel's
// set_input `speed_scale`). The mount surfaces on the character the SAME shape as pet/title —
// `character.mount` is the equipped item object (present ⇒ mounted) — so this reads the generic
// equipped-by-slot field the on-chain equip plumbing already populates; no new read code.

/** The mount's roam-speed bonus: +50%. */
export const MOUNT_SPEED_MULTIPLIER = 1.5

/**
 * The roam ground-locomotion scale for a character: {@link MOUNT_SPEED_MULTIPLIER} when a mount is
 * equipped, else 1. A slot counts only when it holds an item-like value (an object carrying an `id`) —
 * matching has_equipped_items, so a null/absent slot or a stray scalar named `mount` never grants the
 * bonus. Pure; safe on a null/partial character (→ 1).
 * @param {any} character @returns {number}
 */
export function mount_speed_multiplier(character) {
  const mount = character?.mount
  const equipped = mount != null && typeof mount === 'object' && mount.id != null
  return equipped ? MOUNT_SPEED_MULTIPLIER : 1
}
