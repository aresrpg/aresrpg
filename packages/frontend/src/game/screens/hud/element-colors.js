// SSOT for the fight VFX + floating-number colours: the house element ramp (fire/water/earth/air)
// plus the combat semantic colours (damage/heal/crit + the AP/MP resource-spend colours). One canonical
// home so the fight overlay, deck, encyclopedia and item views stop each carrying a drifted copy.
//
// Element keys are LOWERCASE canonical; the helpers are CASE-INSENSITIVE because the sim emits UPPERCASE
// ('FIRE') while the content/templates use lowercase ('fire'). The values match every existing consumer,
// so the duplicate maps below can be pointed here in a later fold with zero visual change.
//
// CONSUMERS TO FOLD LATER (identical values, safe to re-point in a follow-up pass):
//   - screens/hud/encyclopedia-data.js  (ELEMENT_COLOR + element_color)
//   - screens/hud/item-view.js          (ELEMENT_COLOR)
//   - screens/hud/DeckCluster.jsx       (local ELEMENT_COLOR / NEUTRAL_COLOR)

/** The house element ramp + neutral — FIGHT-JUICE CANON (design spec_fight_juice §1): desaturated/filmic
 * fills, warm-nudged, never neon (the white outline + dark halo in fight-floats carry legibility, so the
 * FILL can be muted). Only crit stays a bright pop (COMBAT_COLORS.crit). */
export const ELEMENT_COLORS = /** @type {const} */ ({
  fire: '#e0664a', // muted ember
  water: '#6fa8d4', // soft ice (also the AP-spend hue)
  earth: '#c2a05e', // warm loam
  air: '#a9cf92', // sage, not lime
  neutral: '#a9b4c4',
})

/**
 * Combat semantic colours for floating numbers + resource spend. AP/MP match the HUD AP/MP glyph
 * colours (§10 of the fight-HUD spec); heal is the house green (supersedes the old
 * pink); crit is the gold glow tint used for the crit emphasis (scale + glow, not a damage-colour swap).
 */
export const COMBAT_COLORS = /** @type {const} */ ({
  damage: '#dc6058', // muted brick — neutral (non-elemental) damage
  heal: '#74c99a', // soft mint heal
  crit: '#f2c451', // gold — crit is the ONE allowed pop (contrast beat; size + glow carry the rest)
  ap: '#6fa8d4', // AP spend (matches the water/AP glyph)
  mp: '#78c39a', // MP spend (matches the MP arrow glyph)
})

/**
 * Case-insensitive element name to hex. Unknown / empty falls back to the neutral tint.
 * @param {string | null | undefined} element 'FIRE' | 'fire' | ... (sim UPPER, content lower)
 * @returns {string}
 */
export const element_color = element =>
  ELEMENT_COLORS[
    /** @type {keyof typeof ELEMENT_COLORS} */ (
      String(element ?? '').toLowerCase()
    )
  ] ?? ELEMENT_COLORS.neutral

/**
 * The floating DAMAGE-number colour: the spell element's colour, falling back to the neutral DAMAGE red
 * for a non-elemental / unknown hit. Crit is conveyed by scale + glow + a 'CRIT!' tag (see the float
 * spawner), never a colour swap, so the element identity stays readable on a crit.
 * @param {string | null | undefined} element
 * @returns {string}
 */
export const damage_color = element =>
  ELEMENT_COLORS[
    /** @type {keyof typeof ELEMENT_COLORS} */ (
      String(element ?? '').toLowerCase()
    )
  ] ?? COMBAT_COLORS.damage
