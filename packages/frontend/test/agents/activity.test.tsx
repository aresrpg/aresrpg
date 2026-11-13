// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { current_agent_activity, fold_agent_activity } from '../../src/agents/activity.ts'
import { AgentWalletBalance } from '../../src/agents/AgentSpectator.tsx'
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

test('current status replaces idle without adding events and never crosses observation identity', () => {
  const base = automation_fixture().session
  const pairing = { address: 'paired', multisig_public_key: 'public', signer_mode: 'host-persistent' as const }
  const idle = { status: 'idle' as const, character_ids: [], objective: null }
  const session = {
    ...base,
    agent_view: {
      ...base.agent_view,
      status: 'ready' as const,
      request: { pairing, public_identifier: 'google', character_id: 'alice' },
    },
    agent_connection: {
      ...base.agent_connection,
      phase: 'ready' as const,
      pairing,
      response: {
        owner: 'owner',
        status: 'connected' as const,
        recovery_bots: [],
        expires_at: Date.now() + 60_000,
        bot: { id: 'bot', ...pairing, generation: 1, policy_revision: 1, status: 'ready' as const },
        activity: idle,
      },
    },
  }
  expect(current_agent_activity(session)).toEqual(idle)
  const objective = {
    title: 'Herbalist level 30',
    description: '<script>literal text</script>',
    steps: ['Gather herbs', 'Craft potions'],
  }
  const activity = {
    status: 'active' as const,
    character_ids: ['alice'],
    objective,
    issue: '<blocked> Supplies unavailable',
  }
  const active = {
    ...session,
    agent_connection: { ...session.agent_connection, response: { ...session.agent_connection.response, activity } },
  }
  expect(current_agent_activity(active)).toEqual(activity)
  expect(active.agent_view.activity).toEqual([])
  expect(current_agent_activity({ ...active, selected_character_id: 'bob' })).toBeNull()
  expect(current_agent_activity({ ...active, wallet: { ...base.wallet!, address: 'other-owner' } })).toBeNull()
  expect(current_agent_activity({ ...active, link_status: 'idle' })).toBeNull()
  expect(current_agent_activity({ ...active, agent_view: { ...active.agent_view, request: null } })).toBeNull()
  expect(
    current_agent_activity({
      ...active,
      agent_connection: {
        ...active.agent_connection,
        response: {
          ...active.agent_connection.response,
          bot: { ...active.agent_connection.response.bot, address: 'other-bot' },
        },
      },
    })
  ).toBeNull()
  const copy = {
    ui: {
      agent_activity_label: 'Agent activity',
      agent_activity_active: 'Working',
      agent_activity_idle: 'Waiting for an objective',
      agent_activity_travel: 'Changed location',
    },
  } as unknown as AppCopy
  const render = (value: typeof idle | typeof activity) =>
    renderToStaticMarkup(
      <AgentActivityLog copy={copy} character={character()} history={[{ kind: 'travel' }]} activity={value} />
    )
  const html = render(activity)
  expect(html.indexOf(objective.title)).toBeLessThan(html.indexOf('Changed location'))
  expect(html).toContain('&lt;script&gt;literal text&lt;/script&gt;')
  expect(html).toContain('Gather herbs')
  expect(html).toContain('&lt;blocked&gt; Supplies unavailable')
  expect(html).toContain('Working')
  expect(html).not.toContain('Waiting for an objective')
  const waiting = render(idle)
  expect(waiting).toContain('Waiting for an objective')
  expect(waiting).not.toContain(objective.title)
  expect(waiting.match(/Waiting for an objective/g)).toHaveLength(1)
})

test('spectator wallet reuses live agent balance and cannot display another pairing or owned balance', () => {
  const base = automation_fixture().session
  const pairing = { address: 'agent', multisig_public_key: 'key', signer_mode: 'host-persistent' as const }
  const session = {
    ...base,
    inventory_pairing: pairing,
    agent_view: { ...base.agent_view, request: { pairing, public_identifier: 'google', character_id: 'alice' } },
    agent_inventory: { ...base.agent_inventory, sui_balance_mist: 1_239_999_999n },
    sui_balance_mist: 999_000_000_000n,
  }
  const copy = { ui: { agent_wallet: 'Agent wallet' } } as unknown as AppCopy
  const render = (value: typeof base) => renderToStaticMarkup(<AgentWalletBalance copy={copy} session={value} />)
  const html = render(session)
  expect(html).toContain('1.23')
  expect(html).not.toContain('1.239')
  expect(html).not.toContain('999')
  expect(html).toContain('wallet-trigger')
  expect(html).toContain('Agent wallet')
  expect(html).toContain('aria-haspopup="dialog"')
  expect(render({ ...session, agent_inventory: { ...session.agent_inventory, sui_balance_mist: null } })).toContain('—')
  expect(render({ ...session, inventory_pairing: { ...pairing, address: 'other' } })).toContain('—')
  expect(render({ ...session, agent_view: { ...session.agent_view, request: null } })).toBe('')
})
