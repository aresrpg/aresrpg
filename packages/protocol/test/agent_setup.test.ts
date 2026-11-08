// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { valid_agent_setup_request } from '../src/agent_setup.ts'

const token = 'a'.repeat(43)
test('every setup action requires exactly its current capability and declared fields', () => {
  for (const request of [
    { action: 'begin', public_identifier: 'public', token },
    { action: 'status', pairing_id: crypto.randomUUID(), token },
    { action: 'cancel', pairing_id: crypto.randomUUID(), token },
  ]) {
    expect(valid_agent_setup_request(request)).toBe(true)
    for (const invalid of [undefined, '', token.slice(1), `${token}=`, [token], { token }])
      expect(valid_agent_setup_request({ ...request, token: invalid })).toBe(false)
    expect(valid_agent_setup_request({ ...request, owner: 'another owner' })).toBe(false)
  }
})
