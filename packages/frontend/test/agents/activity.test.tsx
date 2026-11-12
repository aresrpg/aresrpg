// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { fold_agent_activity } from '../../src/agents/activity.ts'
import { AgentActivityLog } from '../../src/agents/AgentActivity.tsx'
import type { AppCopy } from '../../src/i18n/copy.ts'
import { reduce_app_state } from '../../src/store.ts'
import { automation_fixture, character } from '../modules/automation_fixture.ts'

test('observation starts silently and repeated snapshots do not replay confirmed activity', () => {
  const before = character()
  const after = { ...before, level: before.level + 1 }
  expect(fold_agent_activity([], null, after)).toEqual([])
  const history = fold_agent_activity([], before, after)
  expect(history).toEqual([{ kind: 'level', level: after.level }])
  expect(fold_agent_activity(history, after, { ...after })).toBe(history)
  expect(fold_agent_activity(history, after, { ...after, id: 'other' })).toEqual([])
  expect(fold_agent_activity(history, after, null)).toEqual([])
})

test('profession progress, checkpoint travel and fight custody are observed without invented outcomes', () => {
  const before = { ...character(), jobs: { miner: '10' } }
  const progressed = { ...before, jobs: { miner: '20' } }
  const history = fold_agent_activity([], before, progressed)
  expect(history).toEqual([{ kind: 'profession' }])
  const moved = { ...progressed, x: progressed.x! + 10, at_ms: progressed.at_ms! + 1 }
  const travelled = fold_agent_activity(history, progressed, moved)
  expect(travelled).toEqual([{ kind: 'profession' }, { kind: 'travel' }])
  const fighting = { ...moved, active_fight: { id: 'fight', seat: 0 } }
  const entered = fold_agent_activity(travelled, moved, fighting)
  expect(entered).toEqual([{ kind: 'travel' }, { kind: 'fight_entered' }])
  expect(fold_agent_activity(entered, fighting, moved)).toEqual([{ kind: 'fight_entered' }, { kind: 'fight_left' }])
  expect(fold_agent_activity([], progressed, before)).toEqual([])
})

test('live overlay renders confirmed lines and current state with no speculative plans', () => {
  const copy = {
    ui: {
      agent_activity_label: 'Agent activity',
      agent_activity_level: 'Reached level {level}',
      agent_activity_fight: 'In combat',
      agent_activity_world: 'In the world',
    },
  } as unknown as AppCopy
  const html = renderToStaticMarkup(
    <AgentActivityLog
      copy={copy}
      character={{ ...character(), active_fight: { id: 'fight', seat: 0 } }}
      history={[{ kind: 'level', level: 12 }]}
    />
  )
  expect(html).toContain('Reached level 12')
  expect(html).toContain('In combat')
  expect(html).toContain('role="log"')
  expect(html).not.toContain('In the world')
})

test('the live observation reducer retains activity only for the admitted observation', () => {
  const watching = reduce_app_state(automation_fixture(), {
    type: 'agent/watch',
    observation: {
      pairing: { address: 'paired', multisig_public_key: 'public', signer_mode: 'disposable' },
      public_identifier: 'google',
      character_id: 'remote',
    },
  })
  const packet = {
    type: 'packet/agent_observed' as const,
    id: watching.session.agent_view.serial,
    characters: [{ ...character(), id: 'remote' }],
    selected_character_id: 'remote',
    failed: false,
  }
  const baseline = reduce_app_state(watching, { type: 'server/packet', packet })
  expect(baseline.session.agent_view.activity).toEqual([])
  const changed = { ...packet, characters: [{ ...packet.characters[0]!, level: 50 }] }
  const active = reduce_app_state(baseline, { type: 'server/packet', packet: changed })
  expect(active.session.agent_view.activity).toEqual([{ kind: 'level', level: 50 }])
  const duplicate = reduce_app_state(active, { type: 'server/packet', packet: changed })
  expect(duplicate.session.agent_view.activity).toBe(active.session.agent_view.activity)
  const stale = reduce_app_state(active, { type: 'server/packet', packet: { ...packet, id: packet.id - 1 } })
  expect(stale.session.agent_view.activity).toBe(active.session.agent_view.activity)
  const failed = reduce_app_state(active, { type: 'server/packet', packet: { ...packet, failed: true } })
  expect(failed.session.agent_view.activity).toEqual([])
  const recovered = reduce_app_state(failed, { type: 'server/packet', packet: changed })
  expect(recovered.session.agent_view.activity).toEqual([])
  const stopped = reduce_app_state(active, { type: 'agent/watch', observation: null })
  expect(stopped.session.agent_view.activity).toEqual([])
  const late = reduce_app_state(stopped, { type: 'server/packet', packet: changed })
  expect(late.session.agent_view.activity).toEqual([])
})
