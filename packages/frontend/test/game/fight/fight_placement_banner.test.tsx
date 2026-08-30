// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { FightPlacementBanner } from '../../../src/game/fight/FightPlacementBanner.tsx'

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
