// LATENCY LANE 2 — proves the &Random builders PIN the 0x8 Random system object (a static SharedObjectRef)
// instead of the SDK's unresolved `tx.object.random()`, so a fight act PTB whose runtime Fight is also passed
// as a cached ref carries ZERO unresolved inputs and BUILDS FULLY OFFLINE (no client, no resolve round-trip).
// Root cause this closes: `tx.object.random()` emits an `UnresolvedObject`, which keeps `needsTransactionResolution`
// true and forces one server-side `simulateTransaction` on EVERY &Random build — measured: pinning the Fight
// alone can't remove it (verified: fight-only pinned still round-trips; fight+random pinned → 0 round-trips).
import { test, expect } from 'bun:test'

import { random_shared_ref } from '../src/deployment/aresrpg.js'
import { commit_turn_ptb, place_ptb } from '../src/fight.js'

const RANDOM_ID =
  '0x0000000000000000000000000000000000000000000000000000000000000008'
// a stand-in cached Fight ref (shared): objectId + immutable initialSharedVersion + mutable (act = &mut Fight)
const FIGHT = { objectId: '0x' + 'ab'.repeat(32), initialSharedVersion: '100', mutable: true }
const CHAR = '0x' + '11'.repeat(32)

const inputs_of = tx => tx.getData().inputs
const shared = (tx, id_suffix) =>
  inputs_of(tx).find(i => (i.Object?.SharedObject?.objectId ?? '').endsWith(id_suffix))?.Object?.SharedObject

test('random_shared_ref: testnet returns a pinned SharedObjectRef for 0x8, mutable:false', () => {
  expect(random_shared_ref('testnet')).toEqual({
    objectId: RANDOM_ID,
    initialSharedVersion: '43342337',
    mutable: false,
  })
})

test('random_shared_ref: an un-stamped network returns null (⇒ builder falls back to tx.object.random())', () => {
  expect(random_shared_ref('mainnet')).toBeNull() // RANDOM version empty pre-ceremony
})

test('commit_turn_ptb (testnet, cached Fight ref): Random is a PINNED SharedObject, not UnresolvedObject', () => {
  const tx = commit_turn_ptb({ network: 'testnet' })({
    fight_id: FIGHT,
    character_id: CHAR,
    actions: [{ kind: 'move', cell: 42 }],
  })
  const r = shared(tx, '0000000000000008')
  expect(r).toBeTruthy()
  expect(r.initialSharedVersion).toBe('43342337')
  expect(r.mutable).toBe(false)
})

test('commit_turn_ptb (testnet, cached Fight ref): ZERO unresolved inputs ⇒ builds fully OFFLINE (no client)', async () => {
  const tx = commit_turn_ptb({ network: 'testnet' })({
    fight_id: FIGHT,
    character_id: CHAR,
    actions: [{ kind: 'move', cell: 42 }],
  })
  // no input may be UnresolvedObject/UnresolvedPure — that is exactly what forces a resolve round-trip
  expect(inputs_of(tx).some(i => i.$kind === 'UnresolvedObject' || i.$kind === 'UnresolvedPure')).toBe(false)
  // and the Fight rides as its pinned shared ref (mutable:true — &mut Fight)
  const f = shared(tx, 'abababab')
  expect(f?.initialSharedVersion).toBe('100')
  expect(f?.mutable).toBe(true)
  // proof: builds with NO client passed (would throw "not sufficient to build offline" if anything unresolved)
  const bytes = await tx.build({ onlyTransactionKind: true })
  expect(bytes.length).toBeGreaterThan(0)
})

test('place_ptb (testnet, cached Fight ref): also builds offline (the &Random terminal placement door)', async () => {
  const tx = place_ptb({ network: 'testnet' })({ fight_id: FIGHT, character_id: CHAR, cell: 7 })
  expect(inputs_of(tx).some(i => i.$kind === 'UnresolvedObject')).toBe(false)
  expect((await tx.build({ onlyTransactionKind: true })).length).toBeGreaterThan(0)
})
