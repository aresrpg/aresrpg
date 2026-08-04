// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2192 — the zkLogin proving rejection is the ONLY evidence of the create-character failure class, and it is
// wrapped into localized toast copy one line after it is thrown. These facts are what we report instead: the
// discriminating fields (name / status / codes) with every secret shape scrubbed, because an auth error's
// message and body are exactly where a JWT, a proof or an ephemeral key would ride along.
import { describe, expect, it } from 'bun:test'

import { enoki_error_facts, zklogin_proving_error } from '../../src/auth/enoki_error_facts'

const jwt =
  'eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiYyJ9.eyJzdWIiOiIxMTIyMzM0NDU1NjY3Nzg4OTkwIiwiYXVkIjoiZ29vZ2xlIn0.QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9w'

describe('enoki_error_facts', () => {
  it('lifts the discriminating fields off an EnokiClientError', () => {
    const error = Object.assign(new Error('Bad Request'), {
      name: 'EnokiClientError',
      status: 400,
      errors: [{ code: 'zklogin_max_epoch_expired', message: 'maxEpoch 812 is in the past' }],
    })
    expect(enoki_error_facts(error)).toEqual({
      name: 'EnokiClientError',
      status: 400,
      codes: ['zklogin_max_epoch_expired'],
      detail: 'Bad Request',
    })
  })

  it('reads the codes out of a response body when the error only carries the raw string', () => {
    const error = Object.assign(new Error('request failed'), {
      name: 'EnokiClientError',
      status: 400,
      response_body: '{"errors":[{"code":"invalid_proof","message":"bad zkp"}]}',
    })
    expect(enoki_error_facts(error).codes).toEqual(['invalid_proof'])
  })

  // THE LEAK SHAPE: an Enoki rejection whose message and body echo the JWT and the proof back at us. Reporting
  // this raw would put a live credential in a third-party error store.
  it('never lets a JWT or proof material reach the reported facts', () => {
    const error = Object.assign(new Error(`zkp request rejected for jwt ${jwt}`), {
      name: 'EnokiClientError',
      status: 400,
      response_body: JSON.stringify({
        errors: [{ code: 'jwt_error', message: `token ${jwt} expired` }],
        proofPoints: { a: ['1'.repeat(77), '2'.repeat(77)] },
      }),
    })
    const facts = enoki_error_facts(error)
    const serialized = JSON.stringify(facts)
    expect(serialized).not.toContain('eyJ')
    expect(serialized).not.toContain(jwt.split('.')[2])
    expect(serialized).not.toContain('1'.repeat(77))
    expect(facts.codes).toEqual(['jwt_error']) // the diagnosis survives the scrub
    expect(facts.status).toBe(400)
  })

  it('flattens the facts into one grouping-friendly reported error, with no raw cause attached', () => {
    const error = zklogin_proving_error({
      name: 'EnokiClientError',
      status: 400,
      codes: ['zklogin_max_epoch_expired'],
      detail: 'Bad Request',
    })
    expect(error.name).toBe('ZkLoginProvingError')
    expect(error.message).toBe('zkLogin proving rejected — EnokiClientError 400 [zklogin_max_epoch_expired]: Bad Request')
    // a `cause` would be walked by Sentry's linked-errors integration — straight past every scrub above
    expect(error.cause).toBeUndefined()
  })

  it('caps the detail so a body dump can never ride along', () => {
    const error = new Error('x'.repeat(5000))
    expect(enoki_error_facts(error).detail.length).toBeLessThanOrEqual(300)
  })

  it('degrades honestly on a non-Enoki rejection (a plain string, a null, a DOMException)', () => {
    expect(enoki_error_facts('boom')).toEqual({ name: 'string', status: null, codes: [], detail: 'boom' })
    expect(enoki_error_facts(null)).toEqual({ name: 'null', status: null, codes: [], detail: '' })
    const aborted = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
    expect(enoki_error_facts(aborted)).toEqual({
      name: 'AbortError',
      status: null,
      codes: [],
      detail: 'The operation was aborted.',
    })
  })
})
