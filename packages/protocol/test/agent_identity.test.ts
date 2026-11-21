// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { RUN_ENDINGS, run_ending, valid_agent_observation, valid_agent_status } from '../src/agent_identity.ts'
import { parse_client_packet } from '../src/packets.ts'

test('legacy setup transport is retired without removing public observation identities', () => {
  for (const type of ['packet/agent_setup_request', 'packet/agent_setup_response'])
    expect(() => parse_client_packet(JSON.stringify({ type, id: 1 }))).toThrow('unknown packet type')
  const observation = {
    public_identifier: 'public-google-identifier',
    character_id: null,
    pairing: { address: `0x${'1'.repeat(64)}`, multisig_public_key: 'public-key', signer_mode: 'host-persistent' },
  }
  expect(valid_agent_observation(observation)).toBe(true)
  expect(
    valid_agent_observation({ ...observation, pairing: { ...observation.pairing, signer_mode: 'disposable' } })
  ).toBe(true)
  expect(valid_agent_observation({ ...observation, character_id: 'invalid' })).toBe(false)
})

test('a status may carry the fees of the wallet and of each run, and nothing malformed passes', () => {
  const run = { id: 'run', character_id: 'hero', status: 'active' }
  const status = { ready: true, event_fence: 1, sampled_at: 10, state: 'active', runs: [run], direct: null }
  // An older bot sends none of the three fields.
  expect(valid_agent_status(status)).toBe(true)
  const paid = { ...status, fees_mist: '69', runs: [{ ...run, fees_mist: '46', dungeon_runs: 2 }] }
  expect(valid_agent_status(paid)).toBe(true)
  // A storage rebate can make a sum of net fees negative.
  expect(valid_agent_status({ ...paid, fees_mist: '-75' })).toBe(true)
  for (const fees_mist of [69, '6.9', '', '1e9', null]) {
    expect(valid_agent_status({ ...status, fees_mist })).toBe(false)
    expect(valid_agent_status({ ...status, runs: [{ ...run, fees_mist }] })).toBe(false)
  }
  for (const dungeon_runs of [-1, 1.5, '2', null])
    expect(valid_agent_status({ ...status, runs: [{ ...run, dungeon_runs }] })).toBe(false)
})

test('a status may say why a run ended by itself: a listed code, and never a malformed one', () => {
  const run = { id: 'run', character_id: 'hero', status: 'completed' }
  const status = { ready: true, event_fence: 1, sampled_at: 10, state: 'idle', runs: [run], direct: null }
  const ended = (reason: unknown) => ({ ...status, runs: [{ ...run, ended: reason }] })
  for (const reason of RUN_ENDINGS) expect(valid_agent_status(ended(reason))).toBe(true)
  // A later bot may add a code: it passes the door, and a reader that does not list it explains nothing.
  expect(valid_agent_status(ended('a_code_added_tomorrow'))).toBe(true)
  for (const reason of [1, true, null, {}, ['objective_reached']]) expect(valid_agent_status(ended(reason))).toBe(false)
  // The bot and every reader share this one list.
  expect(RUN_ENDINGS).toEqual(['objective_reached', 'fee_cap_reached', 'run_cap_reached', 'completed'])
  expect(RUN_ENDINGS.map(run_ending)).toEqual([...RUN_ENDINGS])
  for (const code of ['a_code_added_tomorrow', 'explicit_stop', '', undefined, null, 3])
    expect(run_ending(code)).toBeUndefined()
})
