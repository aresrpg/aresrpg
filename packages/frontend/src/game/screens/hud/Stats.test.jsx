// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { STATISTICS } from '@aresrpg/sdk/stats'

import { reset_auth_mock } from '../../../test_helpers/auth_mock.js'

// Stats imports the browser wallet transaction choke; isolate this DOM-less unit surface from Enoki's
// module-load `window.location` access. No test below executes a wallet action.
reset_auth_mock()

const {
  AllocationActions,
  STAT_INDEX,
  allocation_session_snapshot,
  allocation_total,
  apply_confirmed_allocation,
  clear_confirmed_character,
  compose_stat_allocation,
  empty_allocation,
  equipment_bonus,
  merge_character_doc,
  remaining_points,
  record_confirmed_character,
  reset_allocation,
  set_allocation_tx_pending,
  stage_allocation,
  stat_doc_caught_up,
  visible_secondary_stats,
} = await import('./Stats.jsx')

const t = (key) => key
const noop = () => {}
const stats_css = await Bun.file(new URL('./Stats.css', import.meta.url)).text()
const hud_panels_css = await Bun.file(new URL('./hud-panels.css', import.meta.url)).text()

const button_tag = (html, klass) => html.match(new RegExp(`<button[^>]*${klass}[^>]*>`))?.[0] ?? ''

beforeEach(() => reset_auth_mock())
afterEach(() => set_allocation_tx_pending(false))

describe('Stats allocation staging', () => {
  test('plus/minus math clamps the staged total to available_points', () => {
    const zero = empty_allocation()
    const vitality = stage_allocation(zero, STATISTICS.VITALITY, 1, 3)
    const chance = stage_allocation(vitality, STATISTICS.CHANCE, 9, 3)
    const removed = stage_allocation(chance, STATISTICS.CHANCE, -1, 3)

    expect(vitality.vitality).toBe(1)
    expect(chance.chance).toBe(2)
    expect(allocation_total(chance)).toBe(3)
    expect(remaining_points(3, chance)).toBe(0)
    expect(removed.chance).toBe(1)
    expect(remaining_points(3, removed)).toBe(1)
    expect(stage_allocation(removed, 'pods', 1, 3)).toBe(removed)
  })

  test('Reset returns every primary stat to zero', () => {
    const staged = stage_allocation(empty_allocation(), STATISTICS.STRENGTH, 3, 5)
    const reset = reset_allocation()
    expect(staged.strength).toBe(3)
    expect(reset).toEqual(empty_allocation())
    expect(allocation_total(reset)).toBe(0)
  })
})

describe('Stats Confirm PTB composition', () => {
  test('threads one transaction through nonzero calls with Move-exact indices', () => {
    const calls = []
    const tx_object = { kind: 'single-ptb' }
    const build = (args) => {
      calls.push(args)
      return args.tx ?? tx_object
    }
    const alloc = {
      ...empty_allocation(),
      strength: 2,
      chance: 3,
      agility: 1,
    }
    const handle = { kiosk_id: '0xkiosk', personal_kiosk_cap_id: '0xcap' }
    const tx = compose_stat_allocation(build, handle, '0xcharacter', alloc)

    expect(tx).toBe(tx_object)
    expect(STAT_INDEX).toMatchObject({ strength: 2, agility: 4, chance: 5 })
    expect(calls.map(({ stat, points }) => [stat, points])).toEqual([
      [2, 2],
      [5, 3],
      [4, 1],
    ])
    expect(calls[0]).toMatchObject({
      kiosk_id: '0xkiosk',
      personal_kiosk_cap_id: '0xcap',
      character_id: '0xcharacter',
      tx: undefined,
    })
    expect(calls[1].tx).toBe(tx_object)
    expect(calls[2].tx).toBe(tx_object)
  })

  test('returns null instead of composing an empty spend', () => {
    expect(
      compose_stat_allocation(
        () => {
          throw new Error('builder must not run')
        },
        { kiosk_id: '0xk', personal_kiosk_cap_id: '0xc' },
        '0xcharacter',
        empty_allocation()
      )
    ).toBeNull()
  })
})

describe('Stats live vocabulary', () => {
  test('Pods is absent; only consumed secondary item stats survive', () => {
    const rows = visible_secondary_stats({
      vitality: 0,
      wisdom: 0,
      strength: 0,
      intelligence: 0,
      chance: 0,
      agility: 0,
    })
    expect(rows.map(({ key }) => key)).toEqual([STATISTICS.CRITICAL, STATISTICS.RAW_DAMAGE])
    expect(JSON.stringify(rows).toLowerCase()).not.toContain('pods')
  })

  test('/v1 document fields override stale store allocations and HP', () => {
    const merged = merge_character_doc(
      { id: '0xcharacter', vitality: 1, available_points: 5, current_hp: 20 },
      {
        id: '0xcharacter',
        vitality: 4,
        wisdom: 2,
        strength: 3,
        intelligence: 0,
        chance: 1,
        agility: 6,
        available_points: 2,
        current_hp: 42,
        hp_updated_ms: 100,
        gear_vitality: 7,
      }
    )
    expect(merged).toMatchObject({
      vitality: 4,
      agility: 6,
      available_points: 2,
      current_hp: 42,
      gear_vitality: 7,
    })
  })

  test('confirmed overlay carries only deterministic allocation fields', () => {
    const expected = apply_confirmed_allocation(
      {
        id: '0xcharacter',
        vitality: 1,
        wisdom: 0,
        strength: 0,
        intelligence: 0,
        chance: 0,
        agility: 0,
        available_points: 5,
        current_hp: 20,
      },
      { ...empty_allocation(), vitality: 2 }
    )
    expect(expected).toMatchObject({ id: '0xcharacter', vitality: 3, available_points: 3 })
    expect(expected).not.toHaveProperty('current_hp')
  })

  test('receipt overlay clears on caught-up stats even when a level-up added points', () => {
    const expected = {
      id: '0xcharacter',
      vitality: 3,
      wisdom: 0,
      strength: 0,
      intelligence: 0,
      chance: 0,
      agility: 0,
      available_points: 0,
    }
    expect(stat_doc_caught_up({ ...expected, vitality: 2 }, expected)).toBe(false)
    expect(stat_doc_caught_up({ ...expected, id: '0xother' }, expected)).toBe(false)
    expect(stat_doc_caught_up({ ...expected, available_points: 5 }, expected)).toBe(true)
  })
})

describe('Stats equipment bonus derivation', () => {
  // LEG 2 — the fixture-stats-to-split seam: `character[key]` is the on-chain base, `equipment_bonus`
  // derives the equipped-gear contribution alone. One home (never inline `get_total_stat - base` per row).
  test('zero when no equipped item contributes to the stat', () => {
    expect(equipment_bonus({ vitality: 10 }, STATISTICS.VITALITY)).toBe(0)
  })

  test('sums every equipped item slot for that stat, ignoring a different stat on another slot', () => {
    const character = {
      vitality: 10,
      hat: { vitality: 3 },
      weapon: { vitality: 2 },
      boots: { strength: 99 }, // a different stat's item bonus must never leak into vitality
    }
    expect(equipment_bonus(character, STATISTICS.VITALITY)).toBe(5)
  })

  test('reads only chain-confirmed fields — pending (`alloc`) never reaches `character`, so it never leaks in', () => {
    const character = { vitality: 10, hat: { vitality: 4 } }
    expect(equipment_bonus(character, STATISTICS.VITALITY)).toBe(4)
    // simulating a staged allocation would mutate a *separate* `alloc` object, never `character` itself —
    // there is no code path by which equipment_bonus's result could move without a real chain write.
  })
})

describe('Stats allocation actions', () => {
  const render_actions = (props) =>
    renderToStaticMarkup(
      <AllocationActions t={t} has_pending={false} can_confirm={false} on_reset={noop} on_confirm={noop} {...props} />
    )

  test('Confirm and Reset are disabled with zero staged points', () => {
    const html = render_actions()
    expect(button_tag(html, 'btn-outline')).toContain('disabled=""')
    expect(button_tag(html, 'btn-gold')).toContain('disabled=""')
  })

  test('Confirm enables only for staged, ready, idle allocation', () => {
    const html = render_actions({ has_pending: true, can_confirm: true })
    expect(button_tag(html, 'btn-outline')).not.toContain('disabled')
    expect(button_tag(html, 'btn-gold')).not.toContain('disabled')
    expect(html).toContain('stats__assign-btn btn-outline')
    expect(html).toContain('stats__assign-btn btn-gold')
  })

  test('Reset and Confirm keep a visible gap and button padding', () => {
    const html = render_actions({ has_pending: true, can_confirm: true })
    expect(html).toContain('stats__assign-actions flex gap-2')
    expect(button_tag(html, 'btn-outline')).toContain('px-3 py-1.5')
    expect(button_tag(html, 'btn-gold')).toContain('px-3 py-1.5')
  })

  test('house button classes have a sharp-corner HUD specificity bridge', () => {
    expect(stats_css).toContain('.hud-root .stats__assign-btn.btn-outline')
    expect(stats_css).toContain('.hud-root .stats__assign-btn.btn-gold')
    expect(stats_css).toContain('border-radius: 0')
  })

  // LEG 1 — the per-stat +/- steppers now share the
  // exact Reset/Confirm recipe (gold hairline / gold gradient + glow) instead of a flat per-stat fill, and
  // still resolve to sharp corners + a specificity bridge (same HUD-button-reset bug class as above).
  test('the +/- steppers carry the house gold idiom, not a per-stat flat fill', () => {
    expect(hud_panels_css).toContain('.hud-root .stats__step {')
    expect(hud_panels_css).toContain('.hud-root .stats__step--add {')
    expect(hud_panels_css).not.toContain('background: var(--tint, var(--accent));') // the old rainbow fill
    expect(hud_panels_css).not.toContain('background: #1b2330;') // the old flat neutral box
  })

  test('the + stepper reuses the exact Confirm gold-gradient + glow recipe (visual parity, one recipe)', () => {
    expect(hud_panels_css).toContain(
      'background: linear-gradient(135deg, var(--color-gold-dark), var(--color-gold), var(--color-gold-dark));'
    )
    expect(hud_panels_css).toContain('box-shadow: 0 0 20px rgba(200, 150, 60, 0.1);') // − hover glow
  })

  test('the + button JSX never carries the old per-row --tint style override', async () => {
    // pure presentation — the disabled PREDICATE is unchanged (pending<=0||tx_pending / !can_upgrade);
    // this only proves the dead per-row tint prop the old rainbow design needed is gone from the button.
    const stats_jsx = await Bun.file(new URL('./Stats.jsx', import.meta.url)).text()
    const add_button = stats_jsx.slice(stats_jsx.indexOf('stats__step--add'))
    expect(add_button.slice(0, add_button.indexOf('</button>'))).not.toContain("'--tint'")
  })

  test('Confirm and Reset stay disabled while a transaction is in flight', () => {
    set_allocation_tx_pending(true)
    const html = render_actions({ has_pending: true, can_confirm: true })
    expect(button_tag(html, 'btn-outline')).toContain('disabled=""')
    expect(button_tag(html, 'btn-gold')).toContain('disabled=""')
    expect(button_tag(html, 'btn-gold')).toContain('aria-busy="true"')
    expect(html).toContain('stats.tx_pending')
  })

  test('a newly selected character stays locked while another allocation is in flight', () => {
    set_allocation_tx_pending(true)
    const expected = { id: '0xcharacter', vitality: 3, available_points: 2 }
    record_confirmed_character(expected.id, expected)
    const first_mount = render_actions({ has_pending: true, can_confirm: true })
    const remount = render_actions({ has_pending: false, can_confirm: false })
    expect(allocation_session_snapshot().tx_pending).toBe(true)
    expect(allocation_session_snapshot().confirmed_characters[expected.id]).toBe(expected)
    expect(button_tag(first_mount, 'btn-gold')).toContain('disabled=""')
    expect(button_tag(remount, 'btn-outline')).toContain('disabled=""')
    expect(button_tag(remount, 'btn-gold')).toContain('disabled=""')
    clear_confirmed_character(expected.id, expected)
  })
})

describe('Stats characteristic descriptions', () => {
  // Sim-truth one-liners (issue #371): every PRIMARY row renders a muted description line under its label,
  // sourced from stats.description.<key> — locale coverage is pinned separately in
  // i18n/locales/stat_description_parity.test.js. This proves the RENDER wiring, not the translation content.
  test('every PRIMARY row renders a muted description line under its label', async () => {
    const stats_jsx = await Bun.file(new URL('./Stats.jsx', import.meta.url)).text()
    expect(stats_jsx).toContain('stats__prow-desc')
    for (const key of ['vitality', 'wisdom', 'strength', 'intelligence', 'chance', 'agility']) {
      expect(stats_jsx).toContain(`stats.description.${key}`)
    }
  })

  test('the visible SECONDARY rows (Critical Hit, Raw Damage) render the same description line', async () => {
    const stats_jsx = await Bun.file(new URL('./Stats.jsx', import.meta.url)).text()
    expect(stats_jsx).toContain('stats__srow-desc')
    expect(stats_jsx).toContain('stats.description.critical_hit')
    expect(stats_jsx).toContain('stats.description.raw_damage')
  })
})
