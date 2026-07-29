// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, mock, test } from 'bun:test'

import { create_zklogin_zkp_with_retry } from '../../src/auth/zklogin_proof_retry'

const enoki_400 = (response_body: string) => {
  const error = Object.assign(new Error('Request to Enoki API failed (status: 400)'), {
    name: 'EnokiClientError',
    status: 400,
    errors: JSON.parse(response_body).errors,
  })
  return error
}

describe('first-sign zkLogin proof recovery', () => {
  test('a mismatched first-sign pair silently re-derives once and succeeds', async () => {
    const committed_materials = {
      ephemeral_public_key: 'jwt-ephemeral-key',
      max_epoch: 42,
      randomness: 'jwt-randomness',
      nonce: 'jwt-committed-nonce',
    }
    const stale_materials = {
      ephemeral_public_key: 'stale-ephemeral-key',
      max_epoch: 41,
      randomness: 'stale-randomness',
      nonce: 'stale-nonce',
    }
    const create_proof = mock(async (materials: typeof committed_materials) => {
      if (
        materials.ephemeral_public_key !== committed_materials.ephemeral_public_key ||
        materials.max_epoch !== committed_materials.max_epoch ||
        materials.randomness !== committed_materials.randomness ||
        materials.nonce !== committed_materials.nonce
      )
        throw enoki_400(
          '{"errors":[{"code":"invalid_request","message":"ephemeralPublicKey does not match JWT nonce"}]}'
        )
      return { proof_points: 'proof' }
    })
    const rederive_materials = mock(async () => committed_materials)
    const log_400_response = mock(() => {})

    const proof = await create_zklogin_zkp_with_retry({
      call_site: 'sign_transaction',
      initial_materials: stale_materials,
      create_proof,
      rederive_materials,
      log_400_response,
    })

    expect(proof).toEqual({ proof_points: 'proof' })
    expect(create_proof).toHaveBeenCalledTimes(2)
    expect(rederive_materials).toHaveBeenCalledTimes(1)
    expect(log_400_response).toHaveBeenCalledTimes(1)
    expect(log_400_response).toHaveBeenCalledWith(
      '{"errors":[{"code":"invalid_request","message":"ephemeralPublicKey does not match JWT nonce"}]}'
    )
  })

  test('the proof retry is unreachable from a transaction-submitting call site', async () => {
    const rederive_materials = mock(async () => ({
      ephemeral_public_key: 'matching-key',
      max_epoch: 42,
      randomness: 'matching-randomness',
    }))

    const failure = await create_zklogin_zkp_with_retry({
      call_site: 'sign_and_execute_transaction',
      initial_materials: {
        ephemeral_public_key: 'stale-key',
        max_epoch: 41,
        randomness: 'stale-randomness',
      },
      create_proof: async () => {
        throw enoki_400('{"errors":[{"message":"maxEpoch does not match JWT nonce"}]}')
      },
      rederive_materials,
      log_400_response: () => {},
    }).then(
      () => null,
      (error: unknown) => error
    )

    expect((failure as { code?: string }).code).toBe('zklogin_proof_unavailable')
    expect(rederive_materials).not.toHaveBeenCalled()
  })
})

test('plain proof-failure copy ships in all six locales', async () => {
  const locales = ['en', 'fr', 'de', 'es', 'ja', 'uk']
  for (const locale of locales) {
    const json = await Bun.file(new URL(`../../src/i18n/locales/${locale}.json`, import.meta.url)).json()
    const copy = json?.errors?.zklogin_proof_unavailable
    expect(typeof copy).toBe('string')
    expect(copy.trim().length).toBeGreaterThan(0)
    expect(copy).not.toMatch(/zkp/i)
  }
})
