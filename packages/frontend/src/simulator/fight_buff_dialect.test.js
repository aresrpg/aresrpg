// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight_buff_dialect.test.js — RED-FIRST for #1166/#1168: the turn card read `-32726 Raw Damage · 1 turn` for a
// buff the corpus authors as +42, and only AFTER the turn ended — the cast-time reading was right.
//
// THE PATH, and why the timing is the tell. Two dialects exist for the two SIGNED effect kinds (ALTER_STAT 9 /
// ALTER_RESIST 11): the published corpus states the AUTHORED magnitude (`+42`), the chain cannot (u64) and rides
// it CENTERED at 32768, and `@aresrpg/sim`'s normalizer is the chain-dialect door that strips the centering
// (#904). The HUD's own corpus door mints authored → chain before handing rows over (`mint_authored_spell`), so
// the optimistic prediction a cast paints is right. The simulator's START door handed the SAME authored rows to
// the SAME normalizer RAW, so the local chain's templates folded every alter row as its 32768-complement —
// authored `+42` → `42 - 32768` → a REMOVE of 32726. A commit is cast AND end-turn (`commands_from_staged`
// always closes the turn), so the moment the receipt retired the correct prediction the card flipped to the
// complement: `-32726`.
//
// Driven end to end on the page's own composition — captured corpus rows → the START fold → the local chain →
// the PRODUCTION fight core's receipt door → engine_view → the turn card's own badge projection. The rows are
// captured wire bytes (spell_corpus_l2.fixture.json, the published 240-row blob), so the reading is an oracle
// rather than an echo of the code under test.

import { describe, expect, test } from 'bun:test'
import i18next from 'i18next'
import { encode } from '@aresrpg/fight/los'
import { engine_view } from '@aresrpg/fight/project'
import { create_fight_store } from '@aresrpg/fight/store'
import {
  commands_from_staged,
  create_sim_chain,
  current_actor,
  pending_mob_turn,
  snapshot_from_sim,
  submit_commands,
} from '@aresrpg/fight/sim_chain'

import en from '../i18n/locales/en.json'
import { effect_badge_view } from '../game/screens/hud/EffectBadges.jsx'
import { set_spell_corpus_for_test } from '../game/data/spell_corpus.js'

import { board_of } from './board'
import { build_start_args } from './fight_start.js'
import { EMPTY_STAT_ALLOC, INITIAL_SIMULATOR_STATE } from './reducer'
import L2 from './spell_corpus_l2.fixture.json'

const i18n = i18next.createInstance()
i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
const t = (key, params) => i18n.t(key, params)

const SEED = 0xc81f3a92
const BOARD = board_of(SEED, 0)
const CLOCK = { now_ms: 1_700_000_000_000 }

/** The captured row: Draghook, a level-6 Senshi self-buff — `+3 Raw Damage · 4 turns`, point self-cast,
 *  with the captured effect shape (kind 9 · stat 9 · turns > 0). */
const DRAGHOOK = L2.rows.find((row) => row.id === 'senshi_draghook')
const [BUFF] = DRAGHOOK.levels[0].effects

/** The same captured row with its buff re-authored to the magnitude/stat of one reported screenshot, and its
 *  crit leg disarmed so the reading is the base one. Everything else is the published row. */
const reauthored = ({ stat, value }) => ({
  ...DRAGHOOK,
  levels: [
    {
      ...DRAGHOOK.levels[0],
      crit_rate: 0,
      effects: [{ ...BUFF, stat, value, value_max: value }],
      crit_effects: [],
    },
  ],
})

const character = () => ({
  id: 'sim_c1',
  name: 'KAELIS',
  class_id: 'senshi',
  male: true,
  level: 30,
  stat_alloc: { ...EMPTY_STAT_ALLOC, vitality: 100, strength: 45 },
  spell_levels: {},
  loadout: {},
})

/** A spell-less mob: it only walks, so nothing it does can touch the seat's own status rows. */
const MOB = {
  id: '0xmob_gronk',
  name: 'Gronk',
  element: 'earth',
  role: 'trash',
  minLevel: 10,
  maxLevel: 20,
  base_hp: 340,
  ap: 6,
  mp: 3,
}

/** The page's real START door, fed a corpus through the seam every fight surface reads. */
const start_args = (corpus) => {
  set_spell_corpus_for_test(corpus)
  return build_start_args({
    state: {
      ...INITIAL_SIMULATOR_STATE,
      seed: SEED,
      roster: [character()],
      focus_id: 'sim_c1',
      placements: { [BOARD.start_cells_a[0]]: 'sim_c1' },
      mob_picks: { [BOARD.start_cells_b[0]]: { template_id: MOB.id, level: 12 } },
    },
    board: BOARD,
    item_by_id: new Map(),
    mob_by_id: new Map([[MOB.id, MOB]]),
    mob_spells_of: () => [],
  })
}

/** Drive the local chain the way the page does until the seat acts, then commit ONE staged self-cast — which
 *  casts AND ends the turn, the boundary the reported flip happens on. */
const commit_self_buff = (corpus) => {
  const built = start_args(corpus)
  const opened = create_sim_chain({ ...built.args, fight_id: 'sim:1166:1' })
  const drive = (chain, batches, rounds) => {
    if (rounds > 40) throw new Error('the seat never got a turn')
    const mob_turn = pending_mob_turn(chain)
    if (mob_turn) {
      const stepped = submit_commands(chain, [{ type: 'ai_turn', entity_id: mob_turn }], CLOCK)
      return drive(stepped.chain, [...batches, stepped], rounds + 1)
    }
    const actor = current_actor(chain)
    if (!actor) throw new Error('the fight stalled with no actor')
    const [me] = chain.sim_state.team0
    const staged = [
      {
        kind: 1,
        spell_template_id: DRAGHOOK.object_id,
        spell_key: 'draghook',
        target: encode(me.cell.x, me.cell.y),
      },
    ]
    const cast = submit_commands(chain, commands_from_staged(staged, actor), CLOCK)
    return { opened, batches: [...batches, cast] }
  }
  return drive(opened, [], 0)
}

/** Fold the run through the PRODUCTION core — the door a chain receipt enters in the live game — and read the
 *  seat's turn-card badge lines (project.js `effects_of` → EffectBadges, exactly what FightTimeline renders). */
const turn_card_lines = (run) => {
  const store = create_fight_store()
  const { fight_id } = run.opened
  store.getState().input({
    type: 'init',
    fight_id,
    my_key: null,
    ctx: { address: '0x51m', my_entity_id: 'sim_c1', offset: { x: 0, z: 0 }, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight: snapshot_from_sim(run.opened, CLOCK), version: 1 })
  for (const batch of run.batches)
    store.getState().input({ type: 'receipt', version: batch.version, receipt: batch.receipt, fight_id })
  const seat = engine_view(store.getState()).fighters.get('sim_c1')
  return (seat?.effects ?? []).map((row) => effect_badge_view(t, row).label)
}

describe('#1166 · the turn card reads the AUTHORED magnitude once the turn is committed', () => {
  test('RED-FIRST: the captured Draghook self-buff survives the commit as "+3 Raw Damage", not its 32768-complement', () => {
    const lines = turn_card_lines(commit_self_buff([DRAGHOOK]))

    // the crit leg of the published row authors +4 — either is the buff, neither is 32765/32764.
    // The duration reads 5, not 4: the cast turn no longer spends an aging (#2000, D42 — a turn END ages
    // nothing; the counter is the bearer's turns still to come). The assertion under test is `not.toContain`.
    expect(lines.find((line) => line.includes('Raw Damage'))).toMatch(/^\+[34] Raw Damage · 5 turns$/)
    expect(lines.join(' ')).not.toContain('3276')
  })

  // Three captured cases, each with the row re-authored to its magnitude. The wrong reading is
  // always the complement `value - 32768`, which is what the raw-dialect template folded.
  const CASES = [
    { what: 'raw damage', stat: 9, value: 42, reads: '+42 Raw Damage · 5 turns', wrong: '32726' },
    { what: 'critical hit', stat: 7, value: 9, reads: '+9 Critical Hit · 5 turns', wrong: '32759' },
    { what: 'percent damage', stat: 8, value: 10, reads: '+10% Damage · 5 turns', wrong: '32758' },
  ]

  for (const { what, stat, value, reads, wrong } of CASES)
    test(`an authored +${value} ${what} buff reads "${reads}" — never -${wrong}`, () => {
      const lines = turn_card_lines(commit_self_buff([reauthored({ stat, value })]))

      expect(lines).toContain(reads)
      expect(lines.join(' ')).not.toContain(wrong)
    })
})

describe('#1166 · the door itself speaks the chain dialect', () => {
  test('the templates the local chain opens with carry the CENTERED value, exactly as a minted row does', () => {
    const built = start_args([reauthored({ stat: 9, value: 42 })])
    const row = built.args.templates_raw.find(({ id }) => id === DRAGHOOK.object_id)
    const [buff] = row.levels[0].effects

    expect(buff.value).toBe(32768 + 42)
    expect(buff.value_max).toBe(32768 + 42)
    // Only the signed kinds are minted — every other authored field rides verbatim.
    expect(row.levels[0].ap_cost).toBe(DRAGHOOK.levels[0].ap_cost)
    expect(buff.turns).toBe(BUFF.turns)
  })
})
