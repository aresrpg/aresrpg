// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_control_service } from '../src/control.ts'

import { runtime_fixture } from './helpers/runtime_fixture.ts'
import { profession_context, plan } from './helpers/profession_fixture.ts'

test('plan validation reads the current actor snapshot on every call without storing observations', async () => {
  const f = await runtime_fixture()
  let { snapshot } = profession_context()
  const control = create_control_service(
    f.store,
    f.options.config,
    60000,
    () => 63000,
    async () => ({ ...snapshot, decision_revision: 0 })
  )
  try {
    const before = await f.store.scan_keys('', 1000)
    const first = await control.validate_plan(f.grant, plan)
    expect(first.live.status).toBe('observed')
    expect(first.live.next?.issue?.code).not.toBe('character_authority_mismatch')
    snapshot = { ...snapshot, characters: [] }
    const second = await control.validate_plan(f.grant, plan)
    expect(second.live.next?.issue?.code).toBe('character_authority_mismatch')
    expect(second.simulation.status).toBe('not_run')
    expect(await f.store.scan_keys('', 1000)).toEqual(before)
    expect(await f.store.scan_keys('command:', 100)).toEqual([])
  } finally {
    await f.runtime.stop()
  }
})
