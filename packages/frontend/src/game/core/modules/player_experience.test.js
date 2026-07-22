// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// W2 — the rescue-path receipt: resume_dungeon's boot-rescue (dungeon_store.js) now announces a seated WON
// with `action/fight/ended { winner: 0 }` BEFORE its silent claim — the SAME event claim() fires — so this
// module must open FightResult PENDING off that event (the card then resolves from the claim's OWN settlement
// receipt — finish_result's ResultOpened dispatch, the one resolver per the 07-18 receipt-first law). Proves
// the module's half of that contract: the observe wiring (ended{winner:0} ⇒ dispatch fight_result/open) and
// the reducer (open ⇒ a PENDING slice).
import { EventEmitter } from 'events'

import { describe, expect, it } from 'bun:test'

import {
  merge_character_enrichment,
  reconcile_character_projection,
} from '../../../chain/fight_character_reconcile.js'
import { loot_from_rolled } from '../../../world-shell/fight_result_receipt.js'
import player_experience from './player_experience.js'

const make_module = (characters = [], options = {}) => {
  const events = new EventEmitter()
  /** @type {{ type: string, payload: any }[]} */
  const dispatched = []
  const mod = player_experience(options)
  mod.observe({
    events: /** @type {any} */ (events),
    dispatch: (type, payload) => dispatched.push({ type, payload }),
    get_state: () => ({ sui: { characters }, selected_character_id: characters[0]?.id ?? null }),
  })
  return { events, dispatched, mod }
}

describe('W2 — rescue-path dispatch opens fight_result PENDING', () => {
  it('ended{winner:0} dispatches fight_result/open at the curve FLOOR level 1 (never lvl 0)', () => {
    // REGRESSION ("character shows at lvl 0 instead of 1" on the victory card): a fresh 0-XP character (or
    // an absent active character → experience 0) must open the card at level 1 — the curve floor
    // (experience_to_level(0) === 1) — NEVER 0. The old `experience ? experience_to_level(experience) : 0`
    // short-circuited to 0 on any falsy (0) experience.
    const { events, dispatched } = make_module()
    events.emit('action/fight/ended', { winner: 0 })
    expect(dispatched).toEqual([{ type: 'action/fight_result/open', payload: { level: 1 } }])
  })

  it('a real 0-XP active character opens at level 1 (the first-fight case)', () => {
    const { events, dispatched } = make_module([{ id: '0xchar', name: 'hero', experience: 0 }])
    events.emit('action/fight/ended', { winner: 0 })
    expect(dispatched).toEqual([{ type: 'action/fight_result/open', payload: { level: 1 } }])
  })

  it('the open action folds to a PENDING slice (xp resolves later off the chain delta)', () => {
    const { mod } = make_module()
    const state = mod.reduce({ fight_result: null }, { type: 'action/fight_result/open', payload: { level: 4 } })
    expect(state.fight_result).toEqual({
      status: 'pending',
      xp: 0,
      level: 4,
      levels_gained: 0,
      points_gained: 0,
      loot: [],
      loot_units: null, // unknown until settlement lands (the card shows no loot skeletons yet)
    })
  })

  it('a FAILED rescue (winner 1) opens nothing — the silent-boot design stands', () => {
    const { events, dispatched } = make_module()
    events.emit('action/fight/ended', { winner: 1 })
    expect(dispatched).toEqual([])
  })
})

describe('post-settle Character freshness', () => {
  it('chain-direct base enrichment cannot overwrite live /v1 progression XP', () => {
    expect(
      merge_character_enrichment(
        {
          id: '0xchar',
          experience: 12_345,
          level: 9,
          vitality: 11,
          gear_vitality: 7,
          equipment_stats: { vitality: 3 },
          jobs: { miner: 10 },
        },
        { id: '0xchar', experience: 0, vitality: 7, gear_vitality: 0, equipment_stats: null }
      )
    ).toEqual({
      id: '0xchar',
      experience: 12_345,
      level: 9,
      gear_vitality: 7,
      equipment_stats: { vitality: 3 },
      jobs: { miner: 10 },
      vitality: 11,
    })
  })

  it('resolve bus event performs a fresh bounded refetch and replaces the shared roster row', async () => {
    let roster = [{ id: '0xchar', name: 'hero', experience: 0, level: 1, vitality: 7 }]
    const fetches = []
    let refresh_done
    const refresh_character = (target) => {
      refresh_done = reconcile_character_projection(target, {
        read_projection: async (character_id) => {
          fetches.push(character_id)
          return fetches.length === 1
            ? { id: character_id, name: 'hero', experience: 0, level: 1 }
            : { id: character_id, name: 'hero', experience: 75, level: 1 }
        },
        read_roster: () => roster,
        write_roster: (characters) => {
          roster = characters
        },
        map_projection: (row) => row,
        wait: async () => {},
      })
      return refresh_done
    }
    const { events } = make_module(roster, { refresh_character })

    events.emit('action/fight_result/resolve', {
      character_id: '0xchar',
      expected_experience: 75,
      xp: 75,
      level: 1,
    })
    await refresh_done

    expect(fetches).toEqual(['0xchar', '0xchar'])
    expect(roster[0]).toEqual({ id: '0xchar', name: 'hero', experience: 75, level: 1, vitality: 7 })
  })
})

// ── RECEIPT-FIRST LAW (overseer constitutional pointer, 07-18): the Victory gain derives from the RESULT
// RECEIPT and NOTHING else — finish_result's ResultOpened dispatch (dungeon_settlement.js) is the ONE resolver
// of the fight_result modal. The old /v1-delta home (STATE_UPDATED xp-diff resolving the modal while
// `awaiting_reward`) was a SECOND derivation racing the read layer — it dies by law. The roster-delta observer
// itself LIVES ON as pure projections (the +N XP toast, the level-up card) — those fire off the receipt-patched
// roster (apply_receipt_character) and cover non-fight xp (quests/admin grants), but they never resolve the modal.
describe('receipt-first law — /v1 roster deltas NEVER resolve the win modal (07-18)', () => {
  const roster_state = (experience) => ({
    sui: { characters: [{ id: '0xchar', name: 'hero', experience }], items: [] },
    selected_character_id: '0xchar',
  })

  it('RED 07-18: a STATE_UPDATED xp jump while the modal awaits dispatches NO fight_result/resolve (the delta home is dead)', () => {
    const { events, dispatched } = make_module([{ id: '0xchar', name: 'hero', experience: 100 }])
    events.emit('action/fight/ended', { winner: 0 }) // the win modal opens PENDING
    events.emit('STATE_UPDATED', roster_state(100)) // baseline seed
    events.emit('STATE_UPDATED', roster_state(223)) // the Wolfling's authored 123 xp lands via /v1
    expect(dispatched.filter((d) => d.type === 'action/fight_result/resolve')).toEqual([])
  })

  it('the "+N XP" toast projection survives the kill (the delta observer lives; only the resolver died)', async () => {
    const { events } = make_module([{ id: '0xchar', name: 'hero', experience: 100 }])
    const { event_toast_store } = await import('../toast.js')
    events.emit('STATE_UPDATED', roster_state(100))
    events.emit('STATE_UPDATED', roster_state(223))
    expect(event_toast_store.get().some((t) => t.title === '+123 XP')).toBe(true) // projected off the roster delta
  })
})

// ── SPOILS RECEIPT LAW (a bag-repaint bug once reported looted-pet loot that was actually the player's own
// inventory showing through): the victory card's loot derives from the RESULT RECEIPT ONLY
// (the FightResult's own `rolled` declaration, dispatched by finish_result/dungeon_settlement.js) — NEVER a
// /v1 bag diff. The old inventory-diff home (STATE_UPDATED items-delta while `awaiting_loot`) manufactured
// loot out of ANY bag repaint that outgrew its baseline: the D245 mid-fight transient (escrow hides the kiosk
// scan → items paints EMPTY → the not-awaiting branch CLEARED the baseline) followed by the post-settle full-bag
// repaint diffed the player's ENTIRE INVENTORY as "gained" — his own pet rendered as razkin loot. D771: the
// invented-state home dies; absent receipt data the card holds its skeletons, never a reconstruction.
describe('SPOILS = the RESULT RECEIPT ONLY — a bag repaint NEVER manufactures loot', () => {
  const bag_state = (/** @type {any[]} */ items) => ({
    sui: { characters: [], items },
    selected_character_id: null,
  })

  it('RED v30: the D245 empty-paint → win → full-bag repaint sequence dispatches NO bag-derived loot (his pet is not razkin spoils)', () => {
    const { events, dispatched } = make_module()
    // mid-fight D245 transient: the bag paints EMPTY while the fight runs (escrowed character → kiosk scan misses)
    events.emit('STATE_UPDATED', bag_state([]))
    events.emit('action/fight/ended', { winner: 0 }) // the win modal opens
    // post-settle repaint: the FULL bag lands — including the pet the player has owned since long before this fight
    events.emit('STATE_UPDATED', bag_state([{ item_type: 'modny_luk_pet', name: 'Modny Luk', amount: 1 }]))
    // receipt law: the observer never dispatches loot — finish_result's receipt dispatch is the ONE producer
    expect(dispatched.filter((d) => d.type === 'action/fight_result/loot')).toEqual([])
  })

  it('RED v30 (between-fights gain flavor): a bag that grew for ANY reason during the win window is not loot either', () => {
    const { events, dispatched } = make_module()
    events.emit('STATE_UPDATED', bag_state([{ item_type: 'modny_luk_pet', name: 'Modny Luk', amount: 1 }]))
    events.emit('action/fight/ended', { winner: 0 })
    // a gift/marketplace delivery lands mid-window — the bag grows, the fight owes NOTHING of it
    events.emit('STATE_UPDATED', bag_state([{ item_type: 'modny_luk_pet', name: 'Modny Luk', amount: 2 }]))
    expect(dispatched.filter((d) => d.type === 'action/fight_result/loot')).toEqual([])
  })
})

// loot_from_rolled — the ONE receipt→card mapper (FightResult.rolled → FightLoot lines). Replaces the dead
// items-diff describe block that used to pin the inventory-diff behavior here (its rows tested the forbidden
// mechanism itself — deleted with it, per the receipt law above).
describe('loot_from_rolled — the FightResult receipt maps to the card lines, X in → X out', () => {
  const templates = new Map([
    ['0xT_HIDE', { item_type: 'razkin_hide', name: 'Razkin Hide' }],
    ['0xT_FANG', { item_type: 'razkin_fang', name: 'Razkin Fang' }],
  ])

  it('receipt loot X (razkin rolls) → exactly X: slugs + names off the template map, qty carried', () => {
    expect(
      loot_from_rolled(
        [
          { item_template: '0xT_HIDE', qty: 2 },
          { item_template: '0xT_FANG', qty: 1 },
        ],
        templates
      )
    ).toEqual([
      { template_id: '0xT_HIDE', item_type: 'razkin_hide', name: 'Razkin Hide', amount: 2 },
      { template_id: '0xT_FANG', item_type: 'razkin_fang', name: 'Razkin Fang', amount: 1 },
    ])
  })

  it('duplicate template rolls AGGREGATE into one line', () => {
    expect(
      loot_from_rolled(
        [
          { item_template: '0xT_HIDE', qty: 1 },
          { item_template: '0xT_HIDE', qty: 2 },
        ],
        templates
      )
    ).toEqual([{ template_id: '0xT_HIDE', item_type: 'razkin_hide', name: 'Razkin Hide', amount: 3 }])
  })

  it('distinct RESOURCE templates stay distinct even when their item_type class is identical', () => {
    const resources = new Map([
      ['0xCORE', { item_type: 'resource', name: 'Obsidian Core' }],
      ['0xFIBER', { item_type: 'resource', name: 'Ancient Fiber' }],
    ])
    expect(
      loot_from_rolled(
        [
          { item_template: '0xCORE', qty: 2 },
          { item_template: '0xFIBER', qty: 1 },
        ],
        resources
      )
    ).toEqual([
      { template_id: '0xCORE', item_type: 'resource', name: 'Obsidian Core', amount: 2 },
      { template_id: '0xFIBER', item_type: 'resource', name: 'Ancient Fiber', amount: 1 },
    ])
  })

  it('a template the map cannot resolve keeps its RAW id as the key (D53 letter tile) — never dropped, never guessed', () => {
    expect(loot_from_rolled([{ item_template: '0xUNKNOWN', qty: 1 }], new Map())).toEqual([
      { template_id: '0xUNKNOWN', item_type: '0xUNKNOWN', name: '', amount: 1 },
    ])
  })

  it('zero-qty / empty / malformed rolls surface NO line (nothing owed → nothing shown)', () => {
    expect(loot_from_rolled([{ item_template: '0xT_HIDE', qty: 0 }], templates)).toEqual([])
    expect(loot_from_rolled([], templates)).toEqual([])
    expect(loot_from_rolled(undefined, templates)).toEqual([])
    expect(loot_from_rolled([{ qty: 3 }], templates)).toEqual([]) // no template id → no honest identity → no line
  })

  it('END-TO-END slice truth: receipt X folds into the card slice; the decoy bag pet Y never appears', () => {
    const mod = player_experience()
    const fold = (slice, type, payload) => mod.reduce({ fight_result: slice }, { type, payload }).fight_result
    let slice = fold(null, 'action/fight_result/open', { level: 4 })
    slice = fold(slice, 'action/fight_result/loot', {
      loot: loot_from_rolled([{ item_template: '0xT_HIDE', qty: 2 }], templates),
    })
    expect(slice.loot).toEqual([
      { template_id: '0xT_HIDE', item_type: 'razkin_hide', name: 'Razkin Hide', amount: 2 },
    ]) // X, exactly
    expect(JSON.stringify(slice)).not.toContain('modny') // the bag pet has NO path into the slice
  })
})

// ── SPOILS FLOOR RECONCILIATION (recap-truth lane leg②, CLIENT-INDEPENDENCE LAW §3 "reconcile INSIDE the
// reducer"): dungeon_settlement.js's finish_result may dispatch action/fight_result/loot TWICE per fight — an
// event-floor placeholder first (resolved:false, the instant the ResultOpened event's loot_units is known),
// the FightResult object read's real `rolled` declaration second (resolved:true) if/when that (already
// internally-retried) read lands. dungeon_settlement.test.js pins the DISPATCH SEQUENCE half of this contract;
// this pins the REDUCER half — the fold must never let a stale/duplicate floor regress already-resolved loot.
describe('action/fight_result/loot reconciliation — the event floor never regresses an already-resolved receipt (leg②)', () => {
  const mod = player_experience()
  const fold = (slice, type, payload) => mod.reduce({ fight_result: slice }, { type, payload }).fight_result

  it('RED-FIRST: a floor (resolved:false) dispatch alone renders SOMETHING — never stuck on the open-time empty []', () => {
    let slice = fold(null, 'action/fight_result/open', { level: 4 })
    expect(slice.loot).toEqual([]) // the true "neither landed" state — no fabricated tile
    slice = fold(slice, 'action/fight_result/loot', { loot: [{ item_type: '', name: '', amount: 3 }], resolved: false })
    expect(slice.loot).toEqual([{ item_type: '', name: '', amount: 3 }]) // a tile, the instant the event lands
  })

  it('richer (resolved:true) ADOPTS over an existing floor — the slow read reconciling behind', () => {
    let slice = fold(null, 'action/fight_result/open', { level: 4 })
    slice = fold(slice, 'action/fight_result/loot', { loot: [{ item_type: '', name: '', amount: 3 }], resolved: false })
    slice = fold(slice, 'action/fight_result/loot', {
      loot: [{ item_type: 'razkin_hide', name: 'Razkin Hide', amount: 3 }],
      resolved: true,
    })
    expect(slice.loot).toEqual([{ item_type: 'razkin_hide', name: 'Razkin Hide', amount: 3 }])
  })

  it('SAME-VERSION DISCARD: a stale/duplicate floor arriving AFTER the real dispatch never regresses it', () => {
    let slice = fold(null, 'action/fight_result/open', { level: 4 })
    slice = fold(slice, 'action/fight_result/loot', {
      loot: [{ item_type: 'razkin_hide', name: 'Razkin Hide', amount: 3 }],
      resolved: true,
    })
    slice = fold(slice, 'action/fight_result/loot', { loot: [{ item_type: '', name: '', amount: 3 }], resolved: false })
    expect(slice.loot).toEqual([{ item_type: 'razkin_hide', name: 'Razkin Hide', amount: 3 }]) // unchanged — discarded
  })

  it('a permanent read failure never wipes the floor: no second dispatch ever arrives, the floor stands', () => {
    let slice = fold(null, 'action/fight_result/open', { level: 4 })
    slice = fold(slice, 'action/fight_result/loot', { loot: [{ item_type: '', name: '', amount: 1 }], resolved: false })
    // (no further dispatch — the slow read exhausted its retries and gave up; nothing else ever fires)
    expect(slice.loot).toEqual([{ item_type: '', name: '', amount: 1 }])
  })

  it('two resolved:true dispatches back-to-back (rare, but never a false discard): the SECOND still adopts', () => {
    let slice = fold(null, 'action/fight_result/open', { level: 4 })
    slice = fold(slice, 'action/fight_result/loot', { loot: [{ item_type: 'a', name: 'A', amount: 1 }], resolved: true })
    slice = fold(slice, 'action/fight_result/loot', { loot: [{ item_type: 'b', name: 'B', amount: 1 }], resolved: true })
    expect(slice.loot).toEqual([{ item_type: 'b', name: 'B', amount: 1 }])
  })
})
