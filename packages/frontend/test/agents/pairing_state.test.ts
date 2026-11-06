// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { EMPTY_PAIRING, reduce_pairing } from '../../src/agents/pairing_state.ts'

const identity = (address: string) => ({ address, multisig_public_key: 'public', signer_mode: 'disposable' as const })

test('cancelled or replaced attempts ignore late links and verification', () => {
  const started = reduce_pairing(EMPTY_PAIRING, { type: 'start', public_identifier: 'public' })
  const pending = reduce_pairing(started, { type: 'link', attempt: started.attempt, link: 'capability' })
  const cleared = reduce_pairing(pending, { type: 'clear' })
  expect(cleared.link).toBeNull()
  expect(reduce_pairing(cleared, { type: 'link', attempt: started.attempt, link: 'late' })).toBe(cleared)
  expect(reduce_pairing(cleared, { type: 'verified', attempt: started.attempt, identity: identity('late') })).toBe(
    cleared
  )
  const replacement = reduce_pairing(cleared, { type: 'start', public_identifier: 'new' })
  expect(reduce_pairing(replacement, { type: 'failed', attempt: started.attempt })).toBe(replacement)
})
test('verified and failed attempts discard the setup capability', () => {
  const pending = {
    ...EMPTY_PAIRING,
    attempt: 1,
    link: 'capability',
    public_identifier: 'public',
    status: 'waiting' as const,
  }
  const verified = reduce_pairing(pending, { type: 'verified', attempt: 1, identity: identity('verified') })
  expect(verified.link).toBeNull()
  expect(verified.public_identifier).toBeNull()
  expect(verified.identity?.address).toBe('verified')
  const failed = reduce_pairing(pending, { type: 'failed', attempt: 1 })
  expect(failed.link).toBeNull()
  expect(failed.status).toBe('failed')
})

test('verified signer mode reaches the UI and is removed by cancellation', () => {
  const started = reduce_pairing(EMPTY_PAIRING, { type: 'start', public_identifier: 'google' })
  const verified = reduce_pairing(started, {
    type: 'verified',
    attempt: started.attempt,
    identity: { ...identity('agent'), signer_mode: 'host-persistent' },
  })
  expect(verified.identity?.signer_mode).toBe('host-persistent')
  expect(reduce_pairing(verified, { type: 'clear' }).identity).toBeNull()
})
