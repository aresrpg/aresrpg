// LATENCY LANE 2 — the per-fight-session Fight shared-ref cache: hit/miss, one owner-read then cache-hit
// (zero further reads), graceful null on read failure / non-shared object (⇒ id-string fallback, never a
// fabricated ref), and boundary clear. No module mocking — `ensure_fight_shared_ref` takes the sdk seam as a
// param, so a plain fake sdk with a call-counted getObject is the whole harness (mock.module is process-global).
import { afterEach, describe, expect, test } from 'bun:test'

import {
  remember_fight_shared_version,
  fight_shared_ref,
  ensure_fight_shared_ref,
  clear_fight_ref_cache,
} from './fight_ref_cache.js'

const FIGHT = '0x' + 'cd'.repeat(32)

afterEach(() => clear_fight_ref_cache()) // module-level Map is process-global — clear between tests

const fake_sdk = (owner, onCall = () => {}) => ({
  grpc_client: {
    core: {
      getObject: async () => {
        onCall()
        return { object: { owner } }
      },
    },
  },
})
const shared_owner = (isv) => ({ $kind: 'Shared', Shared: { initialSharedVersion: isv } })

describe('fight_shared_ref (pure cache read)', () => {
  test('miss ⇒ null (caller degrades to the id string → resolve round-trip, today’s behavior)', () => {
    expect(fight_shared_ref(FIGHT)).toBeNull()
  })
  test('remember then read ⇒ pinned ref; mutable defaults true (&mut Fight), explicit false honored', () => {
    remember_fight_shared_version(FIGHT, '934')
    expect(fight_shared_ref(FIGHT)).toEqual({ objectId: FIGHT, initialSharedVersion: '934', mutable: true })
    expect(fight_shared_ref(FIGHT, false).mutable).toBe(false)
  })
  test('coerces a numeric version to string (SharedObjectRef wants a string)', () => {
    remember_fight_shared_version(FIGHT, 934)
    expect(fight_shared_ref(FIGHT).initialSharedVersion).toBe('934')
  })
})

describe('ensure_fight_shared_ref (lazy one-read capture)', () => {
  test('cold ⇒ ONE owner-read, caches the immutable isv; second call is a cache HIT (zero reads)', async () => {
    let reads = 0
    const sdk = fake_sdk(shared_owner('555'), () => reads++)
    const ref = await ensure_fight_shared_ref(sdk, FIGHT)
    expect(ref).toEqual({ objectId: FIGHT, initialSharedVersion: '555', mutable: true })
    expect(reads).toBe(1)
    const again = await ensure_fight_shared_ref(sdk, FIGHT)
    expect(again).toEqual(ref)
    expect(reads).toBe(1) // no second read — served from cache
  })
  test('read THROWS ⇒ null, nothing cached (id-string fallback stays correct; never fabricate a ref)', async () => {
    const sdk = {
      grpc_client: {
        core: {
          getObject: async () => {
            throw new Error('rpc down')
          },
        },
      },
    }
    expect(await ensure_fight_shared_ref(sdk, FIGHT)).toBeNull()
    expect(fight_shared_ref(FIGHT)).toBeNull()
  })
  test('object not shared (no Shared.initialSharedVersion) ⇒ null, nothing cached', async () => {
    const sdk = fake_sdk({ $kind: 'AddressOwner', AddressOwner: '0x1' })
    expect(await ensure_fight_shared_ref(sdk, FIGHT)).toBeNull()
    expect(fight_shared_ref(FIGHT)).toBeNull()
  })
  test('no fight_id ⇒ null, no read', async () => {
    let reads = 0
    const sdk = fake_sdk(shared_owner('1'), () => reads++)
    expect(await ensure_fight_shared_ref(sdk, null)).toBeNull()
    expect(reads).toBe(0)
  })
})

test('clear_fight_ref_cache drops every entry (fight boundary hygiene)', () => {
  remember_fight_shared_version(FIGHT, '1')
  remember_fight_shared_version('0x' + 'ef'.repeat(32), '2')
  clear_fight_ref_cache()
  expect(fight_shared_ref(FIGHT)).toBeNull()
  expect(fight_shared_ref('0x' + 'ef'.repeat(32))).toBeNull()
})
