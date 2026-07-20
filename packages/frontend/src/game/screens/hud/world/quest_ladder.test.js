// Quest-ladder pure-core tests: the detection reducer (event → advance/progress, strictly sequential +
// cascade), skip semantics, and the versioned localStorage round-trip. Pure module → a plain in-memory
// localStorage shim, ZERO mock.module (process-global collision law).

import { afterAll, beforeEach, describe, expect, it } from 'bun:test'

import {
  QUESTS,
  QUEST_COUNT,
  TARGET_INGREDIENTS,
  TARGET_TOOL,
  QUESTS_STORAGE_KEY,
  active_index,
  count_owned,
  dismiss_all,
  fresh_progress,
  is_hidden,
  load_progress,
  loot_progress,
  mark_skipped,
  reduce_signal,
  save_progress,
} from './quest_ladder.js'

// ── localStorage shim (bun:test has no DOM storage) ──────────────────────────────────────────────
const real = globalThis.localStorage
beforeEach(() => {
  const store = new Map()
  globalThis.localStorage = /** @type {any} */ ({
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  })
})
afterAll(() => {
  globalThis.localStorage = real
})

// A bag row shaped like s.sui.items (item_type = template slug, amount = stack size).
const row = (item_type, amount = 1) => ({ id: `${item_type}-${amount}-${Math.random()}`, item_type, amount })

/** A bag that exactly satisfies the target recipe. */
const full_mats = () => TARGET_INGREDIENTS.map((i) => row(i.id, i.qty))

/** Drive the whole chain in order, returning the final progress. */
function run_full(progress) {
  let p = progress
  const step = (signal, items) => {
    p = reduce_signal(p, signal, items).progress
  }
  step({ kind: 'fight_won' }, [])
  step({ kind: 'items' }, full_mats())
  step({ kind: 'items' }, [row(TARGET_TOOL)])
  step({ kind: 'equip' }, [])
  step({ kind: 'gather' }, [])
  return p
}

describe('quest_ladder pure core', () => {
  it('the chain follows the specified 5 steps in order', () => {
    expect(QUEST_COUNT).toBe(5)
    expect(QUESTS.map((q) => q.kind)).toEqual(['fight_won', 'loot', 'craft', 'equip', 'gather'])
    expect(TARGET_TOOL).toBe('basic_pickaxe')
    expect(TARGET_INGREDIENTS.length).toBeGreaterThan(0)
  })

  it('fresh progress starts at quest 1, nothing resolved', () => {
    const p = fresh_progress()
    expect(active_index(p)).toBe(0)
    expect(is_hidden(p)).toBe(false)
    expect(p.done.every((d) => d === false)).toBe(true)
  })

  it('count_owned sums stacked amounts across rows', () => {
    const items = [row('jade', 3), row('jade', 2), row('crude_branch', 1)]
    expect(count_owned(items, 'jade')).toBe(5)
    expect(count_owned(items, 'crude_branch')).toBe(1)
    expect(count_owned(items, 'nothing')).toBe(0)
  })

  it('loot_progress caps have at need and reports met', () => {
    const partial = loot_progress([row(TARGET_INGREDIENTS[0].id, 1)])
    expect(partial.met).toBe(false)
    expect(partial.rows[0].have).toBe(1)
    const over = loot_progress(TARGET_INGREDIENTS.map((i) => row(i.id, i.qty + 10)))
    expect(over.met).toBe(true)
    // have is capped at need (no overflow past 100%)
    expect(over.have).toBe(over.need)
  })

  it('fight_won advances only quest 1', () => {
    const { progress, completed } = reduce_signal(fresh_progress(), { kind: 'fight_won' }, [])
    expect(completed).toEqual([0])
    expect(active_index(progress)).toBe(1)
  })

  it('is strictly sequential — an items signal before the fight is won is a no-op', () => {
    const { progress, completed } = reduce_signal(fresh_progress(), { kind: 'items' }, full_mats())
    expect(completed).toEqual([])
    expect(active_index(progress)).toBe(0)
  })

  it('loot completes only when every ingredient count is met', () => {
    let p = reduce_signal(fresh_progress(), { kind: 'fight_won' }, []).progress // now on loot
    // omit the first ingredient's row entirely (rather than qty-1) so this holds even when qty is 1 —
    // a row with amount 0 would hit count_owned's non-stackable fallback (treats amount<=0 as "1 owned").
    const short = TARGET_INGREDIENTS.flatMap((i, idx) => (idx === 0 ? [] : [row(i.id, i.qty)]))
    p = reduce_signal(p, { kind: 'items' }, short).progress
    expect(active_index(p)).toBe(1) // still on loot — not enough
    p = reduce_signal(p, { kind: 'items' }, full_mats()).progress
    expect(active_index(p)).toBe(2) // advanced to craft
  })

  it('craft completes when the tool appears in the bag', () => {
    let p = fresh_progress()
    p = reduce_signal(p, { kind: 'fight_won' }, []).progress
    p = reduce_signal(p, { kind: 'items' }, full_mats()).progress // loot done → on craft
    expect(active_index(p)).toBe(2)
    p = reduce_signal(p, { kind: 'items' }, [row(TARGET_TOOL)]).progress
    expect(active_index(p)).toBe(3) // on equip
  })

  it('equip then gather completes the chain', () => {
    const done = run_full(fresh_progress())
    expect(active_index(done)).toBe(QUEST_COUNT)
    expect(is_hidden(done)).toBe(true)
    expect(done.done.every(Boolean)).toBe(true)
  })

  it('CASCADE: winning a fight with the mats already in the bag completes fight AND loot at once', () => {
    const { completed, progress } = reduce_signal(fresh_progress(), { kind: 'fight_won' }, full_mats())
    expect(completed).toEqual([0, 1])
    expect(active_index(progress)).toBe(2) // straight to craft
  })

  it('skip advances without completing (no done flag) and hides once everything is skipped', () => {
    let p = fresh_progress()
    p = mark_skipped(p, active_index(p)) // skip quest 1
    expect(p.done[0]).toBe(false)
    expect(p.skipped[0]).toBe(true)
    expect(active_index(p)).toBe(1)
    for (let i = 1; i < QUEST_COUNT; i++) p = mark_skipped(p, active_index(p))
    expect(is_hidden(p)).toBe(true)
  })

  it('a signal for the skipped active quest does not complete a later quest out of order', () => {
    let p = mark_skipped(fresh_progress(), 0) // skip fight → loot active
    // a stray fight_won now should NOT complete loot (wrong signal for the active quest)
    p = reduce_signal(p, { kind: 'fight_won' }, full_mats()).progress
    expect(active_index(p)).toBe(1)
  })

  it('dismiss_all hides the card regardless of remaining quests', () => {
    expect(is_hidden(dismiss_all(fresh_progress()))).toBe(true)
  })

  it('a dismissed ladder folds no signals — no advance, no completion (never celebrates)', () => {
    const dismissed = dismiss_all(fresh_progress())
    const { progress, completed } = reduce_signal(dismissed, { kind: 'fight_won' }, full_mats())
    expect(completed).toEqual([])
    expect(progress).toBe(dismissed) // unchanged reference
  })

  it('persistence round-trips through localStorage and validates shape', () => {
    let p = reduce_signal(fresh_progress(), { kind: 'fight_won' }, []).progress
    p = mark_skipped(p, active_index(p))
    save_progress(p)
    expect(load_progress()).toEqual(p)
  })

  it('a malformed stored value degrades to a fresh start', () => {
    localStorage.setItem(QUESTS_STORAGE_KEY, '{"v":1,"done":[true],"skipped":[],"dismissed":"nope"}')
    expect(load_progress()).toEqual(fresh_progress())
    localStorage.setItem(QUESTS_STORAGE_KEY, 'not json{')
    expect(load_progress()).toEqual(fresh_progress())
  })
})
