// Display-only spell rosters per class — class-id → spell list (name + public icon path).
// No combat logic here; the HUD spellbar reads this to render icons. Art lives in public/spells/<class>/.
// Ported from aresrpg-legacy dapp's spells_per_class.js. Only senshi + yajin have art yet.

/** @type {Record<string, { name: string, icon: string }[]>} */
export const SPELLS_PER_CLASS = {
  senshi: [
    { name: 'Jump', icon: '/spells/senshi/jump.jpg' },
    { name: 'Rage', icon: '/spells/senshi/rage.jpg' },
    { name: 'Slash', icon: '/spells/senshi/slash.jpg' },
  ],
  yajin: [
    { name: 'Flying Soul', icon: '/spells/yajin/flying_soul.jpg' },
    { name: 'Trap', icon: '/spells/yajin/trap.jpg' },
    { name: 'Unfazed', icon: '/spells/yajin/unfazed.jpg' },
  ],
  yogen: [],
  tomoda: [],
}

/**
 * @param {string} class_id
 * @returns {{ name: string, icon: string }[]}
 */
export const spells_for_class = class_id => SPELLS_PER_CLASS[class_id] ?? []
