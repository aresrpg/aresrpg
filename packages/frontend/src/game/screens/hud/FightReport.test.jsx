// FIGHT COST card-render proof: FightReport is a pure-props shell (no stores, no
// react-i18next context — `t` rides in as a prop), so renderToStaticMarkup (react-dom/server, already a
// dependency — no new dep) is enough to assert the formatted cost line actually reaches the DOM markup.
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import player_experience from '../../core/modules/player_experience.js'
import { FightReport } from './FightReport.jsx'

const t = (key, opts) => (opts?.sui != null ? `${key}:${opts.sui}` : key) // stub — no i18n init needed

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

describe('FightReport — fight duration (mm:ss, house format via compass_math.format_mmss)', () => {
  test('duration_ms > 0 renders mm:ss in the header sub-line', () => {
    const html = renderToStaticMarkup(<FightReport {...base} duration_ms={154000} cost={null} />) // 2:34
    expect(html).toContain('2:34')
  })

  test('no duration source (0/absent) renders nothing extra — never a fake 00:00', () => {
    const html = renderToStaticMarkup(<FightReport {...base} cost={null} />)
    expect(html).not.toMatch(/\d+:\d{2}/)
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
