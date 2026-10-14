// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The actual demo, fight observer, input reducer and renderer. Only setup and measurement are scripted.
import { createRoot } from 'react-dom/client'
import { create_character_source, player_max_hp, spell_target_cells, CONTRACT_CONSTANTS } from '@aresrpg/fight'

import { encode_cell, mask_from_cells, empty_mask } from '../../../fight/src/combat_grid.ts'
import { DemoPage } from '../../src/demo/DemoPage.tsx'
import { catalog_spell_sources } from '../../src/content/fight_sources.ts'
import { initialize_app_store, dispatch_app, read_app_state, observe_app, DEMO_APP_MODULES } from '../../src/store.ts'
import { load_game_settings } from '../../src/game/core/settings.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import '../../src/tailwind.css'

initialize_app_store(load_game_settings('high', new URLSearchParams(location.search).get('quality')))
location.hash = 'fight'
const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
observe_app(DEMO_APP_MODULES)
createRoot(document.getElementById('root')!).render(<DemoPage copy={copy} />)
const settled = async () => {
  const deadline = performance.now() + 30000
  await new Promise(requestAnimationFrame)
  while (performance.now() < deadline) {
    const { fight } = read_app_state()
    if (fight.checkpoint && fight.presentations.length === 0) return
    await new Promise(requestAnimationFrame)
  }
  throw new Error('Demo fight presentation did not settle')
}
const wait_for_board = async (mounted: boolean) => {
  const deadline = performance.now() + 30000
  while (Boolean(document.querySelector('[aria-label="Combat"]')) !== mounted) {
    if (performance.now() >= deadline) throw new Error(`Demo board did not become mounted=${mounted}`)
    await new Promise(requestAnimationFrame)
  }
}
const open = async (classe: string, trained = false, trained_spell = 'Deviousness') => {
  if (read_app_state().fight.mounted) {
    dispatch_app({ type: 'fight/closed', fight: null })
    await wait_for_board(false)
  }
  const source = create_character_source({
    classe,
    level: 200n,
    vitality: 995n,
    spell_levels: trained || trained_spell !== 'Deviousness' ? { [trained_spell]: 6n } : {},
  })
  const cells = Array.from({ length: 81 }, (_, index) => encode_cell(BigInt(index % 9), BigInt(Math.floor(index / 9))))
  const board = {
    width: 9n,
    height: 9n,
    shape_mask: mask_from_cells(cells),
    holes: empty_mask(),
    obstacles: empty_mask(),
    start_cells_a: [encode_cell(3n, 4n)],
    start_cells_b: [encode_cell(5n, 4n)],
  }
  const setup = {
    fight_id: 'spell-performance',
    board_seed: 1n,
    board,
    players: [0, 1].map((index) => ({
      character: `spell-${index}`,
      owner: 'local',
      team: BigInt(index),
      ready: true,
      hp: player_max_hp(source),
      cell: index === 0 ? board.start_cells_a[0] : board.start_cells_b[0],
      source,
    })),
    mobs: [],
    spells: catalog_spell_sources(),
  }
  dispatch_app({ type: 'fight/opened', mode: 'local', setup, seed: 1n })
  dispatch_app({ type: 'fight/input', fight: null, origin: 'local', input: { type: 'start' } })
  await wait_for_board(true)
  await settled()
}
const cast = (spell: string) => {
  const checkpoint = read_app_state().fight.checkpoint!
  const fighter = checkpoint.contract.queue[Number(checkpoint.contract.turn_ptr)]!
  const cells = spell_target_cells(checkpoint, fighter, spell).targetable
  const other = checkpoint.contract.fighters.find((_, index) => BigInt(index) !== fighter)!.cell
  const target_cell = cells.includes(other) ? other : cells[0]
  if (target_cell === undefined) throw new Error(`No legal target for ${spell}`)
  const before = checkpoint.contract.turn_slot
  dispatch_app({
    type: 'fight/input',
    fight: null,
    origin: 'local',
    input: { type: 'cast_spell', fighter, spell, target_cell },
  })
  return { before: String(before), fighter: String(fighter), target: String(target_cell) }
}
Reflect.set(window, 'demo_spell_probe', {
  open,
  cast,
  settled,
  next_turn: async () => {
    const checkpoint = read_app_state().fight.checkpoint!
    const ready_at = Number(checkpoint.contract.turn_started_ms + CONTRACT_CONSTANTS.turn_min_ms)
    // Local sessions use the monotonic clock, exactly like fight_observer.create_session.
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.ceil(ready_at - performance.now()))))
    dispatch_app({
      type: 'fight/input',
      fight: null,
      origin: 'local',
      input: { type: 'end_turn', fighter: checkpoint.contract.queue[Number(checkpoint.contract.turn_ptr)]! },
    })
    await settled()
    const after = read_app_state().fight.checkpoint!.contract
    if (after.round === checkpoint.contract.round && after.turn_ptr === checkpoint.contract.turn_ptr)
      throw new Error('Demo turn did not advance')
  },
  state: () => {
    const { fight } = read_app_state()
    return {
      queued: fight.presentations.length,
      slot: String(fight.checkpoint?.contract.turn_slot),
      mounted: fight.mounted,
    }
  },
})
