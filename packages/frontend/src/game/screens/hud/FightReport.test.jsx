// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHT COST card-render proof: FightReport is a pure-props shell (no stores, no
// react-i18next context — `t` rides in as a prop), so renderToStaticMarkup (react-dom/server, already a
// dependency — no new dep) is enough to assert the formatted cost line actually reaches the DOM markup.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { reset_walrus_assets_for_test } from '@aresrpg/sdk/jobs'
import { renderToStaticMarkup } from 'react-dom/server'
import { fight_store } from '@aresrpg/fight/store'

import player_experience from '../../core/modules/player_experience.js'
import { FightReport } from './FightReport.jsx'

const t = (key, opts) => (opts?.sui != null ? `${key}:${opts.sui}` : key) // stub — no i18n init needed

// Cold-state pin: these suites assert the resolver's manifest-less fallbacks; a sibling file's real-manifest
// configure (the process-wide walrus singleton) would reroute icons to walrus URLs and fail them in combined runs.
beforeEach(() => reset_walrus_assets_for_test())

const base = {
  verdict: 'Victory',
  party: [{ id: 'me', name: 'Hero', level: 12, is_me: true, alive: true, hp_pct: 100 }],
  enemies: [],
  spoils: { xp: 50, tokens: 0, loot: [] },
  items: [],
  t,
  on_close: () => {},
}

describe('FightReport — the fight-cost line', () => {
  test('a normal (positive) cost renders the cost key, not the refund key', () => {
    const html = renderToStaticMarkup(<FightReport {...base} cost={{ sui: '0.0421', is_refund: false }} />)
    expect(html).toContain('fight_end.cost:0.0421')
    expect(html).not.toContain('fight_end.cost_refund')
    expect(html).toContain('fe-cost')
    expect(html).not.toContain('fe-cost--refund')
  })

  test('a negative net renders the REFUND key + the refund modifier class', () => {
    const html = renderToStaticMarkup(<FightReport {...base} cost={{ sui: '0.0010', is_refund: true }} />)
    expect(html).toContain('fight_end.cost_refund:0.0010')
    expect(html).not.toContain('>fight_end.cost:') // the plain cost key never ALSO renders
    expect(html).toContain('fe-cost--refund')
  })

  test('no cost prop → no cost line at all (defensive default, never a crash)', () => {
    const html = renderToStaticMarkup(<FightReport {...base} cost={null} />)
    expect(html).not.toContain('fe-cost')
  })
})

// ── ITEM 3 (0xp then a second later the correct xp — show a loading skeleton instead of 0) +
//    ITEM 4 ("looted items need a tooltip of at least the item name"). Pure-props render proof (no DOM env). ──
describe('FightReport — xp/loot SKELETON while the reward hydrates', () => {
  const pending_base = { ...base, spoils: { xp: 0, tokens: 0, loot: [] }, cost: null }

  test('pending=true → a pulsing skeleton block, NEVER a literal +0 XP', () => {
    const html = renderToStaticMarkup(<FightReport {...pending_base} pending={true} />)
    expect(html).toContain('fe-skel') // the muted pulse stands in for the value
    expect(html).not.toContain('+0') // never render the literal 0
  })

  test('pending=false (resolved) → the real xp number, no skeleton', () => {
    const html = renderToStaticMarkup(<FightReport {...base} cost={null} pending={false} />) // base xp = 50
    expect(html).toContain('+50')
    expect(html).not.toContain('fe-skel')
  })

  test('loot_units > 0 with no loot landed yet → exactly that many loot skeleton tiles (same treatment)', () => {
    const html = renderToStaticMarkup(<FightReport {...pending_base} pending={true} loot_units={3} />)
    expect(html.split('fe-tile--skel').length - 1).toBe(3)
  })

  test('loot_units but no count (null / 0) → no loot skeletons (never a skeleton forever on a no-loot win)', () => {
    expect(renderToStaticMarkup(<FightReport {...pending_base} pending={true} loot_units={null} />)).not.toContain(
      'fe-tile--skel',
    )
    expect(renderToStaticMarkup(<FightReport {...pending_base} pending={true} loot_units={0} />)).not.toContain(
      'fe-tile--skel',
    )
  })
})

describe('FightReport — looted items carry the item NAME (item 4: the hover tooltip target)', () => {
  const spoils = { xp: 50, tokens: 0, loot: [{ item_type: '0xabc', name: 'Rusty Blade', amount: 2 }] }

  test('a real drop renders the item NAME on the tile (the house <Tooltip> target) — not a nameless icon', () => {
    const html = renderToStaticMarkup(<FightReport {...base} spoils={spoils} cost={null} />)
    expect(html).toContain('Rusty Blade') // reaches the tile via aria-label + icon alt (hover surfaces it)
    expect(html).toContain('×2') // the count badge still renders alongside
  })

  test('the sluggish native title= is GONE — the name rides the house Tooltip idiom now', () => {
    const html = renderToStaticMarkup(<FightReport {...base} spoils={spoils} cost={null} />)
    expect(html).not.toContain('title="Rusty Blade"')
  })

  test('real loot supersedes the skeletons (no placeholder tiles once the drop landed)', () => {
    const html = renderToStaticMarkup(<FightReport {...base} spoils={spoils} loot_units={5} cost={null} />)
    expect(html).not.toContain('fe-tile--skel')
  })
})

// ITEM 5 sibling: the fight COST keeps folding as settle + OPEN + mint + burn land, so it too is skeletoned until
// the reward resolves — the number the player sees ALWAYS includes minting, never a mid-settle partial.
describe('FightReport — the fight cost skeletons until minting has folded (item 5)', () => {
  const pending_base = { ...base, spoils: { xp: 0, tokens: 0, loot: [] } }
  test('pending=true → the cost is a skeleton, NOT a mid-settle partial number', () => {
    const html = renderToStaticMarkup(<FightReport {...pending_base} pending={true} cost={{ sui: '0.0100', is_refund: false }} />)
    expect(html).toContain('fe-cost')
    expect(html).toContain('fe-skel')
    expect(html).not.toContain('fight_end.cost:0.0100') // the partial is hidden behind the skeleton
  })
  test('pending=false (settled) → the FINAL cost renders (create + turns + settle + open + mint + burn)', () => {
    const html = renderToStaticMarkup(<FightReport {...base} pending={false} cost={{ sui: '0.0420', is_refund: false }} />)
    expect(html).toContain('fight_end.cost:0.0420')
  })
})

// ── 07-18 DRIVEN-COMPOSITE RED (.fe-gain empty for 93 polls / 45s): the settle's dry-run refusal latched as
// EXECUTED (see pending_outcomes.test.js), no receipt ever existed, so the fight_result slice stayed 'pending'
// and the gain span held only the aria-hidden skeleton — textContent "" against the pw matcher /\+\d+ XP/.
// These rows pin the dialog's RECEIPT-FIRST derivation end to end at the fold level: the REAL player_experience
// reducer folds the slice; the render mirrors FightResult.jsx's slice→props mapping (that component is
// unloadable headless — it pulls the store/auth/sfx graph); ZERO /v1 state is involved anywhere (overseer law:
// the gain renders from the opened result's own xp — /v1 catches up whenever it likes and owes the dialog nothing).
const fold_slice = (() => {
  const mod = player_experience()
  return (slice, type, payload) => mod.reduce({ fight_result: slice }, { type, payload }).fight_result
})()

/** FightResult.jsx's slice→props mapping, mirrored 1:1 (spoils/pending/loot_units lines 89-100). */
const render_from_slice = (slice) =>
  renderToStaticMarkup(
    <FightReport
      {...base}
      spoils={{ xp: slice.xp, tokens: 0, loot: slice.loot ?? [] }}
      pending={slice.status === 'pending'}
      loot_units={slice.loot_units}
      cost={null}
    />
  )

describe('the victory gain row — receipt-first derivation (07-18 driven-composite red)', () => {
  test('the driven-run state (opened, never resolved): the gain span carries NO "+N XP" — the exact 45s symptom', () => {
    const opened = fold_slice(null, 'action/fight_result/open', { level: 1 })
    const html = render_from_slice(opened)
    expect(html).toContain('fe-gain')
    expect(html).toContain('fe-skel') // the skeleton is all the span holds
    expect(html).not.toMatch(/\+\d+/) // the pw anchor matcher /\+\d+ XP/ resolves EMPTY — unit-pinned
  })

  test('the settlement receipt resolves it: ResultOpened xp_share 123 (Wolfling authored xp_reward) → "+123 XP"', () => {
    // the EXACT payload finish_result composes off the opened receipt (dungeon_settlement.js resolve_reward)
    const opened = fold_slice(null, 'action/fight_result/open', { level: 1 })
    const resolved = fold_slice(opened, 'action/fight_result/resolve', {
      xp: 123,
      level: 2,
      levels_gained: 1,
      points_gained: 5,
      loot_units: 1,
      character_id: '0xchar',
      expected_experience: 123,
    })
    expect(resolved.status).toBe('resolved')
    const html = render_from_slice(resolved)
    expect(html).toContain('+123') // the receipt's own number fills the span
    expect(html).not.toContain('fe-skel') // no skeleton once receipt truth landed
  })

  test('a resolve with NO open modal stays a no-op (xp landing outside the post-fight window never fabricates a card)', () => {
    expect(fold_slice(null, 'action/fight_result/resolve', { xp: 123, level: 2 })).toBe(null)
  })
})

// D2 (the victory card must still show the defeated enemy team) — the shared shell's ENEMIES
// section renders whenever the roster carries opposing rows; the win card's roster rides the fight_summary
// recap (opened for BOTH outcomes since the v30 fix — fight_recap.js pins the payload side; this pins render).
describe('FightReport — the defeated enemy team block (v30 regression pin)', () => {
  const enemies = [
    { id: 'mob-0', name: 'Razkin', level: 8, alive: false, hp_pct: 0 },
    { id: 'mob-1', name: 'Razkin Alpha', level: 10, alive: false, hp_pct: 0 },
  ]

  test('a victory with a beaten roster renders the ENEMIES section: names + DEFEATED state rows', () => {
    const html = renderToStaticMarkup(<FightReport {...base} enemies={enemies} cost={null} />)
    expect(html).toContain('fight_end.enemies')
    expect(html).toContain('Razkin')
    expect(html).toContain('Razkin Alpha')
    expect(html.split('fight_end.defeated').length - 1).toBe(2) // both rows carry the DEFEATED state
    expect(html).toContain('fe-row--defeated')
  })

  test('victory settlement truth defeats an enemy even when the live recap is stale at full HP', () => {
    const stale_enemies = [{ id: 'mob-0', name: 'Razkin', level: 8, alive: true, hp_pct: 100 }]
    const html = renderToStaticMarkup(<FightReport {...base} enemies={stale_enemies} cost={null} />)

    expect(html.split('fight_end.defeated').length - 1).toBe(1)
    expect(html).toContain('fe-row--defeated')
    expect(html).toContain('style="width:0%"')
  })

  test('an empty enemy roster (the torn-view degrade) hides the section — never a bare header', () => {
    const html = renderToStaticMarkup(<FightReport {...base} enemies={[]} cost={null} />)
    expect(html).not.toContain('fight_end.enemies')
  })
})

// The rendering CONTRACT: a loot slot must NEVER render as an empty un-hoverable box, no matter how broken
// the drop's metadata is (QA test-mob drops missing their /v1 encyclopedia row and/or a bag
// match rendered a bare, un-hoverable grey box). resolve_loot_tile.js owns the enrichment decision + name
// chain (unit-tested directly in loot-tile-resolve.test.js); these assert the RENDER picks the right branch.
describe('FightReport — the loot D53 letter-tile fallback (an orphaned drop, missing everywhere)', () => {
  test('no bag match AND no template row → the bold letter tile, never <ItemIcon>, never a bare box', () => {
    const spoils = { xp: 10, tokens: 0, loot: [{ item_type: 'qa_ghost_blade_01', name: 'QA Ghost Blade', amount: 1 }] }
    const html = renderToStaticMarkup(<FightReport {...base} spoils={spoils} items={[]} cost={null} />)
    expect(html).toContain('fe-tile__letter')
    expect(html).toContain('>Q<') // initial() of the entry's own name
    expect(html).not.toContain('item-icon') // the ItemIcon branch did NOT also mount
    expect(html).toContain('aria-label="QA Ghost Blade"') // the tile still names itself
  })

  test('genuinely bare drop (no name, no item_type match) → the \'?\' last resort, still a real tile', () => {
    const spoils = { xp: 10, tokens: 0, loot: [{ item_type: undefined, name: undefined, amount: 1 }] }
    const html = renderToStaticMarkup(<FightReport {...base} spoils={spoils} items={[]} cost={null} />)
    expect(html).toContain('fe-tile__letter')
    expect(html).toContain('>?<')
    expect(html).toContain('aria-label="?"')
  })

  test('a bag match still resolves the ORIGINAL <ItemIcon> branch (no regression on a real, indexed drop)', () => {
    const items = [{ item_type: 'rusty_blade', name: 'Rusty Blade', category: 'sword', quality: 'common' }]
    const spoils = { xp: 10, tokens: 0, loot: [{ item_type: 'rusty_blade', name: 'Rusty Blade', amount: 1 }] }
    const html = renderToStaticMarkup(<FightReport {...base} spoils={spoils} items={items} cost={null} />)
    expect(html).toContain('item-icon')
    expect(html).not.toContain('fe-tile__letter')
  })
})

// Bug (maintainer report, prod v1.12.37): the victory loot tile rendered the generic placeholder box
// glyph instead of the item's real icon. ROOT CAUSE: LootTile builds its <ItemIcon> key straight off
// `entry.item_type` (the raw on-chain template field), bypassing `inventory_item_icon` — the ONE shared
// icon resolver every other surface (InventoryBag/Inventory/EquipmentSlot) routes through, which ALSO
// consults `cosmetic_icon_of` (packages/frontend/src/game/cosmetic_icons.js). That map exists precisely
// because on-chain `item_type` for a shop cosmetic is the generic EQUIP SLOT WORD ("hat"/"cloak"), never
// the unique art slug — item_icon_url then builds the SAME non-existent `items/hat.png` for every
// hat-slot cosmetic (curl-verified live: /assets/items/hat.png resolves to the Walrus quilt shard
// `-TEi2iUTk50pyc3zpfNukt-K8xNRDEZeI0n2NTokKfg/hat.png` → HTTP 404; the correct alias
// `coiffe_fuwa-white.png` → quilt `GFwmQjUVLPrqanmZV1m2qVW7fEqqE_Utn7wvNawNPx0` → HTTP 200). The loot
// card was never wired to the fix that already ships on every other icon surface.
describe('FightReport — loot tile icon resolution routes through the SAME shared resolver as the inventory (never a raw item_type bypass)', () => {
  test('a published RESOURCE renders its exact manifest art, never the generic resource package', () => {
    const template_id = `0x${'e13d'.repeat(16)}` // synthetic runtime id — a source literal trips the chain-id gate
    const items = [
      { template_id, item_type: 'resource', name: 'Obsidian Core', item_category: 'resource' },
    ]
    const spoils = {
      xp: 10,
      tokens: 0,
      loot: [{ template_id, item_type: 'resource', name: 'Obsidian Core', amount: 2 }],
    }
    const html = renderToStaticMarkup(<FightReport {...base} spoils={spoils} items={items} cost={null} />)
    expect(html).toContain('/assets/items/obsidian_core.png')
    expect(html).not.toContain('/assets/items/resource.png')
  })

  test('a cosmetic drop resolves its icon via inventory_item_icon\'s cosmetic alias, not the raw on-chain slot word', () => {
    // items[] carries the bag match (template_map is unreachable here — FightReport hydrates it via an
    // internal useEffect that never fires under renderToStaticMarkup) so `resolved` is true and the
    // <ItemIcon> branch mounts; the icon KEY under test is entry.item_type/name either way.
    const items = [{ item_type: 'hat', name: 'Fuwa Hood (White)', item_category: 'cosmetic_helmet' }]
    const spoils = {
      xp: 10,
      tokens: 0,
      loot: [{ item_type: 'hat', name: 'Fuwa Hood (White)', amount: 3 }],
    }
    const html = renderToStaticMarkup(<FightReport {...base} spoils={spoils} items={items} cost={null} />)
    // the shared resolver's alias (proven live: HTTP 200)
    expect(html).toContain('/assets/items/coiffe_fuwa-white.png')
    // the raw item_type bypass this bug shipped (proven live: HTTP 404 — the placeholder-box trigger)
    expect(html).not.toContain('/assets/items/hat.png')
  })

  test('an ordinary (non-cosmetic) drop is UNCHANGED — item_type still wins when no alias/slug exists', () => {
    const items = [{ item_type: 'rusty_blade', name: 'Rusty Blade', item_category: 'sword' }]
    const spoils = { xp: 10, tokens: 0, loot: [{ item_type: 'rusty_blade', name: 'Rusty Blade', amount: 1 }] }
    const html = renderToStaticMarkup(<FightReport {...base} spoils={spoils} items={items} cost={null} />)
    expect(html).toContain('/assets/items/rusty_blade.png')
  })
})

// ── VICTORY-CARD OVERHAUL: show the duration time of the fight and player names, not address; a party
//    row must never show a raw address slice; and xp and items render PER PLAYER ROW, so everyone can see
//    what everyone rolled. Three RED-FIRST classes below: raw-address names, missing duration, aggregate-only spoils. ──

describe('FightReport — party/enemy names resolve through the ONE HOME, never a raw/poisoned address slice', () => {
  const long_id = '0xdee0fa5d_ally_character_fixture_id' // long+fake — never a real 64-hex chain id
  // the EXACT shape packages/fight/src/project.js:321 bakes: `${addr.slice(0,6)}…${addr.slice(-4)}`
  const party_with_ally = [
    ...base.party,
    { id: long_id, name: '0xDEE0…AD38', level: 9, is_me: false, is_player: true, alive: true, hp_pct: 100 },
  ]

  test('a non-local party row never renders the raw/poisoned address slice baked upstream', () => {
    const html = renderToStaticMarkup(<FightReport {...base} party={party_with_ally} cost={null} />)
    expect(html).not.toContain('0xDEE0…AD38')
  })

  test('before the async /v1 resolve lands it shows the ONE short_fighter_id fallback (7+5, never the raw full address)', () => {
    const html = renderToStaticMarkup(<FightReport {...base} party={party_with_ally} cost={null} />)
    expect(html).toContain(`${long_id.slice(0, 7)}…${long_id.slice(-5)}`)
  })

  test("the local player's own row is untouched — still its given name, no round trip", () => {
    const html = renderToStaticMarkup(<FightReport {...base} party={party_with_ally} cost={null} />)
    expect(html).toContain('Hero') // base.party[0], is_me: true
  })

  test('an enemy mob row keeps its real content name — never mistaken for a resolvable player identity', () => {
    const enemies = [{ id: 'mob-0', name: 'Razkin', level: 8, is_player: false, alive: true, hp_pct: 100 }]
    const html = renderToStaticMarkup(<FightReport {...base} enemies={enemies} cost={null} />)
    expect(html).toContain('Razkin')
  })
})

describe('FightReport — fight duration micro-label (timeline span, total mm:ss)', () => {
  test.each([
    [0, '0:00', 'zero-second timeline'],
    [42_000, '0:42', 'sub-minute timeline'],
    [3_661_000, '61:01', 'over-one-hour timeline'],
  ])('%s ms renders %s for a %s', (duration_ms, expected) => {
    const html = renderToStaticMarkup(<FightReport {...base} duration_ms={duration_ms} cost={null} />)
    expect(html).toContain('fight_end.duration')
    expect(html).toContain(expected)
    expect(html).toContain('fe-duration')
  })

  // recap-truth lane: a resume/poll-adopt captures fight_started_at_ms AFTER the fight already started, so
  // duration_ms is a FLOOR, not the true length — duration_partial:true renders it with a "~" prefix instead
  // of false precision (never a fake-precise number).
  test('duration_partial=true renders a "~" prefix ahead of the mm:ss (an honest floor, not a fake precise value)', () => {
    const html = renderToStaticMarkup(<FightReport {...base} duration_ms={45000} duration_partial={true} cost={null} />)
    expect(html).toContain('~0:45')
  })

  test('duration_partial=false (default) renders the bare mm:ss — no stray "~"', () => {
    const html = renderToStaticMarkup(<FightReport {...base} duration_ms={45000} cost={null} />)
    expect(html).toContain('0:45')
    expect(html).not.toContain('~')
  })
})

describe('FightReport — per-player spoils rows (xp and items PER PLAYER ROW, so everyone can see what everyone rolled)', () => {
  const party = [
    { id: 'me', name: 'Hero', level: 12, is_me: true, is_player: true, alive: true, hp_pct: 100 },
    { id: 'ally-1', name: 'Ally', level: 9, is_me: false, is_player: true, alive: true, hp_pct: 100 },
  ]
  const spoils = { xp: 50, tokens: 0, loot: [{ item_type: 'rusty_blade', name: 'Rusty Blade', amount: 1 }] }
  const items = [{ item_type: 'rusty_blade', name: 'Rusty Blade', category: 'sword', quality: 'common' }]

  test("the local player's row carries the REAL receipt: xp + a resolved item icon, exactly once", () => {
    const html = renderToStaticMarkup(<FightReport {...base} party={party} spoils={spoils} items={items} cost={null} />)
    expect(html).toContain('+50')
    expect(html).toContain('Rusty Blade')
    expect(html).toContain('item-icon')
    expect(html.split('fe-gain').length - 1).toBe(1) // exactly ONE row carries real numbers
  })

  test("a teammate's row is HONEST about the chain not splitting rewards per player — never fabricated, never silent", () => {
    const html = renderToStaticMarkup(<FightReport {...base} party={party} spoils={spoils} items={items} cost={null} />)
    expect(html).toContain('fight_end.spoils_hidden')
  })

  test('a defeat card (spoils=null) still shows the single dashed NO SPOILS plate — no per-row placeholders', () => {
    const html = renderToStaticMarkup(
      <FightReport {...base} party={party} spoils={null} verdict="Defeat" cost={null} />
    )
    expect(html).toContain('fe-nospoils')
    expect(html).not.toContain('fight_end.spoils_hidden')
  })
})

describe('FightReport — RED-FIRST fixture: a 2-player settle result (victory-card overhaul brief)', () => {
  const long_id = '0xdee0fa5d_ally_character_fixture_id' // long+fake — never a real 64-hex chain id
  const fixture = {
    verdict: 'Victory',
    party: [
      { id: 'me', name: 'Hero', level: 12, is_me: true, is_player: true, alive: true, hp_pct: 100 },
      { id: long_id, name: '0xDEE0…AD38', level: 9, is_me: false, is_player: true, alive: true, hp_pct: 100 },
    ],
    enemies: [],
    spoils: { xp: 42, tokens: 0, loot: [{ item_type: 'rusty_blade', name: 'Rusty Blade', amount: 1 }] },
    items: [{ item_type: 'rusty_blade', name: 'Rusty Blade', category: 'sword', quality: 'common' }],
    duration_ms: 154000, // 2:34 — settle-minus-start timestamp delta
    cost: null,
    t,
    on_close: () => {},
  }

  test('names resolve (not addresses), xp/icon render on my row, duration renders, teammate row stays honest', () => {
    const html = renderToStaticMarkup(<FightReport {...fixture} />)
    expect(html).not.toContain('0xDEE0…AD38') // the address slice never survives
    expect(html).toContain('Hero')
    expect(html).toContain('+42')
    expect(html).toContain('item-icon') // the resolved icon ref — not the null grey square
    expect(html).toContain('2:34') // duration from the fixture's timestamp delta
    expect(html).toContain('fight_end.spoils_hidden') // the teammate's un-split reward, reported honestly
  })
})

// EXPORT REPLAY row (issue #209; owner ruling 2026-07-24) — the row reads the REAL app fight_store's trace
// instance (the exact door FightReport itself reads at mount via has_dumpable_trace), so this exercises the
// actual wiring, not a stub. ALWAYS rendered now — never a SURPRISE affordance: has_dumpable_trace() gates the
// button's disabled state, never its existence (the R-keybind alternate died precisely because a hidden button
// read as "no visible change" whenever nothing had been captured yet).
describe('FightReport — the EXPORT REPLAY button (always visible; never a surprise, never a dead click)', () => {
  const anchors = { applied_version: -1, view_version: -1, receipt_seq: 0 }

  test('nothing captured (tap empty) — the button still renders, disabled', () => {
    fight_store.trace_tap._reset_for_test()
    const html = renderToStaticMarkup(<FightReport {...base} cost={null} />)
    expect(html).toContain('fight_end.export_replay')
    expect(html).toContain('btn--secondary')
    expect(html).toContain('disabled=""')
  })

  test('a captured fight (the tap holds an init for it) — the row renders as an ENABLED secondary button', () => {
    fight_store.trace_tap._reset_for_test()
    fight_store.trace_tap.tap_trace_input(
      { fight_id: null, ...anchors },
      { type: 'init', fight_id: '0xfe_report_test' },
      0
    )
    const html = renderToStaticMarkup(<FightReport {...base} cost={null} />)
    expect(html).toContain('fight_end.export_replay')
    expect(html).toContain('btn--secondary')
    expect(html).not.toContain('disabled=""')
  })

  test('a defeat card behaves identically (the row is shared shell chrome, not a victory-only affordance)', () => {
    fight_store.trace_tap._reset_for_test()
    fight_store.trace_tap.tap_trace_input(
      { fight_id: null, ...anchors },
      { type: 'init', fight_id: '0xfe_report_test_2' },
      0
    )
    const html = renderToStaticMarkup(<FightReport {...base} verdict="Defeat" spoils={null} cost={null} />)
    expect(html).toContain('fight_end.export_replay')
    expect(html).not.toContain('disabled=""')
  })
})

// ── #342 — VICTORY-CARD DENSITY: participant rows go HALF the height (single-line: avatar chip · name +
// class·level inline · hp bar · status glyph · trailing loot cluster); a teammate's "not visible to you"
// becomes a dim icon (never its own text line); a roster over ~4 flows into a two-column grid so a 6v6
// (12 rows) fits at 1080p without scrolling, while a 1v1/duo stays single-column (never over-compressed). ──

describe('FightReport — participant-row model (#342: compact single-line rows)', () => {
  test('name + class·level meta share ONE line — no stacked 2-line block ever reintroduces', () => {
    const party = [
      { id: 'me', name: 'Hero', level: 12, class_name: 'Templar', is_me: true, is_player: true, alive: true, hp_pct: 100 },
    ]
    const html = renderToStaticMarkup(<FightReport {...base} party={party} cost={null} />)
    expect(html).toContain('fe-row__nametext')
    expect(html).toContain('fe-row__meta')
    expect(html).toContain('Templar')
    expect(html).not.toContain('fe-row__sub') // the old stacked-second-line class
    expect(html).not.toContain('fe-row__id') // the old 2-line wrapper
  })

  test('status renders as a GLYPH for every state, including ALIVE (previously text-only, no glyph)', () => {
    const party = [{ id: 'me', name: 'Hero', level: 12, is_me: true, is_player: true, alive: true, hp_pct: 100 }]
    const html = renderToStaticMarkup(<FightReport {...base} party={party} cost={null} />)
    expect(html).toContain('fe-state__glyph')
    expect(html).toContain('●') // the alive glyph
    expect(html).toContain('aria-label="fight_end.alive"') // the word survives for hover/screen-reader access
  })

  test('a teammate\'s "not visible to you" is a dim ICON (aria-label) — never its own visible text line', () => {
    const party = [
      { id: 'me', name: 'Hero', level: 12, is_me: true, is_player: true, alive: true, hp_pct: 100 },
      { id: 'ally', name: 'Ally', level: 9, is_me: false, is_player: true, alive: true, hp_pct: 100 },
    ]
    const html = renderToStaticMarkup(
      <FightReport {...base} party={party} spoils={{ xp: 10, tokens: 0, loot: [] }} cost={null} />
    )
    expect(html).toContain('aria-label="fight_end.spoils_hidden"') // the accessible name — never visible text
    expect(html).not.toContain('>fight_end.spoils_hidden<') // the old italic filler TEXT line is gone
    expect(html).toContain('fe-row__spoils--hidden')
  })

  test('a roster of 4 or fewer stays single-column (1v1/duo never over-compressed into a grid)', () => {
    const party = [{ id: 'me', name: 'Hero', level: 12, is_me: true, alive: true, hp_pct: 100 }]
    const enemies = [{ id: 'mob-0', name: 'Razkin', level: 8, alive: true, hp_pct: 100 }]
    const html = renderToStaticMarkup(<FightReport {...base} party={party} enemies={enemies} cost={null} />)
    expect(html).not.toContain('fe-rows--grid')
  })

  test('a roster over 4 flows into the two-column grid', () => {
    const party = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      level: 10,
      is_me: i === 0,
      alive: true,
      hp_pct: 100,
    }))
    const html = renderToStaticMarkup(<FightReport {...base} party={party} cost={null} />)
    expect(html).toContain('fe-rows--grid')
  })

  test('a 6v6 (12 total rows) — both rosters independently grid, all 12 rows render, none silently dropped', () => {
    // is_player omitted (matching the enemies fixture below) — this test targets the row/grid model, not
    // fight_report_names.js's async name resolution (covered separately), so the given names pass through as-is.
    const party = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`,
      name: `Ally${i}`,
      level: 10,
      is_me: i === 0,
      alive: true,
      hp_pct: 100,
    }))
    const enemies = Array.from({ length: 6 }, (_, i) => ({
      id: `e${i}`,
      name: `Foe${i}`,
      level: 12,
      alive: true,
      hp_pct: 100,
    }))
    const html = renderToStaticMarkup(<FightReport {...base} party={party} enemies={enemies} cost={null} />)
    expect(html.split('fe-rows--grid').length - 1).toBe(2) // party's AND enemies' .fe-rows both switched
    expect((html.match(/fe-row fe-row--/g) || []).length).toBe(12) // every row rendered
    for (let i = 0; i < 6; i++) {
      expect(html).toContain(`Ally${i}`)
      expect(html).toContain(`Foe${i}`)
    }
  })
})

// V2 SHADOW status chip (issue #522 follow-up, owner ruling 2026-07-24) — a small dev/QA readout on the
// end-card, present only while the shadow fan-out is armed (fight_trace_tee.js's shadow_is_armed/
// get_shadow_status — this card never reads `window` itself, it asks the tee's own getters). Poking
// `globalThis.window` mirrors fight_trace_tee.test.js's own convention for these exact two keys; only those
// two keys are ever touched/cleaned up here, never `window` wholesale (other test files share this worker).
describe('FightReport — the V2 SHADOW status chip (owner ruling 2026-07-24)', () => {
  // the shared top-level `t` stub only interpolates {{sui}} — this block needs folded/diverged, so it rides
  // its own local stub via the `t` PROP override (FightReport is a pure-props shell; no shared state to touch).
  // No quotes/JSON here on purpose: renderToStaticMarkup HTML-escapes `"` to `&quot;` in text content, so a
  // JSON.stringify stub would need escaped assertions — a plain `k=v` join sidesteps that entirely.
  const chip_t = (key, opts) =>
    opts ? `${key}:${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(',')}` : key

  afterEach(() => {
    if (globalThis.window) {
      delete globalThis.window.__ARES_FIGHT_SHADOW_ENABLED
      delete globalThis.window.__ARES_FIGHT_SHADOW
    }
  })

  test('shadow unarmed — no chip at all', () => {
    globalThis.window ??= /** @type {any} */ ({})
    const html = renderToStaticMarkup(<FightReport {...base} cost={null} t={chip_t} />)
    expect(html).not.toContain('fe-shadow-chip')
  })

  test('armed, zero divergences — the chip renders the fold/diverge counts, no warning modifier', () => {
    globalThis.window ??= /** @type {any} */ ({})
    globalThis.window.__ARES_FIGHT_SHADOW_ENABLED = true
    globalThis.window.__ARES_FIGHT_SHADOW = { fights_shadowed: 3, divergences: 0, last: null }
    const html = renderToStaticMarkup(<FightReport {...base} cost={null} t={chip_t} />)
    expect(html).toContain('fe-shadow-chip')
    expect(html).not.toContain('fe-shadow-chip--warn')
    expect(html).toContain('folded=3')
    expect(html).toContain('diverged=0')
  })

  test('armed with a divergence — the warning modifier lights up', () => {
    globalThis.window ??= /** @type {any} */ ({})
    globalThis.window.__ARES_FIGHT_SHADOW_ENABLED = true
    globalThis.window.__ARES_FIGHT_SHADOW = {
      fights_shadowed: 5,
      divergences: 1,
      last: { fight_id: '0xf1', fields: ['active'] },
    }
    const html = renderToStaticMarkup(<FightReport {...base} cost={null} t={chip_t} />)
    expect(html).toContain('fe-shadow-chip--warn')
    expect(html).toContain('diverged=1')
  })

  test('armed but the shadow has never fed an envelope yet (status null) — a sane 0/0 chip, never a crash', () => {
    globalThis.window ??= /** @type {any} */ ({})
    globalThis.window.__ARES_FIGHT_SHADOW_ENABLED = true
    const html = renderToStaticMarkup(<FightReport {...base} cost={null} t={chip_t} />)
    expect(html).toContain('fe-shadow-chip')
    expect(html).not.toContain('fe-shadow-chip--warn')
    expect(html).toContain('folded=0')
    expect(html).toContain('diverged=0')
  })
})
