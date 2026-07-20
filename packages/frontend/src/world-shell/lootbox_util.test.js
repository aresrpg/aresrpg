// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure loot-box helpers — the box detector + the reveal phase order. Imports the import-free leaf directly:
// lootbox_actions/BoxReveal drag `../auth` → enoki → `window` at load and are unimportable under bun:test (the
// repo-wide constraint the deck tests note), so the pure bits live in lootbox_util.js precisely to be testable.

import { describe, expect, it } from 'bun:test'

import {
  is_lootbox,
  ANIM_SEQUENCE,
  PENDING_ESCAPE_MS,
  PENDING_TIMEOUT_MS,
  next_anim_phase,
  can_dismiss_reveal,
  collect_one_claim,
  open_timeout_armed,
  reveal_after_celebration,
  parse_open_box_receipt,
  resolve_box_template,
} from './lootbox_util.js'

// STACK-IDENTITY consumer-level assertion (07-20): group_stackable (inventory-equip.js) now keys its display
// merge on template_id, so a re-authored box lineage sharing a slug gets its OWN row instead of being absorbed
// into a stale/unregistered template's row. This proves the OPEN side of that fix end to end — the VALID
// lineage's row (post-split, its own template_id intact) composes open_box's box_template_id against ITS OWN
// template object, never the stale same-slug one, mirroring crush_resolve.test.js's identical crush-side proof.
describe('resolve_box_template (the open-box consumer of a post-split stack row)', () => {
  it('a split lineage row resolves its OWN template, never a stale same-slug template', () => {
    const stale_template = { id: '0xtpl-old', item_type: 'normal_pet_lootbox' }
    const valid_template = { id: '0xtpl-new', item_type: 'normal_pet_lootbox' }
    const new_lineage_row = { id: '0xnew-box', item_type: 'normal_pet_lootbox', template_id: '0xtpl-new' }

    const resolved = resolve_box_template(
      new_lineage_row,
      new Map([
        ['0xtpl-old', stale_template],
        ['0xtpl-new', valid_template],
      ]),
      new Map([['normal_pet_lootbox', stale_template]]) // the lossy slug join would pick the WRONG (first-seen) template
    )

    expect(resolved).toBe(valid_template)
  })

  it('legacy rows without template_id retain the slug fallback', () => {
    const legacy_template = { id: '0xtpl-legacy', item_type: 'small_potion' }
    expect(
      resolve_box_template({ item_type: 'small_potion' }, null, new Map([['small_potion', legacy_template]]))
    ).toBe(legacy_template)
  })
})

describe('is_lootbox', () => {
  it('matches the three seeded boxes (slug ends _lootbox)', () => {
    for (const slug of ['pet_lootbox', 'pet_ocean_lootbox', 'pet_arisen_lootbox']) expect(is_lootbox(slug)).toBe(true)
  })
  it('rejects non-boxes and nullish', () => {
    for (const slug of ['pet_bouloute', 'health_potion', 'longsword', '', null, undefined])
      expect(is_lootbox(slug)).toBe(false)
  })
})

describe('next_anim_phase (charging → burst → reveal, terminal)', () => {
  it('walks the sequence then stops', () => {
    expect(ANIM_SEQUENCE).toEqual(['charging', 'burst', 'reveal'])
    expect(next_anim_phase('charging')).toBe('burst')
    expect(next_anim_phase('burst')).toBe('reveal')
    expect(next_anim_phase('reveal')).toBe(null) // reveal is terminal — no auto-advance past it
  })
  it('returns null for phases outside the animated sequence (pending / collecting)', () => {
    expect(next_anim_phase('pending')).toBe(null)
    expect(next_anim_phase('collecting')).toBe(null)
    expect(next_anim_phase('nonsense')).toBe(null)
  })
})

describe('open_box receipt parsing (published loot_box module)', () => {
  it('reads the rolled template and claim from the actual Move type suffixes', () => {
    expect(
      parse_open_box_receipt({
        events: [
          {
            type: '0xe170::loot_box::LootBoxOpened',
            parsedJson: { rolled_template: '0xpet' },
          },
        ],
        objectChanges: [
          {
            type: 'created',
            objectType: '0xe170::loot_box::PetBoxClaim',
            objectId: '0xclaim',
          },
        ],
      })
    ).toEqual({ rolled_template: '0xpet', claim_id: '0xclaim' })
  })

  it('does not accept the drifted lootbox module suffix', () => {
    const drifted_event = ['0xe170', 'lootbox', 'LootBoxOpened'].join('::')
    const drifted_claim = ['0xe170', 'lootbox', 'PetBoxClaim'].join('::')
    expect(
      parse_open_box_receipt({
        events: [{ type: drifted_event, parsedJson: { rolled_template: '0xpet' } }],
        objectChanges: [{ type: 'created', objectType: drifted_claim, objectId: '0xclaim' }],
      })
    ).toEqual({ rolled_template: null, claim_id: null })
  })
})

describe('bounded pending reveal', () => {
  it('uses a 45s ceiling and only arms pending Escape after 10s', () => {
    expect(PENDING_TIMEOUT_MS).toBe(45_000)
    expect(PENDING_ESCAPE_MS).toBe(10_000)
    expect(can_dismiss_reveal('pending', false)).toBe(false)
    expect(can_dismiss_reveal('pending', true)).toBe(true)
  })

  it('reveal always dismisses — the auto-claim continues in the background (no dead-end)', () => {
    // D3-REVISED: the claim fires automatically and is durable; holding the player hostage to a
    // COLLECTING spinner was the dead-end. Its outcome toast arrives through the module toast store.
    expect(can_dismiss_reveal('reveal', false)).toBe(true)
    expect(can_dismiss_reveal('reveal', true)).toBe(true)
    expect(can_dismiss_reveal('charging', true)).toBe(false)
    expect(can_dismiss_reveal('burst', true)).toBe(false)
  })

  it('resolving dismisses too — a hung pet read must never trap the player (no dead-end)', () => {
    expect(can_dismiss_reveal('resolving', false)).toBe(true)
  })
})

describe('reveal_after_celebration (UX-A — the post-burst wait is never a frozen-blank tail)', () => {
  it('holds while the celebration is still running', () => {
    expect(reveal_after_celebration(false, false)).toBe(null)
    expect(reveal_after_celebration(false, true)).toBe(null)
  })
  it('shows an honest RESOLVING state when the pet read outlasts the animation (not blank)', () => {
    expect(reveal_after_celebration(true, false)).toBe('resolving')
  })
  it('reveals once both the animation finished and the pet resolved', () => {
    expect(reveal_after_celebration(true, true)).toBe('reveal')
  })
})

describe('open_timeout_armed (UX-B — the 45s force-close is disarmed the instant the receipt lands)', () => {
  it('is armed only while awaiting the receipt (pending)', () => {
    expect(open_timeout_armed('pending')).toBe(true)
  })
  it('is DISARMED for every post-receipt phase — a slow resolve after the win cannot false-timeout', () => {
    for (const phase of ['charging', 'burst', 'resolving', 'reveal']) expect(open_timeout_armed(phase)).toBe(false)
  })
})

describe('collect_one_claim (correctness — a display-read failure never flips the claim verdict)', () => {
  it('a throwing DISPLAY read after a successful claim still fires the success toast and never re-latches', async () => {
    const calls = /** @type {any[]} */ ([])
    const ok = await collect_one_claim(
      { claim_id: '0xC', rolled_template: 'wolf' },
      {
        do_claim: async () => {}, // the claim SUCCEEDS
        settle: (id, outcome) => calls.push(['settle', id, 'error' in outcome ? 'ERR' : 'OK']),
        resolve_name: async () => {
          throw new Error('cold template-map fetch failed') // the cosmetic read throws AFTER success
        },
        toast_ok: (name) => calls.push(['toast_ok', name]),
        toast_err: () => calls.push(['toast_err']),
      }
    )
    expect(ok).toBe(true)
    // verdict keyed on the tx ONLY: settle OK (never a second ERR re-latch) + success toast with the degraded name
    expect(calls).toEqual([
      ['settle', '0xC', 'OK'],
      ['toast_ok', 'wolf'],
    ])
  })

  it('a failing CLAIM fires the error path exactly once and no success toast', async () => {
    const calls = /** @type {any[]} */ ([])
    const ok = await collect_one_claim(
      { claim_id: '0xC', rolled_template: 'wolf' },
      {
        do_claim: async () => {
          throw new Error('executed abort')
        },
        settle: (id, outcome) => calls.push(['settle', id, 'error' in outcome ? 'ERR' : 'OK']),
        resolve_name: async () => 'wolf',
        toast_ok: () => calls.push(['toast_ok']),
        toast_err: () => calls.push(['toast_err']),
      }
    )
    expect(ok).toBe(false)
    expect(calls).toEqual([['settle', '0xC', 'ERR'], ['toast_err']])
  })
})
