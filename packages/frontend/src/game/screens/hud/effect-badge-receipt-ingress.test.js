// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #983 RED-FIRST at the SURFACE the player reads. `effect-badge-signed-stat.test.js` pins the SNAPSHOT
// door's decode; this pins the other one. A world fight's chip read `-32767 Range` for a corpus-authored
// `+1 Range` because the RECEIPT door wrote `ActionEffect.effect.value` into the status home without the
// 32768-centering decode — two dialects in one home. The whole walk is real here: a live fight store → the
// receipt input → engine_view's effects projection → the exact localized badge line, so neither half can
// regress alone.
//
// The minted values are captured chain state (testnet, `sui client object --json`, 2026-07-26; the full table
// lives in `packages/fight/test/status_signed_delta.test.js`): a signed kind rides `32768 + delta`, so
// `+1 range` is `32769` and Kraken Leviathan's authored `-7 range` is `32761`.

import { describe, expect, test } from 'bun:test'
import i18next from 'i18next'
import { engine_view } from '@aresrpg/fight/project'
import { create_fight_store } from '@aresrpg/fight/store'

import en from '../../../i18n/locales/en.json'
import { effect_badge_view } from './EffectBadges.jsx'

const i18n = i18next.createInstance()
i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
const t = (key, params) => i18n.t(key, params)

const FIGHT = '0xf983'
const CHAR = '0xc983'
const CELL = 105
const PKG = '0xpkg::fight_events::'

/** The chain's action envelope around one point self-cast, in the captured receipt shape. */
const receipt_events = (value) => {
  const effect = {
    area_shape: 0,
    area_size: '0',
    chance: 100,
    element: 255,
    flags: 0,
    kind: 9, // K_ALTER_STAT — a signed kind
    phase: 0,
    stat: 6, // STAT_RANGE
    target_filter: 32, // TF_ONLY_CASTER
    turns: 3,
    value,
  }
  const key = { fight: FIGHT, caster_is_mob: false, caster_idx: '0', turn_ordinal: '1', action_ordinal: '0' }
  return [
    { kind: 'ActionStarted', data: { ...key, action_kind: 0, ap_cost: '2', effect_count: '1', target_cell: '105' } },
    { kind: 'ActionEffect', data: { ...key, effect, effect_ordinal: '0' } },
    { kind: 'Cast', data: { fight: FIGHT, caster_is_mob: false, caster_idx: 0, target_cell: CELL } },
    { kind: 'ActionResolved', data: { ...key, action_kind: 0, ap_cost: '2', effects: [effect], fumbled: false } },
  ].map((row) => ({ type: PKG + row.kind, parsedJson: row.data }))
}

const fight_object = {
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'yajin',
      team: 0,
      hp: 50,
      max_hp: 50,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: CELL,
      base_stats: { range: 6 },
    },
  ],
  mobs: [],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  invisibility_statuses: [],
}

/** The badge line the fighter chip renders after the receipt lands. */
const chip_line = (value) => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight: fight_object, version: 1, journal_head: '0' }, 1_000)
  store
    .getState()
    .input({ type: 'receipt', fight_id: FIGHT, version: 2, receipt: { events: receipt_events(value) } }, 1_100)
  const [row] = engine_view(store.getState()).fighters.get(CHAR).effects
  return effect_badge_view(t, row).label
}

describe('the fighter chip reads the receipt door decoded (#983)', () => {
  test('RED-FIRST: an authored +1 Range buff reads "+1 Range", never -32767 or the raw 32769', () => {
    const label = chip_line('32769')

    expect(label).toBe('+1 Range · 3 turns')
    expect(label).not.toContain('32767')
    expect(label).not.toContain('32769')
  })

  test('a captured -7 range debuff keeps its sign on the same surface', () => {
    expect(chip_line('32761')).toBe('-7 Range · 3 turns')
  })
})
