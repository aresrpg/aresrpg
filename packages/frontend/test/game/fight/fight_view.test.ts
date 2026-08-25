// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { create_character_source, create_fight, reachable_fight_cells } from '@aresrpg/fight'
import { CHANNELS, EFFECT_KINDS } from '@aresrpg/fight/move_contract'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  presented_turn_after_cue,
  presented_turn_after_queue,
  fight_view_with_display,
  select_fight_view,
  turn_seconds_remaining,
} from '../../../src/game/fight/fight_projection.ts'
import { crank_prompt_hidden, end_turn_wait_ms } from '../../../src/game/fight/FightHud.tsx'
import { fight_portrait_source, FightTimeline } from '../../../src/game/fight/FightTimeline.tsx'
import {
  fight_turn_card_after_observation,
  fight_turn_card_view,
  FightTurnCard,
} from '../../../src/game/fight/FightTurnCard.tsx'

const source = create_character_source({ classe: 'senshi', level: 1n, spell_levels: { slash: 1n } })
const spell_level = {
  ap_cost: 2n,
  range_min: 1n,
  range_max: 4n,
  modifiable_range: false,
  line_of_sight: false,
  line_launch: false,
  free_cell: false,
  casts_per_turn: 0n,
  casts_per_target: 0n,
  cooldown_turns: 0n,
  crit_1_in: 1n,
  effects: [
    {
      kind: 0n,
      element: 'earth',
      value: 10n,
      value_max: 20n,
      area_shape: 0n,
      area_size: 0n,
      target_filter: 0n,
      chance_bp: 10_000n,
      turns: 0n,
      stat: 0n,
    },
  ],
  crit_effects: [],
}

const started_checkpoint = () => {
  const fight = create_fight({
    mode: 'local',
    seed: 7n,
    setup: {
      board_seed: 7n,
      players: [
        { character: 'mine_a', owner: 'mine', team: 0n, ready: true, hp: 55n, source },
        { character: 'mine_b', owner: 'mine', team: 0n, ready: true, hp: 55n, source },
        { character: 'theirs', owner: 'other', team: 1n, ready: true, hp: 55n, source },
      ],
      mobs: [],
      spells: { slash: { classe: 'senshi', unlock_level: 1n, levels: [spell_level] } },
    },
  })
  return fight.apply({ type: 'start', observed_ms: 1_000n }).state
}

describe('generic fight view', () => {
  test('a crank prompt stays dismissed after one tap and returns only on rollback', () => {
    const attempt = { turn_key: 'fight:1:1000', restore_serial: 4 }
    expect(crank_prompt_hidden(attempt, 'fight:1:1000', 4)).toBeTrue()
    expect(crank_prompt_hidden(attempt, 'fight:1:1000', 5)).toBeFalse()
    expect(crank_prompt_hidden(attempt, 'fight:0:2000', 4)).toBeFalse()
  })

  test('end turn waits from local observation, independent of wall-clock skew', () => {
    expect(end_turn_wait_ms(10_000, 10_000)).toBe(3_500)
    expect(end_turn_wait_ms(10_000, 13_499)).toBe(1)
    expect(end_turn_wait_ms(10_000, 13_500)).toBe(0)
  })

  test('the fight surface neither builds a world nor goes looking for one', () => {
    // The board is mounted INSIDE a live world (owner 2026-08-21). Two laws, both learned the
    // hard way: a second engine hides the very world it stands in, and a surface that can ASK
    // for "the live scene" draws into whichever one happens to be published — it landed the
    // fight board in the biome lab twice. The world arrives as an argument or not at all.
    const source = readFileSync(new URL('../../../src/game/fight/FightViewport.tsx', import.meta.url), 'utf8')

    expect(source).not.toContain('create_engine')
    expect(source).not.toContain('create_fight_view')
    expect(source).not.toContain('read_scene')
    expect(source).not.toContain('subscribe_scene')
    expect(source).toContain('scene: SceneHandle')
  })

  test('selects the next living owned fighter from the canonical queue', () => {
    const checkpoint = started_checkpoint()
    const first = select_fight_view({ checkpoint, mode: 'local', owner: 'mine', names: {} })
    expect(first.selected?.character_id).toBe('mine_a')
    expect(first.can_end_turn).toBeTrue()
    expect(first.selected?.spells[0]?.turn?.critical).toBeTrue()

    const other_turn = structuredClone(checkpoint)
    other_turn.contract.turn_ptr = 1n
    const next = select_fight_view({ checkpoint: other_turn, mode: 'local', owner: 'mine', names: {} })
    expect(next.active_seat).toBe(2n)
    expect(next.selected?.character_id).toBe('mine_b')
    expect(next.can_end_turn).toBeFalse()
    expect(next.selected?.spells[0]?.turn).toBeNull()
  })

  test('a selected character owns the HUD even when another owned fighter is active', () => {
    const checkpoint = started_checkpoint()
    const view = select_fight_view({
      checkpoint,
      mode: 'remote',
      owner: 'mine',
      character_id: 'mine_b',
      names: {},
    })

    expect(view.selected?.character_id).toBe('mine_b')
    expect(view.selected?.active).toBeFalse()
    expect(view.can_end_turn).toBeFalse()
  })

  test('remote turn cards use checkpoint character names instead of object ids', () => {
    const checkpoint = started_checkpoint()
    checkpoint.sources.players.theirs!.name = 'Enemy Name'
    const view = select_fight_view({ checkpoint, mode: 'remote', owner: 'mine', names: {} })
    expect(view.timeline.find(({ character_id }) => character_id === 'theirs')?.name).toBe('Enemy Name')
  })

  test('mob turn cards retain their asset identity and resolve its authored portrait', () => {
    const checkpoint = started_checkpoint()
    checkpoint.contract.fighters[2]!.kind = {
      type: 'mob',
      snapshot: { mob_type: 'aragne__fire', level: 1n, max_hp: 55n },
    } as never
    const view = select_fight_view({ checkpoint, mode: 'remote', owner: 'mine', names: {} })
    const mob = view.timeline.find(({ seat }) => seat === 2n)!

    expect(mob.mob_type).toBe('aragne__fire')
    const icon_for = (mob_type: string) => `/mob/${mob_type}.png`
    expect(fight_portrait_source(mob, icon_for)).toBe('/mob/aragne__fire.png')
    expect(fight_portrait_source(view.timeline[0]!, icon_for)).toBeNull()
    expect(
      renderToStaticMarkup(
        FightTimeline({
          fighters: view.timeline,
          focus: () => undefined,
          label: 'Turn order',
          mob_icon_for: icon_for,
          turn_seconds: null,
        })
      )
    ).toContain('src="/mob/aragne__fire.png"')
  })

  test('a final-turn AP and Power buff remains visible on its timeline card', () => {
    const checkpoint = started_checkpoint()
    checkpoint.contract.fighters[2]!.effects = [
      { kind: EFFECT_KINDS.add, element: '', value: 2n, turns_left: 1n, source: 1n, stat: CHANNELS.ap },
      { kind: EFFECT_KINDS.add, element: '', value: 50n, turns_left: 1n, source: 1n, stat: CHANNELS.power },
    ]
    const view = select_fight_view({ checkpoint, mode: 'local', owner: 'mine', names: {} })
    const html = renderToStaticMarkup(
      FightTimeline({
        fighters: view.timeline,
        focus: () => undefined,
        label: 'Turn order',
        mob_icon_for: () => null,
        turn_seconds: null,
      })
    )

    expect(html).toContain('>2</b> AP')
    expect(html).toContain('>50</b>')
    expect(html.toLowerCase()).toContain('power')
    expect(html).toContain('(1 turn)')
  })

  test('the turn-start card follows the presented fighter and falls back for characters', () => {
    const checkpoint = started_checkpoint()
    checkpoint.contract.fighters[2]!.kind = {
      type: 'mob',
      snapshot: { mob_type: 'aragne__fire', level: 45n, max_hp: 55n },
    } as never
    const view = select_fight_view({ checkpoint, mode: 'remote', owner: 'mine', names: { aragne__fire: 'Aragne' } })
    const presented = fight_turn_card_view(view.timeline, 2n, 'fight:0:1000')

    expect(presented).toMatchObject({ key: 'fight:0:1000:2', fighter: { name: 'Aragne', level: 45n } })
    const current = fight_turn_card_view(view.timeline, null, 'fight:0:1000')
    expect(fight_turn_card_after_observation(current, view.timeline, null, 'fight:0:1000', true)).toBe(current)
    expect(fight_turn_card_after_observation(null, view.timeline, null, 'fight:0:1000', true)).toBeNull()
    expect(fight_turn_card_after_observation(current, view.timeline, 2n, 'fight:0:1000', true)).toEqual(presented)
    expect(
      renderToStaticMarkup(
        FightTurnCard({ fighter: presented!.fighter, level_label: 'Level 45', mob_icon_for: () => '/mob.png' })
      )
    ).toContain('src="/mob.png"')

    const character = fight_turn_card_view(view.timeline, null, 'fight:0:1001')
    expect(character?.fighter.character_id).not.toBeNull()
    expect(
      renderToStaticMarkup(
        FightTurnCard({ fighter: character!.fighter, level_label: 'Level 1', mob_icon_for: () => null })
      )
    ).toContain('data-character-placeholder=""')

    const css = readFileSync(new URL('../../../src/game/fight/fight_hud.css', import.meta.url), 'utf8')
    const card_rule = /\.fight-hud__turn-card\s*\{(?<body>[^}]*)\}/s.exec(css)?.groups?.body ?? ''
    const body_rule = /\.fight-hud__turn-card-body\s*\{(?<body>[^}]*)\}/s.exec(css)?.groups?.body ?? ''
    expect(card_rule).toContain('background: transparent')
    expect(card_rule).not.toContain('clip-path')
    expect(body_rule).toContain('justify-content: flex-start')
  })

  test('a refreshed canonical own turn reconstructs its MP range without local history', () => {
    const checkpoint = started_checkpoint()
    const view = select_fight_view({ checkpoint, mode: 'remote', owner: 'mine', names: {} })

    expect(view.selected?.seat).toBe(0n)
    expect(reachable_fight_cells(checkpoint, view.selected!.seat).length).toBeGreaterThan(0)
  })

  test('derives the remote placement deadline from the generated Move constant only', () => {
    const checkpoint = started_checkpoint()
    checkpoint.contract.round = 0n
    checkpoint.contract.queue = []
    checkpoint.contract.placement_ms = 12_345n

    expect(select_fight_view({ checkpoint, mode: 'remote', owner: 'mine', names: {} }).placement_deadline_ms).toBe(
      72_345n
    )
    expect(select_fight_view({ checkpoint, mode: 'local', owner: 'mine', names: {} }).placement_deadline_ms).toBeNull()
  })

  test('a challenge nobody accepted is unstartable, and its one seat can always leave', () => {
    // THE DUEL INCIDENT (2026-08-21): the challenger sat alone in placement while the HUD
    // offered "Force start" — a transaction the chain can only abort, because `fight::start`
    // refuses a side with no living fighter — and offered no way out at all.
    const checkpoint = structuredClone(started_checkpoint())
    checkpoint.contract.fighters = [checkpoint.contract.fighters[0]!]
    checkpoint.contract.round = 0n
    checkpoint.contract.queue = []

    const view = select_fight_view({ checkpoint, mode: 'remote', owner: 'mine', names: {} })

    expect(view.phase).toBe('placement')
    expect(view.sides_manned).toBeFalse()
    expect(view.can_forfeit).toBeTrue()
  })

  test('both sides manned reads as startable', () => {
    const checkpoint = structuredClone(started_checkpoint())
    checkpoint.contract.round = 0n
    checkpoint.contract.queue = []

    expect(select_fight_view({ checkpoint, mode: 'remote', owner: 'mine', names: {} }).sides_manned).toBeTrue()
  })

  test('a solo PvM starts only through Ready, never from the placement timer', () => {
    const checkpoint = structuredClone(started_checkpoint())
    checkpoint.contract.fighters = [
      checkpoint.contract.fighters[0]!,
      { ...checkpoint.contract.fighters[2]!, kind: { type: 'mob', snapshot: {} } } as never,
    ]
    checkpoint.contract.fighters[0]!.ready = false
    checkpoint.contract.round = 0n
    checkpoint.contract.queue = []

    const view = select_fight_view({ checkpoint, mode: 'remote', owner: 'mine', names: {} })
    expect(view.ready_starts_fight).toBeTrue()
    expect(view.show_turn_timer).toBeFalse()
    const hud = readFileSync(new URL('../../../src/game/fight/FightHud.tsx', import.meta.url), 'utf8')
    expect(hud).not.toContain('should_auto_start_placement')
    expect(hud).not.toContain('auto_attempted')
  })

  test('the remote clock counts down from the chain 45-second window', () => {
    expect(
      select_fight_view({ checkpoint: started_checkpoint(), mode: 'remote', owner: 'mine', names: {} }).show_turn_timer
    ).toBeTrue()
    expect(turn_seconds_remaining(10_000n, 10_000)).toBe(45)
    expect(turn_seconds_remaining(10_000n, 54_001)).toBe(1)
    expect(turn_seconds_remaining(10_000n, 55_001)).toBe(0)
  })

  test('a presented mob turn card survives its cue while the turn actions play', () => {
    const cue = { id: 'turn', type: 'turn', entity_id: 'fight_mob_1' } as const
    expect(presented_turn_after_cue(null, cue, 'start')).toBe(1n)
    expect(presented_turn_after_cue(1n, cue, 'complete')).toBe(1n)
  })

  test('a played mob card survives between queued presentation batches', () => {
    expect(presented_turn_after_queue(1n, 1)).toBe(1n)
    expect(presented_turn_after_queue(1n, 0)).toBeNull()
  })

  test('presentation overrides fighter display without passing a BigInt checkpoint through React props', () => {
    const view = select_fight_view({ checkpoint: started_checkpoint(), mode: 'remote', owner: 'mine', names: {} })
    const displayed = fight_view_with_display(view, [{ seat: 1, hp: '0', dead: true }])

    expect(displayed.timeline.find(({ seat }) => seat === 1n)).toMatchObject({ hp: 0n, dead: true })
    expect(displayed.timeline.find(({ seat }) => seat === 0n)).toEqual(view.timeline.find(({ seat }) => seat === 0n))
  })

  test('orders the spell bar by authored unlock level', () => {
    const checkpoint = structuredClone(started_checkpoint())
    Object.values(checkpoint.sources.players).forEach((player) => {
      player.level = 100n
      player.spell_levels = { late: 1n, early: 1n }
    })
    checkpoint.sources.spells = {
      late: { classe: 'senshi', unlock_level: 20n, levels: [spell_level] },
      early: { classe: 'senshi', unlock_level: 2n, levels: [spell_level] },
    }

    const view = select_fight_view({ checkpoint, mode: 'local', owner: 'mine', names: {} })

    expect(view.selected?.spells.map(({ name }) => name)).toEqual(['early', 'late'])
  })
})
