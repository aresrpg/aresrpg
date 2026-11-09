// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { valid_agent_observation } from '../src/agent_identity.ts'
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
