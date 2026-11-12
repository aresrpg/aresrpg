// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_control_service, lane_key_for, type Lane } from '../src/control.ts'

import { runtime_fixture } from './helpers/runtime_fixture.ts'
import { stored_profession } from './helpers/legacy_run_fixture.ts'
import { plan } from './helpers/profession_fixture.ts'
import { put } from './helpers/control_fixture.ts'

test('historical profession metadata remains readable and recovery stays grant-scoped', async () => {
  const f = await runtime_fixture()
  const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  try {
    const lane = await control.acquire(f.bot, 'actor', 10000)
    await control.observed(lane_key_for(f.bot), 'actor', lane.fence, true)
    const objective = { title: 'Herbalist level 30', description: 'Gather then craft', steps: ['Gather', 'Craft'] }
    const run = await stored_profession(f.store, f.grant, { ...plan, objective }, f.clock.now)
    expect((await control.profession_status(f.grant, run.id)).plan.objective).toEqual(objective)
    await expect(control.profession_status({ ...f.grant, id: 'other' }, run.id)).rejects.toThrow(
      'profession_run_not_found'
    )
    await put(f.store, `profession:${run.id}`, { ...run, status: 'paused' })
    const current = (await f.store.read<Lane>(run.lane_key))!
    await put(f.store, run.lane_key, { ...current, profession_run_id: null })
    expect(
      await control.resume_profession(f.grant, run.id, current.decision_revision, current.observation_revision)
    ).toMatchObject({ resumed: true })
    expect((await control.profession_status(f.grant, run.id)).plan.objective).toEqual(objective)
  } finally {
    await f.runtime.stop()
  }
})
