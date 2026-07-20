// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SHOP COLOR VARIANT → GEM badge mapping — the SINGLE home for the cosmetic variant label: badges show
// elemental cosmetics as e.g. "lorito cloak [emerald]" instead of "air".
//
// WHY THIS EXISTS: a cosmetic's variant used to be shown as the raw parenthesized suffix of its on-chain
// Display name ("Lorito Cloak (Air)" → badge "AIR"). The former seed mixed ELEMENT words
// (air/fire/water/earth) and STAT words (agility/chance/strength/…), so the badges exposed two names for
// the same material variants. The seed now authors one GEM scheme; this table also translates legacy
// on-chain suffixes until the manual listing migration is complete.
//
// Suffixes are always the EN Display word (template_t has no name catalog — chain names are EN-only), so the
// table keys on the lowercased EN element or canonical gem label. Non-color variants pass through unchanged.

/** Lowercased authored element/gem → shop i18n gem key. */
export const VARIANT_GEM_KEY: Record<string, string> = {
  air: 'shop.gem_emerald',
  emerald: 'shop.gem_emerald',
  fire: 'shop.gem_ruby',
  ruby: 'shop.gem_ruby',
  water: 'shop.gem_sapphire',
  sapphire: 'shop.gem_sapphire',
  earth: 'shop.gem_amber',
  amber: 'shop.gem_amber',
  'rose quartz': 'shop.gem_rose_quartz',
  amethyst: 'shop.gem_amethyst',
}

const COSMETIC_LISTING_NAME_KEY: Record<string, string> = {
  'Momaku Mask': 'shop.cosmetic_momaku_cloak',
  'Momaku Cloak': 'shop.cosmetic_momaku_cloak',
  'Enka Muru Hood': 'shop.cosmetic_enka_muru_cloak',
  'Enka Muru Cloak': 'shop.cosmetic_enka_muru_cloak',
}

const LORITO_LEGACY_GEM_KEY: Record<string, string> = {
  agility: 'shop.gem_emerald',
  chance: 'shop.gem_sapphire',
  intelligence: 'shop.gem_ruby',
  strength: 'shop.gem_amber',
  vitality: 'shop.gem_rose_quartz',
  wisdom: 'shop.gem_amethyst',
}

const COSMETIC_LISTING_DESCRIPTION_KEY: Record<string, string> = {
  'A spirit-mask worn to frighten debtors and impress no one who is already dead.':
    'shop.cosmetic_momaku_cloak_description',
  'A spirit-mask banner draped down the back to frighten debtors and impress no one already dead.':
    'shop.cosmetic_momaku_cloak_description',
  'A traveller’s hood stitched for long roads and short conversations.': 'shop.cosmetic_enka_muru_cloak_description',
  'A traveller’s cloak stitched for long roads and short conversations.': 'shop.cosmetic_enka_muru_cloak_description',
}

/**
 * Resolve a cosmetic's variant badge/label. An ELEMENT variant becomes its localized GEM name; anything
 * else (stat words, colours, undefined) is returned unchanged. PURE.
 */
export function gem_variant_label(variant: string | undefined, t: (key: string) => string): string | undefined {
  if (!variant) return variant
  const key = VARIANT_GEM_KEY[variant.trim().toLowerCase()]
  return key ? t(key) : variant
}

/** Localize corrected cosmetic names and any canonical parenthesized gem suffix. PURE. */
export function localized_shop_name(name: string, t: (key: string) => string): string {
  const listing_key = COSMETIC_LISTING_NAME_KEY[name]
  if (listing_key) return t(listing_key)
  const match = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  if (!match) return name
  const legacy_key = match[1] === 'Lorito Cloak' ? LORITO_LEGACY_GEM_KEY[match[2].trim().toLowerCase()] : undefined
  const localized_variant = legacy_key ? t(legacy_key) : gem_variant_label(match[2], t)
  return localized_variant === match[2] ? name : `${match[1]} (${localized_variant})`
}

/** Localize corrected cloak descriptions, including the legacy live-template wording. PURE. */
export function localized_shop_description(description: string, t: (key: string) => string): string {
  const key = COSMETIC_LISTING_DESCRIPTION_KEY[description]
  return key ? t(key) : description
}
