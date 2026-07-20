// SEAM 8 — COSMETIC HEAD-SLOT PRECEDENCE (SPEC §7.11: "an equipped cosmetic hat renders INSTEAD of the
// combat helmet's appearance; the cloak is purely visual").
//
// The single home for the head-slot appearance decision, consumed when the character avatar
// (player/character_avatar.js mounts on the 'Head' bone) or the fight entity rig chooses what geometry to
// put on a character's head. Precedence: cosmetic HAT > combat HELMET > HAIR (the no-helmet path). No
// three, no chain — a plain precedence over already-resolved appearance handles (a GLB url, an appearance
// id, whatever the caller mounts), so it stays pure + headless-testable and both render sites agree.
//
// Note (S-18 wiring): the frontend currently conflates helmet+hat into one legacy "head slot"
// (inventory-equip.js "helmet == hat"); SPEC §10/§7.11 make them distinct (17 combat slots incl. helmet +
// 3 cosmetic slots incl. hat) with the hat winning the RENDER. This resolver is that SPEC rule's home for
// the rewire to adopt. The cloak needs no resolution (no combat back-slot conflicts it) — it always shows.

/**
 * Resolve which head appearance to render, honouring the cosmetic-over-combat precedence. `null`/`undefined`
 * means "that slot is empty". Any non-nullish value (a GLB url, an appearance id…) is treated as present;
 * the resolver is agnostic to what the handle IS — it only decides WHICH slot wins.
 *
 * @template T
 * @param {{ hat?: T|null, helmet?: T|null, hair?: T|null }} [slots]
 * @returns {{ appearance: T|null, source: 'hat' | 'helmet' | 'hair' | 'none' }}
 *   `appearance` = the handle to mount (null when the head is bare); `source` = which slot won, so the
 *   caller knows e.g. to suppress hair under a helmet, or to route a cosmetic GLB vs a vanilla appearance.
 */
export function resolve_headgear(slots = {}) {
  const { hat, helmet, hair } = slots
  if (hat != null) return { appearance: hat, source: 'hat' }
  if (helmet != null) return { appearance: helmet, source: 'helmet' }
  if (hair != null) return { appearance: hair, source: 'hair' }
  return { appearance: null, source: 'none' }
}
