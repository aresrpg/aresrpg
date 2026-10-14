// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Integrate real authored content, combat events, cue projection, presentation and entity motion.
import { expect, test } from 'bun:test'

import mobs from '../../../../../seed/content/mobs.json'
import { create_character_source, create_fight_state } from '../../../../fight/src/create.ts'
import { create_runtime } from '../../../../fight/src/runtime.ts'
import { resolve_spell } from '../../../../fight/src/effects.ts'
import { encode_cell, mask_from_cells, empty_mask } from '../../../../fight/src/combat_grid.ts'
import { to_mob_template } from '../../../src/content/fight_sources.ts'
import { project_fight_cues } from '../../../src/game/fight/fight_cues.ts'
import { create_fight_presenter } from '../../../src/game/fight/fight_presenter.ts'
import { create_sequence_entities } from '../../../../engine/test/fight_sequence_fixture.ts'
import { create_fight_presentation } from '../../../../engine/src/fight_presentation.ts'
import { create_source } from '../../../../engine/src/generated/claude_spell_source.js'
import { spell_effect_timing } from '../../../../engine/src/spell_effect_recipe.ts'
import type { FightPresentationCue } from '../../../../engine/src/types.ts'

test('Yogan damage cannot overtake the authored release and impact clock', async () => {
  const source = create_source(),
    preset = source.select('yogan', 'Magic Arrow', { ap: 4 })
  const effect = { preset, areas: [], atlas_urls: [], triggered: false }
  const timing = spell_effect_timing(effect)
  let clock = 0,
    finish_cast = (_shown: boolean) => {}
  const numbers: number[] = []
  const rendered = create_fight_presentation({
    entities: { face_cell: () => true, prepare_attack: async () => 10 / 24, beat: async () => true } as never,
    vfx: { play_float: () => numbers.push(clock) } as never,
    spells: {
      prepare: async () => {},
      play: () =>
        new Promise<boolean>((resolve) => {
          finish_cast = resolve
        }),
    } as never,
  })
  const presenter = create_fight_presenter({
    prepare: rendered.prepare,
    play: rendered.play,
    wait: async (milliseconds) => {
      clock += milliseconds
    },
  })
  const cast: FightPresentationCue = {
    id: 'cast',
    type: 'cast',
    caster_id: 'fight_character_0',
    spell: 'Magic Arrow',
    cast_level: 1,
    target_cell: 1,
    element: 'fire',
    style: 'damage',
    critical: false,
    amount: 20,
    target_max_hp: 100,
    affected_cells: [1],
    killed: false,
    effect,
  }
  const damage: FightPresentationCue = {
    id: 'damage',
    type: 'damage',
    source_id: 'fight_character_0',
    target_id: 'fight_character_1',
    amount: 20,
    hp_before: 100,
    hp_after: 80,
    element: 'fire',
    cause: 'spell',
    critical: false,
  }
  const batch = presenter.present([cast, damage])
  await Bun.sleep(0)
  expect(numbers).toEqual([])
  clock = 570
  expect(source.frame(clock / 1000, 320, 224).uTr).toBe(-1)
  expect(numbers).toEqual([])
  clock = timing.complete_seconds * 1000
  finish_cast(true)
  await batch
  expect(numbers).toEqual([clock])
  expect(numbers[0]!).toBeGreaterThanOrEqual(timing.impact_seconds * 1000)
  presenter.dispose()
})

test('Aragne Undertow Fang slides both cells before damage and batch completion', async () => {
  const cells = Array.from({ length: 81 }, (_, index) => encode_cell(BigInt(index % 9), BigInt(Math.floor(index / 9))))
  const board = {
    width: 9n,
    height: 9n,
    shape_mask: mask_from_cells(cells),
    holes: empty_mask(),
    obstacles: empty_mask(),
    start_cells_a: [encode_cell(6n, 4n)],
    start_cells_b: [encode_cell(3n, 4n)],
  }
  const before = create_fight_state({
    fight_id: 'aragne-sequence',
    board_seed: 1n,
    board,
    players: [
      {
        character: 'hero',
        owner: 'local',
        ready: true,
        hp: 2000n,
        cell: board.start_cells_a[0],
        source: create_character_source({ classe: 'yogan', level: 200n, vitality: 995n }),
      },
    ],
    mobs: [
      {
        template: to_mob_template(mobs.find((mob) => mob.mob_type === 'aragne__water')! as never),
        scalar: 100n,
        cell: board.start_cells_b[0],
      },
    ],
    spells: {},
  })
  const runtime = create_runtime(before),
    mob = runtime.contract.fighters[1]!
  if (mob.kind.type !== 'mob') throw new Error('Expected the authored Aragne')
  runtime.contract.round = 1n
  runtime.contract.queue = [1n, 0n]
  runtime.contract.turn_ptr = 0n
  mob.ap = mob.kind.snapshot.ap
  const spell = mob.kind.snapshot.kit.find((row) => row.name === 'Undertow Fang')!
  resolve_spell({
    runtime,
    caster: 1n,
    level: spell.level,
    name: spell.name,
    target_cell: before.contract.fighters[0]!.cell,
    cast_level: 0n,
  })
  expect(runtime.error).toBeNull()
  const cues = project_fight_cues({
    checkpoint: runtime,
    initial_checkpoint: before,
    events: runtime.render_actions,
    batch: 1,
  }).filter((cue) => ['cast', 'movement', 'damage'].includes(cue.type))
  expect(cues.map((cue) => cue.type)).toEqual(['cast', 'movement', 'damage'])
  const entities = create_sequence_entities()
  entities.set_board({
    width: 9,
    height: 9,
    cell_size: 1,
    origin: { x: 0, y: 0, z: 0 },
    cells: cells.map((cell, index) => ({ cell: Number(cell), x: index % 9, y: Math.floor(index / 9), kind: 'floor' })),
  })
  entities.set(
    before.contract.fighters.map((fighter, seat) => ({
      id: seat === 0 ? 'fight_character_0' : 'fight_mob_1',
      kind: 'mob',
      model_url: '/fixture.glb',
      anchor: { kind: 'fight_cell', cell: Number(fighter.cell) },
      facing: { kind: 'yaw', yaw: 0 },
    }))
  )
  await entities.prepare_models()
  let clock = 10000,
    completed = false
  entities.tick(clock)
  const numbers: Array<{ at: number; x: number }> = [],
    positions: number[] = []
  const rendered = create_fight_presentation({
    entities,
    vfx: {
      play_cast: async () => true,
      play_float: () => numbers.push({ at: clock, x: entities.entity_position('fight_character_0')![0] }),
    } as never,
  })
  const presenter = create_fight_presenter({ play: rendered.play })
  const batch = presenter.present(cues).then(() => {
    completed = true
  })
  await Bun.sleep(0)
  expect(completed).toBeFalse()
  expect(numbers).toEqual([])
  for (let step = 0; step < 24; step += 1) {
    clock += 25
    entities.tick(clock)
    await Bun.sleep(0)
    positions.push(entities.entity_position('fight_character_0')![0])
  }
  await batch
  expect(positions.some((x) => x < 6.5 && x > 4.5)).toBeTrue()
  expect(numbers).toHaveLength(1)
  expect(numbers[0]!.at).toBeGreaterThanOrEqual(10220)
  expect(numbers[0]!.x).toBeCloseTo(4.5)
  expect(completed).toBeTrue()
  presenter.dispose()
  entities.dispose()
})
