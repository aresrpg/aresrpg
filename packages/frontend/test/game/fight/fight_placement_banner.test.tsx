// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, spyOn, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import * as store from '../../../src/store.ts'
import { FightPlacementBanner } from '../../../src/game/fight/FightPlacementBanner.tsx'

test('an ahead-of-time device cannot expose Force start before a chain clock sample arrives', () => {
  const wall_clock = spyOn(Date, 'now').mockReturnValue(3_661_000)
  try {
    const html = renderToStaticMarkup(
      <FightPlacementBanner
        can_forfeit={false}
        deadline={61_000n}
        locked={false}
        on_force_start={() => undefined}
        on_forfeit={() => undefined}
        on_ready={() => undefined}
        on_ready_all={() => undefined}
        ready={false}
        ready_all={false}
        ready_all_disabled={false}
        ready_all_progress={null}
        sides_manned
        starting={false}
        text={{ placement_ready: 'Ready', placement_force_button: 'Force start' }}
      />
    )
    expect(html).not.toContain('Force start')
    expect(html).toContain('Ready')
  } finally {
    wall_clock.mockRestore()
  }
})

test('ready all exposes confirmed transaction progress in its button and progressbar', () => {
  const html = renderToStaticMarkup(
    <FightPlacementBanner
      can_forfeit={false}
      deadline={null}
      locked
      on_force_start={() => undefined}
      on_forfeit={() => undefined}
      on_ready={() => undefined}
      on_ready_all={() => undefined}
      ready={false}
      ready_all
      ready_all_disabled={false}
      ready_all_progress={{ completed: 1, total: 3, status: 'running' }}
      sides_manned
      starting={false}
      text={{
        placement_title: 'Prepare',
        placement_hint: 'Place fighters',
        placement_no_opponent: 'No opponent',
        placement_force_prompt: 'Force?',
        placement_ready: 'Ready',
        placement_waiting: 'Waiting',
        placement_starting: 'Starting',
        placement_ready_all: 'Ready all',
        placement_ready_all_progress: 'Ready all · {completed}/{total}',
        placement_ready_all_complete: 'All ready · {completed}/{total}',
        placement_ready_all_failed: 'Interrupted · {completed}/{total}',
        placement_force_button: 'Force',
        forfeit: 'Forfeit',
      }}
    />
  )

  expect(html).toContain('Ready all · 1/3')
  expect(html).toContain('role="progressbar"')
  expect(html).toContain('aria-valuenow="1"')
  expect(html).toContain('aria-valuemax="3"')
  expect(html).toContain('width:33.33333333333333%')
})

test('an unattended tournament exposes Force start only after its observed admission deadline', () => {
  const base = store.initial_app_state({ quality: 'medium', music_enabled: true, render_distance: null })
  for (const scenario of [
    { walkover: true, chain_ms: 60_999, ready: false, locked: false, visible: false },
    { walkover: true, chain_ms: 61_000, ready: false, locked: false, visible: true },
    { walkover: true, chain_ms: 61_000, ready: false, locked: true, visible: true },
    { walkover: false, chain_ms: 61_000, ready: false, locked: false, visible: false },
    { walkover: true, chain_ms: 61_000, ready: null, locked: false, visible: false },
  ]) {
    const state = { ...base, chain_clock: { chain_ms: scenario.chain_ms, received_ms: performance.now() } }
    const select = spyOn(store, 'useAppStore').mockImplementation(<T,>(selector: (value: store.AppState) => T): T =>
      selector(state)
    )
    try {
      const html = renderToStaticMarkup(
        <FightPlacementBanner
          can_forfeit
          can_walkover={scenario.walkover}
          deadline={61_000n}
          locked={scenario.locked}
          on_force_start={() => undefined}
          on_forfeit={() => undefined}
          on_ready={() => undefined}
          on_ready_all={() => undefined}
          ready={scenario.ready}
          ready_all={false}
          ready_all_disabled={false}
          ready_all_progress={null}
          sides_manned={false}
          starting={false}
          text={{ placement_no_opponent: 'No opponent', placement_force_button: 'Force start', forfeit: 'Forfeit' }}
        />
      )
      expect(html.includes('Force start')).toBe(scenario.visible)
      expect(html).toContain('No opponent')
      expect(html).toContain('Forfeit')
      if (scenario.visible && scenario.locked) expect(html).toMatch(/disabled=""[^>]*>Force start/)
    } finally {
      select.mockRestore()
    }
  }
})
