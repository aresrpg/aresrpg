// Pure selectors over the fight-spell SSOT rows (fight-spells.js `resolve_class_spells` / `class_spells`
// output). The deck, the level-up card, and the build planner all derive "which spells are unlocked / newly
// unlocked" from HERE, so the `unlock_level <= level` filter has ONE home and NO per-level cap: the legacy
// classes.json `{ level -> ONE id }` map could hold a single spell per level; these selectors surface EVERY row
// at a shared unlock level, so the ceremony's three starters at unlock_level 1 all render at L1 (slots 0/1/2).
// Pure over the row list (no JSON / i18n / sdk import) so the multi-spell-per-unlock case is unit-testable
// against a synthetic fixture — the ceremony reality the shipped testnet seed (senshi 1/5/10) can't yet show.

/** @typedef {import('./fight-spells.js').FightSpell} FightSpell */

/**
 * The freshest spell unlocked in (before, ∞] from a level-filtered, unlock-ascending `rows` list
 * (`resolve_class_spells` output — every spell with unlock_level ≤ char level, sorted ascending): the last row
 * whose `unlock_level > before`, or null. When several spells share the crossed unlock level the freshest slot
 * wins (the level-up card shows one spell). Pure so "N unlock at one level" is testable.
 * @param {FightSpell[]} rows @param {number} before @returns {FightSpell | null}
 */
export const newly_unlocked = (rows, before) => {
  const fresh = rows.filter(s => s.unlock_level > before)
  return fresh.length ? fresh[fresh.length - 1] : null
}

/**
 * The class roster for the build planner: SSOT rows → `{ unlock, id (name_key), name }`, unlock-ascending (the
 * caller's lock test is `level < unlock`). Pure over `rows` (`class_spells` output) so three rows at
 * unlock_level 1 map to three entries the planner shows unlocked at L1 by construction.
 * @param {FightSpell[]} rows @returns {{ unlock: number, id: string, name: string }[]}
 */
export const roster_from_rows = rows =>
  rows.map(sp => ({ unlock: sp.unlock_level, id: sp.name_key, name: sp.name }))
