// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE ALLOWLIST'S TEETH (#796). SPONSOR_ARESRPG_PACKAGES is a human paste from the ceremony print, while the
// retired set and the framework set are DERIVED from release.json — two homes for one fact, and the env one
// won. An allowlist pasted wider than the derivation therefore disarmed two gates at once:
//
//   · a RETIRED id listed in the env was `is_aresrpg`, which short-circuited the outdated-package check —
//     the retired package stayed silently sponsorable instead of telling the player to refresh;
//   · a FRAMEWORK id listed in the env counted as an aresrpg call, which satisfies the ≥1-aresrpg-call rule —
//     so a bare framework PTB (kiosk/transfer only) became sponsorable.
//
// Fixed by ordering, not by trusting the paste: retired is checked FIRST and unconditionally, and a framework
// id never counts as an aresrpg call. The env can widen WHAT may be called; it can no longer widen the rules.
//
//   bun test ./sponsor.allowlist_retired.test.js   (no Redis, no station — pure scope resolution)
//
// Own process on purpose (like the sibling allowlist suites): the allowlist resolves once, at module load.

import { describe, expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'

import release from '../packages/sdk/src/deployment/release.json' with { type: 'json' }

const { testnet } = release.networks
const ARES = testnet.packages.aresrpg.latest
const [RETIRED] = testnet.packages.engine.previous ?? []
const [, FRAMEWORK] = testnet.system.sponsor_framework_packages // a non-0x2 framework id, full 0x form

process.env.REDIS_URL = ''
// THE DEPLOYED SHAPE: the ceremony print, pasted verbatim — the release-derived ids PLUS the framework ids
// PLUS (the case this file exists for) a retired id that rode along in the paste.
process.env.SPONSOR_ARESRPG_PACKAGES = [ARES, FRAMEWORK, RETIRED].join(',')

const S = await import('./sponsor.mjs')

const OBJ = { objectId: `0x${'11'.repeat(32)}`, version: 5n, digest: 'ES6c9UyVEbXAZWQXUtzvyxvcCQ2FZ9BVgKPnjLXFto1p' }
const kind = async (build) => {
  const tx = new Transaction()
  build(tx)
  return toBase64(await tx.build({ onlyTransactionKind: true }))
}
const refusal = (tx_kind) => {
  try {
    S.assert_ptb_scope(tx_kind)
    return null
  } catch (error) {
    return error
  }
}

describe('a widened allowlist cannot re-open a RETIRED package', () => {
  test('the fixture is the real hazard: a genuinely retired id, genuinely inside the armed allowlist', () => {
    expect(RETIRED).toBeTruthy()
    expect(process.env.SPONSOR_ARESRPG_PACKAGES).toContain(RETIRED)
  })

  test('a retired id in the env allowlist STILL refuses with the outdated-package reason', async () => {
    const k = await kind((tx) => tx.moveCall({ target: `${RETIRED}::actions::act_pass`, arguments: [tx.objectRef(OBJ)] }))
    const error = refusal(k)
    expect(error?.message).toMatch(/sponsor-scope.*outdated-package/)
    expect(S.sponsor_error_response(error).reason).toBe(S.OUTDATED_PACKAGE_REASON)
  })

  test('a retired call is refused even when a CURRENT aresrpg call rides alongside it', async () => {
    const k = await kind((tx) => {
      tx.moveCall({ target: `${ARES}::zones::join_world`, arguments: [tx.objectRef(OBJ)] })
      tx.moveCall({ target: `${RETIRED}::actions::act_pass` })
    })
    expect(S.sponsor_error_response(refusal(k)).reason).toBe(S.OUTDATED_PACKAGE_REASON)
  })
})

describe('a widened allowlist cannot turn a FRAMEWORK call into an aresrpg call', () => {
  test('a framework-only PTB is refused, even with that framework id in the allowlist', async () => {
    const k = await kind((tx) => tx.moveCall({ target: `${FRAMEWORK}::whatever::call` }))
    expect(refusal(k)?.message).toMatch(/sponsor-scope.*no aresrpg MoveCall/)
  })

  test('the SAME PTB plus one real aresrpg call passes (the rule is ≥1 aresrpg call, not "no framework")', async () => {
    const k = await kind((tx) => {
      tx.moveCall({ target: `${FRAMEWORK}::whatever::call` })
      tx.moveCall({ target: `${ARES}::zones::join_world`, arguments: [tx.objectRef(OBJ)] })
    })
    expect(refusal(k)).toBeNull()
  })
})
