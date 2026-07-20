import { CLASSES } from './simulator'

/**
 * Override for which classes can wield a given weapon category.
 * When a category has an override, ONLY the listed classes are allowed
 * regardless of each class's native weapon binding.
 *
 * Used to enforce shared weapon chains where multiple classes use
 * the same physical item (e.g. all staff classes share TOKEI's chain).
 */
export const CATEGORY_CLASS_OVERRIDE: Record<string, string[]> = {
  STAFF: ['TOKEI'],
}

/** Allowed class IDs for a given item category. */
export function get_allowed_classes_for_category(category: string): string[] {
  if (category in CATEGORY_CLASS_OVERRIDE) return CATEGORY_CLASS_OVERRIDE[category]
  return CLASSES.filter((c) => c.weapon === category).map((c) => c.id)
}
