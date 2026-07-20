// The onboarding QUEST LADDER — PURE CORE (no React, no engine, no side effects). The single home for
// the 5-quest tutorial chain, its detection logic, and its versioned localStorage persistence. Split out
// of the runtime store (quest_ladder_store.js) so the whole reducer is unit-testable with a plain
// localStorage shim and ZERO mocks (bun mock.module process-global collision law).
//
// THE CHAIN (replaces the tooltip tour): win a fight → loot the materials for a starter
// tool → craft it → equip it → gather once. Client-only, zero Move changes: each step is detected off a
// signal the client already sees (a fight-result resolve, the s.sui.items bag, the equip/gather tx
// landing). Progress is latched + persisted so a completed step never un-completes when its evidence is
// consumed (crafting eats the looted mats; equipping moves the tool out of the bag).
//
// TARGET TOOL — basic_pickaxe: the true tier-1 starter tool (level 1, craft_xp 10, category tool_miner —
// jade_pickaxe is the L20 UPGRADE tier, not the starter). Its 6-language display name ships in the SDK
// item data. Changing the starter tool is a one-line TARGET_TOOL edit here.
//
// CONTENT DEPENDENCY (a starter tool must be BARE-HAND bootstrappable): basic_pickaxe
// needs crude_branch×2. It previously demanded a diamond — a MINER-gathered gem (gathering.move:145 hard-requires
// an equipped pickaxe, ENoTool) — i.e. the very tool this recipe makes: a circular deadlock in the original design.
// crude_branch is pure mob-loot: it drops @80% (1-2 per kill) from "Test Brute" (brute_mats) in the live QA seed,
// so quest 1 (win a fight) hands it over with ZERO gather/mining step. The recipe source of truth is
// @aresrpg/sdk/recipes (regenerated from seed/**); the disposable QA-chain Recipe object is re-seeded by
// seed_tier1_bootstrap.mjs (on-chain crafting is not yet wired — JobsDrawer FLAG, so the live Recipe object is
// unreachable and its immutability is moot). Detection here is SOURCE-AGNOSTIC (it counts owned items however
// acquired), so it stays correct if content later adds a shop/chest/gather source. Combat/craft/equip/gather
// detection are unaffected.

import recipes from '@aresrpg/sdk/recipes'
import items_data from '@aresrpg/sdk/items-data'

/** The starter tool the ladder targets (see header). */
export const TARGET_TOOL = 'basic_pickaxe'

/** The target recipe's raw ingredients `[{ id, qty }]`, read straight from the seed recipe (one home). */
export const TARGET_INGREDIENTS = (recipes?.[TARGET_TOOL]?.ingredients ?? []).map(
  ({ id, qty }) => ({ id, qty: Number(qty) || 0 }),
)

// item id → item record, for localized display names (each seed item carries `i18n.name.{fr,es,de,uk,ja}`
// plus the top-level English `name`). Built once at module load.
const ITEMS_BY_ID = new Map(
  (Array.isArray(items_data) ? items_data : Object.values(items_data ?? {}))
    .filter((/** @type {any} */ it) => it && it.id)
    .map((/** @type {any} */ it) => [it.id, it]),
)

/**
 * A seed item's display name in `lang` (falls back to English, then the raw id). SINGLE home for
 * localizing an ingredient / tool label on the objective card + the celebration toast.
 * @param {string} id @param {string} [lang] @returns {string}
 */
export function item_label(id, lang = 'en') {
  const it = ITEMS_BY_ID.get(id)
  if (!it) return id
  if (lang && lang !== 'en') return it.i18n?.name?.[lang] ?? it.name ?? id
  return it.name ?? id
}

/**
 * The ordered tutorial chain. `kind` names the detector:
 *   fight_won — a fight resolved as a win (bus `action/fight_result/resolve`)
 *   loot      — the target recipe's ingredient counts are all met in the bag (s.sui.items)
 *   craft     — the crafted target tool appears in the bag
 *   equip     — an equip tx landed (equip_actions.js)
 *   gather    — a gather tx landed (gather_actions.js)
 * @type {ReadonlyArray<{ id: string, kind: 'fight_won'|'loot'|'craft'|'equip'|'gather' }>}
 */
export const QUESTS = [
  { id: 'win_fight', kind: 'fight_won' },
  { id: 'loot', kind: 'loot' },
  { id: 'craft', kind: 'craft' },
  { id: 'equip', kind: 'equip' },
  { id: 'gather', kind: 'gather' },
]

export const QUEST_COUNT = QUESTS.length

// ── owned-item helpers (s.sui.items rows carry `item_type` = the template slug + `amount` = stack size) ──

/** Total owned units of a template slug across the bag (sums stacked `amount`). @returns {number} */
export function count_owned(items, item_type) {
  let n = 0
  for (const it of items ?? []) {
    if (it?.item_type !== item_type) continue
    const amount = Number(it.amount)
    n += Number.isFinite(amount) && amount > 0 ? amount : 1
  }
  return n
}

/** True when at least one bag row is that template slug. @returns {boolean} */
export function has_item_type(items, item_type) {
  return (items ?? []).some((it) => it?.item_type === item_type)
}

/**
 * Live loot progress toward the target recipe: per-ingredient `{ id, have (capped at need), need }` plus
 * `met` (all needs satisfied) and the summed `have/need` totals for a single overall readout.
 * @param {any[]} items @returns {{ rows: {id:string,have:number,need:number}[], met:boolean, have:number, need:number }}
 */
export function loot_progress(items) {
  const rows = TARGET_INGREDIENTS.map(({ id, qty }) => ({
    id,
    need: qty,
    have: Math.min(qty, count_owned(items, id)),
  }))
  const have = rows.reduce((s, r) => s + r.have, 0)
  const need = rows.reduce((s, r) => s + r.need, 0)
  return { rows, met: rows.every((r) => r.have >= r.need), have, need }
}

// ── progress model + versioned persistence (quality_pref.js idiom — pure localStorage, guarded, shape-validated) ──

/** localStorage key holding the ladder progress. Bump the suffix on any shape change. */
export const QUESTS_STORAGE_KEY = 'aresrpg_quests_v1'

/** @typedef {{ v: 1, done: boolean[], skipped: boolean[], dismissed: boolean }} QuestProgress */

/** A brand-new player's progress: quest 1 active, nothing done/skipped/dismissed. @returns {QuestProgress} */
export function fresh_progress() {
  return {
    v: 1,
    done: QUESTS.map(() => false),
    skipped: QUESTS.map(() => false),
    dismissed: false,
  }
}

/** @param {any} p @returns {boolean} */
function valid_shape(p) {
  return (
    !!p &&
    p.v === 1 &&
    Array.isArray(p.done) &&
    p.done.length === QUEST_COUNT &&
    Array.isArray(p.skipped) &&
    p.skipped.length === QUEST_COUNT &&
    typeof p.dismissed === 'boolean'
  )
}

/** Load persisted progress, migrating nothing and degrading any malformed/absent value to a fresh start. @returns {QuestProgress} */
export function load_progress() {
  try {
    const raw = localStorage.getItem(QUESTS_STORAGE_KEY)
    if (!raw) return fresh_progress()
    const p = JSON.parse(raw)
    if (!valid_shape(p)) return fresh_progress()
    return {
      v: 1,
      done: p.done.map(Boolean),
      skipped: p.skipped.map(Boolean),
      dismissed: !!p.dismissed,
    }
  } catch {
    return fresh_progress()
  }
}

/** Persist progress (best-effort; a full/unavailable store just won't survive reload). @param {QuestProgress} p */
export function save_progress(p) {
  try {
    localStorage.setItem(QUESTS_STORAGE_KEY, JSON.stringify(p))
  } catch {
    // ignore unavailable / full storage
  }
}

// ── pure progress transitions ──────────────────────────────────────────────────────────────────

/** The active quest index (first not-done, not-skipped), or QUEST_COUNT when every quest is resolved. */
export function active_index(p) {
  for (let i = 0; i < QUEST_COUNT; i++) if (!p.done[i] && !p.skipped[i]) return i
  return QUEST_COUNT
}

/** The card is hidden once the player dismissed it forever OR resolved every quest. @returns {boolean} */
export function is_hidden(p) {
  return p.dismissed || active_index(p) >= QUEST_COUNT
}

const set_at = (arr, i, v) => arr.map((x, j) => (j === i ? v : x))

/** @param {QuestProgress} p @param {number} i @returns {QuestProgress} */
export function mark_done(p, i) {
  return { ...p, done: set_at(p.done, i, true) }
}

/** @param {QuestProgress} p @param {number} i @returns {QuestProgress} */
export function mark_skipped(p, i) {
  return { ...p, skipped: set_at(p.skipped, i, true) }
}

/** @param {QuestProgress} p @returns {QuestProgress} */
export function dismiss_all(p) {
  return { ...p, dismissed: true }
}

/** Would the CURRENT bag already satisfy this quest? Only loot/craft are state-satisfiable (used for cascade). */
function state_satisfied(quest, items) {
  if (quest.kind === 'loot') return loot_progress(items).met
  if (quest.kind === 'craft') return has_item_type(items, TARGET_TOOL)
  return false
}

/** Does `signal` complete `quest` given the current bag? @returns {boolean} */
function signal_completes(quest, signal, items) {
  switch (quest.kind) {
    case 'fight_won':
      return signal.kind === 'fight_won'
    case 'loot':
      return signal.kind === 'items' && loot_progress(items).met
    case 'craft':
      return signal.kind === 'items' && has_item_type(items, TARGET_TOOL)
    case 'equip':
      return signal.kind === 'equip'
    case 'gather':
      return signal.kind === 'gather'
    default:
      return false
  }
}

/**
 * THE REDUCER (pure). Fold one detection `signal` into `progress`: if it completes the ACTIVE quest,
 * mark it done and CASCADE through any immediately-following state-satisfiable quests (so winning a fight
 * while the loot mats are already in the bag completes both at once, and no completion waits on a later
 * change that may never come). A signal that doesn't match the active quest is a no-op — the chain stays
 * strictly sequential. Returns the (possibly unchanged) progress + the list of indices completed THIS fold.
 * @param {QuestProgress} progress
 * @param {{ kind: 'fight_won'|'items'|'equip'|'gather' }} signal
 * @param {any[]} [items] the current bag (for loot/craft evaluation)
 * @returns {{ progress: QuestProgress, completed: number[] }}
 */
export function reduce_signal(progress, signal, items = []) {
  // A dismissed ladder ("skip all") folds no signals — the player opted out; nothing advances or celebrates.
  if (progress.dismissed) return { progress, completed: [] }
  let idx = active_index(progress)
  if (idx >= QUEST_COUNT) return { progress, completed: [] }
  if (!signal_completes(QUESTS[idx], signal, items)) return { progress, completed: [] }

  const completed = []
  let p = progress
  for (;;) {
    p = mark_done(p, idx)
    completed.push(idx)
    const next = active_index(p)
    if (next >= QUEST_COUNT || !state_satisfied(QUESTS[next], items)) break
    idx = next
  }
  return { progress: p, completed }
}
