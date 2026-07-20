// Quest chain data + live-status helpers (NO JSX). The single home for the static tutorial chain
// (@aresrpg/sdk/quests, sorted by `order`) and the pure functions that fold the server-authoritative
// progress slice (core/modules/quests.js) into a per-quest status. Shared by the QuestsDrawer (the
// questbook UI) and the launcher badge (TopLaunchers) so "what counts as an actionable quest" lives
// in exactly one place — no drift between the badge number and the drawer.

import quests_content from '@aresrpg/sdk/quests'

// The static chain, sorted by `order` (the tutorial sequence). Computed once at module load.
export const QUEST_CHAIN = [...(quests_content.quests ?? [])].sort(
  (a, b) => a.order - b.order,
)

// Friendly objective verbs for the trackable triggers (monkey-brain clarity over the raw enum). Any
// trigger not listed falls back to a humanized form of its name.
const TRIGGER_LABEL = /** @type {Record<string, string>} */ ({
  MOB_KILL: 'Defeat monsters',
  LOOT_ITEM: 'Loot an item',
  ITEM_EQUIP: 'Equip gear',
  SPELL_CAST: 'Cast a spell',
  ITEM_CRAFT: 'Craft an item',
})

/** @param {string} trigger @returns {string} */
export const trigger_label = trigger =>
  TRIGGER_LABEL[trigger] ??
  trigger
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, m => m.toUpperCase())

/**
 * Resolve one quest's live status from the progress slice.
 * @param {{ id: string, required_count: number }} quest
 * @param {import('../../core/game.js').State['quests']} quests
 * @returns {{ trackable: boolean, count: number, completed: boolean, active: boolean, blocked: boolean }}
 */
export function quest_status(quest, quests) {
  const entry = quests?.progress?.[quest.id]
  const trackable = entry !== undefined
  const count = Math.min(quest.required_count, entry?.count ?? 0)
  const completed = !!entry?.completed
  const active = !completed && trackable && quests?.active_quest_id === quest.id
  return { trackable, count, completed, active, blocked: !trackable }
}

/**
 * Count of quests the player can act on RIGHT NOW — server-trackable objectives that are not yet
 * completed. Honest + data-driven: reads the same progress slice the drawer renders, returns 0 when
 * progress is unfetched (no fabricated numbers) and naturally drops to 0 once every quest is done.
 * This drives the corner notification badge on the Quests launcher (c149).
 * @param {import('../../core/game.js').State['quests']} quests
 * @returns {number}
 */
export function count_actionable_quests(quests) {
  if (!quests?.progress) return 0
  return QUEST_CHAIN.reduce((n, quest) => {
    const { trackable, completed } = quest_status(quest, quests)
    return trackable && !completed ? n + 1 : n
  }, 0)
}
