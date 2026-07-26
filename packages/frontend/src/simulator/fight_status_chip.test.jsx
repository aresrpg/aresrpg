// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/fight_status_chip.test.jsx — THE RENDERED-CHIP GATE (#973, driven-capture round 2).
//
// The receipt half of #973 (`packages/fight/test/status_envelope_receipt.test.js`) folds receipts straight through
// `normalize_events` → `apply_action`. That proves the envelope rows populate the status home and nothing past it,
// so a driven capture reporting NO chip and a REVERTING MP pool could not be placed. This file closes that gap by
// driving the whole way to the eye — one fight, three consumers, all on the sim page's own composition:
//
//   · the STORE SLICE the chip reads — `fight_view(...)` fighters `effects` (project.js `effects_of`, LEG Q), the
//     exact array `FightTimeline` hands `EffectBadges`;
//   · the RENDERED markup — `FightTimeline` over that live fight, so the badge row and its localized reading are
//     asserted as DOM rather than inferred from a projection;
//   · the MP POOL across the turn boundary — the buff's whole point, and the half that was genuinely broken: the
//     turn-start refill painted the seat's IMMUTABLE base pool, so a landed `+1 MP · 3 turns` grant was rolled
//     back by the very next TurnStarted (fixed in `inputs.js`, the `pool_grant` refill twin).
//
// Nothing is mocked but the clock and the macrotask pump (the `fight_hud_cast.test.jsx` harness): the local chain
// is real, the fight core is the production store, and the cast is committed through the shim's injected door in
// the same staged-row shape `DungeonBoard.flush_commit` composes.

import { describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

install_browser_globals({ with_document: true, with_element: true })

const { renderToStaticMarkup } = await import('react-dom/server')
const { I18nextProvider } = await import('react-i18next')
const { default: i18n } = await import('../i18n')
const { encode, decode } = await import('@aresrpg/fight/los')
const { create_sim_chain } = await import('@aresrpg/fight/sim_chain')
const { fight_store } = await import('@aresrpg/fight/store')
const { fight_view } = await import('@aresrpg/fight/project')
const { INVISIBILITY_STATUS_KIND: K_INVISIBILITY } = await import('@aresrpg/fight/fight_status_snapshot')
const { build_teams } = await import('./fight_setup.js')
const { build_seat } = await import('./content.js')
const { create_fight_shim } = await import('./fight_shim.js')
const { FightTimeline } = await import('../game/screens/hud/FightTimeline.jsx')

const SEED = 0xc81f3a92
const NOW = 1_700_000_000_000
const VANISH = 'yajin_shadowfold'

// The WIRE ints the published corpus authors this spell with (spell_corpus_l2.fixture.json → `yajin_shadowfold`,
// level 1). `spell_effect.js` names them sim-side but the sim package does not export that module, so the values
// ride here as the corpus itself states them — which is also what the receipt carries.
const K_GIVE_POINTS = 6 // spell_effect K_GIVE_POINTS
const POINT_MP = 1 // spell_effect POINT_MP
const SHAPE_POINT = 0
const TF_ONLY_CASTER = 32

/** The REPORTED spell, authored exactly as the published corpus holds it (`spell_corpus_l2.fixture.json`
 *  `yajin_shadowfold` level 1): a point self-cast granting invisibility and +1 MP for three turns. */
const VANISH_ROWS = [
  {
    id: VANISH,
    name: 'Vanish',
    classType: 'yajin',
    element: 'air',
    levels: [
      {
        min_char_level: 1,
        ap_cost: 2,
        range_min: 0,
        range_max: 0,
        line_of_sight: true,
        cooldown_turns: 11,
        crit_rate: 0,
        effects: [
          {
            kind: K_INVISIBILITY,
            element: 255,
            value: 1,
            area_shape: SHAPE_POINT,
            area_size: 0,
            target_filter: TF_ONLY_CASTER,
            chance: 100,
            turns: 3,
            stat: 0,
            flags: 0,
            phase: 0,
          },
          {
            kind: K_GIVE_POINTS,
            element: 255,
            value: 1,
            area_shape: SHAPE_POINT,
            area_size: 0,
            target_filter: TF_ONLY_CASTER,
            chance: 100,
            turns: 3,
            stat: POINT_MP,
            flags: 0,
            phase: 0,
          },
        ],
        crit_effects: [],
      },
    ],
  },
]

const character = (id, name) => ({
  id,
  name,
  class_id: 'senshi',
  level: 30,
  stat_alloc: { vitality: 100, wisdom: 0, strength: 45, intelligence: 0, chance: 0, agility: 0 },
  spell_levels: {},
  loadout: {},
})

const mob_block = (name) => ({
  template_id: `0xmob_${name}`,
  name,
  element: 3,
  role: 'striker',
  level: 6,
  min_level: 4,
  max_level: 8,
  hp: 30,
  max_hp: 30,
  ap: 6,
  mp: 3,
  stats: {},
  combat_block_published: true,
})

/** One seat + two mobs on the seed's own board, opened through the production shim (mob pump synchronous). */
const open_fight = () => {
  const roster = [character('sim_c1', 'KAELIS')]
  const mobs = [mob_block('aetherwing'), mob_block('gronk')]
  const probe = create_sim_chain({ seed: SEED, fight_id: 'probe', team0: [], team1: [], templates_raw: [] })
  const ally = probe.board.start_cells_a.map((cell) => decode(Number(cell)))
  const enemy = probe.board.start_cells_b.map((cell) => decode(Number(cell)))
  const { team0, team1 } = build_teams({
    placements: roster.map((row, index) => ({
      cell: ally[index],
      character: row,
      seat: build_seat(row, []),
      spell_ids: [VANISH],
    })),
    picks: mobs.map((mob, index) => ({ cell: enemy[index], mob })),
    class_templates: new Map(),
  })
  const stocked = (entity) => ({ ...entity, deck: Array.from({ length: 24 }, () => VANISH) })
  const shim = create_fight_shim({ schedule: (fn) => fn(), now: () => NOW })
  const opened = shim.start({
    seed: SEED,
    fight_id: `sim:${SEED}:chip`,
    team0: team0.map(stocked),
    team1,
    templates_raw: VANISH_ROWS,
    roster,
    mobs,
    focus_id: 'sim_c1',
  })
  expect(opened.ok).toBe(true)
  return shim
}

/** The chip's own source of truth: the projected fighter row `FightTimeline` reads for its `EffectBadges`. */
const me_of = (shim) => fight_view(fight_store.getState())?.fighters?.get(shim.chain().sim_state.team0[0].id)

const kinds_of = (row) => (row?.effects ?? []).map((e) => Number(e.kind)).sort((a, b) => a - b)
const turns_of = (row, kind) => (row?.effects ?? []).find((e) => Number(e.kind) === kind)?.remaining_turns ?? null

/** The staged CAST row `DungeonBoard.flush_commit` composes, aimed at the caster's own cell (range 0). */
const self_cast = (shim) => {
  const [me] = shim.chain().sim_state.team0
  return [{ kind: 1, target: encode(me.cell.x, me.cell.y), spell_template_id: VANISH, spell_key: VANISH }]
}

const markup = () =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <FightTimeline />
    </I18nextProvider>
  )

describe('#973 · a landed self-buff is VISIBLE and its granted MP survives the turn', () => {
  test('the chip reaches the store slice AND the rendered turn card, and the pool holds across the boundary', async () => {
    const shim = open_fight()
    const base_mp = me_of(shim).mp
    expect(kinds_of(me_of(shim))).toEqual([])

    // A commit is the WHOLE turn (`commands_from_staged` always closes with `end_turn`), so this one press casts,
    // ends my turn, burns the buff's first tick and pumps both mobs — the state the capture's `22_kaguya_next
    // _turn.png` froze: my turn open again, two turns of the buff still to run.
    expect(await shim.commit_turn(self_cast(shim))).toBe(true)

    // ① THE SLICE. `EffectBadges` renders exactly this array — an empty one is a chipless HUD whatever the fold holds.
    expect(kinds_of(me_of(shim))).toEqual([K_GIVE_POINTS, K_INVISIBILITY])
    expect(turns_of(me_of(shim), K_INVISIBILITY)).toBe(2)
    // ② THE DOM. The badge row, with its localized reading — what the driven sweep could not find on the surface.
    const html = markup()
    expect(html).toContain('hud-effects')
    expect(html).toContain('Become invisible')
    // ③ THE POOL — the reported ROLLBACK. The next turn must open on the GRANTED pool, not the base refill.
    expect(me_of(shim).mp).toBe(base_mp + 1)

    // ④ One more round: the counter still RENDERS (1) before it expires, and the point is still granted.
    expect(await shim.commit_turn([])).toBe(true)
    expect(turns_of(me_of(shim), K_GIVE_POINTS)).toBe(1)
    expect(me_of(shim).mp).toBe(base_mp + 1)

    // ⑤ AND IT LETS GO. A buff that never expired would be the worse bug: the last round burns the row, the chip
    // leaves the card, and the pool refills to the base the seat actually owns.
    expect(await shim.commit_turn([])).toBe(true)
    expect(kinds_of(me_of(shim))).toEqual([])
    expect(markup()).not.toContain('hud-effects')
    expect(me_of(shim).mp).toBe(base_mp)
  })

  // THE TWIN, stated over the WHOLE buff window: the projected pool the HUD prints and the sim's own pool are one
  // number. A refill predicate that drifts from `fight_state.effective_mp_max` by a single turn — the #598 class,
  // one turn past the buff's life — is invisible to a fixed expectation but cannot survive this.
  test('the projected pool equals the sim’s own pool on every turn of the buff', async () => {
    const shim = open_fight()
    const sim_mp = () => shim.chain().sim_state.team0[0].mp
    const seen = []
    await shim.commit_turn(self_cast(shim))
    for (let round = 0; round < 4; round += 1) {
      seen.push([me_of(shim).mp, sim_mp()])
      expect(await shim.commit_turn([])).toBe(true)
    }
    for (const [projected, sim] of seen) expect(projected).toBe(sim)
    // and the window is genuinely OBSERVED rather than a flat line. A 3-turn buff cast on turn 1 grants that
    // turn's pool outright and then refills two more (the chain ages the credit at the caster's turn END, so the
    // third tick expires it before turn 4 opens) — the two turns the capture watched revert.
    const [base] = seen.at(-1)
    expect(seen.map(([projected]) => projected)).toEqual([base + 1, base + 1, base, base])
  })
})
