// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2192 — the credential shapes that may never leave the browser. A zkLogin failure's text is where an
// id_token, a proof or an ephemeral key rides along; these two scrubs are what stands between that text and a
// third-party error store.
import { describe, expect, it } from 'bun:test'

import { redact_jwt, redact_auth_secrets } from '../../src/core/redact'

const jwt =
  'eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiYyJ9.eyJzdWIiOiIxMTIyMzM0NDU1NjY3Nzg4OTkwIiwiYXVkIjoiZ29vZ2xlIn0.QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9w'

describe('redact_jwt — the class gate', () => {
  it('scrubs a token wherever it appears, keeping the sentence around it', () => {
    const scrubbed = redact_jwt(`proof request failed for id_token=${jwt} (400)`)
    expect(scrubbed).toBe('proof request failed for id_token=[jwt] (400)')
  })

  it('scrubs every token in a message, not just the first', () => {
    expect(redact_jwt(`a ${jwt} b ${jwt}`)).toBe('a [jwt] b [jwt]')
  })

  it('leaves diagnostics that are NOT tokens alone — a digest is evidence, not a secret', () => {
    const digest = `0x${'a'.repeat(64)}`
    expect(redact_jwt(`transaction ${digest} failed on chain`)).toContain(digest)
  })
})

describe('redact_auth_secrets — the auth-seam scrub', () => {
  it('also takes opaque key/proof/salt material', () => {
    const proof = 'A'.repeat(64)
    const ephemeral = `suiprivkey1qq${'z'.repeat(50)}`
    const scrubbed = redact_auth_secrets(`zkp=${proof} ephemeral=${ephemeral}`)
    expect(scrubbed).not.toContain(proof)
    expect(scrubbed).not.toContain(ephemeral)
    expect(scrubbed).toContain('[redacted]')
  })

  it('leaves short diagnostic text alone — the whole point is to keep the cause readable', () => {
    expect(redact_auth_secrets('Invalid JWT: token expired at epoch 812')).toBe(
      'Invalid JWT: token expired at epoch 812'
    )
  })
})
