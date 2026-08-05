// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1759 — "the FIRST-EVER friend add does nothing; a retry works". The create→add split cannot become one PTB
// (friends.move:67 `create_friend_list` transfers the list and returns unit — composing it needs an ADDITIVE
// Move entry, which is chain-side), so the client bridges the gap with a bounded readability wait. That wait
// THREW, straight into `add_friend_address_flow`'s bare `catch {}` — the arm reserved for failures a humanizing
// toast already spoke for. Result: the list was created, its gas was spent, and the player got nothing at all —
// no roster row, no error, no reason to press the button again. The retry only "worked" because the list
// existed by then.
//
// The wait's verdict is DATA now, so the exhausted path has a caller that can speak. Pure injection — the
// function takes its own `get_sdk_fn`/`sleep_fn` seams, zero mock.module (house law).
//
// RED-FIRST: `await_friend_list_indexed` resolved undefined on success and REJECTED on exhaustion, so no
// caller could branch on it and `friends.list_not_readable_yet` had no home.
import { afterAll, describe, expect, test } from 'bun:test'

// The friends seam sits under the app's auth edge (Enoki registers its wallets at import time and reads
// `window.location`), so a headless load needs the browser globals present BEFORE the static graph links —
// the same install/remove idiom test/p2p/lobby-room.test.js uses for the transport. They are handed back
// afterwards: a global this file installs must never outlive it (the process is shared with 1300 others).
const event_host = (extra = {}) => ({
  ...extra,
  location: { href: 'http://localhost/', origin: 'http://localhost' },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
})
const prior = { window: globalThis.window, document: globalThis.document }
globalThis.window = event_host()
globalThis.document = event_host({ hidden: false })
afterAll(() => {
  if (prior.window === undefined) delete globalThis.window
  else globalThis.window = prior.window
  if (prior.document === undefined) delete globalThis.document
  else globalThis.document = prior.document
})

const { await_friend_list_indexed } = await import('../../src/world-shell/friends_actions.js')
const { default: i18n } = await import('../../src/i18n')

const LIST_ID = `0x${'f'.repeat(64)}`
const OWNER = `0x${'a'.repeat(64)}`

/** A grpc_client stand-in whose friend-list read answers on the Nth poll (0 = never). */
function sdk_reading_on(attempt_that_hits, log) {
  let polls = 0
  return () =>
    Promise.resolve({
      grpc_client: {
        core: {
          getObject: ({ objectId }) => {
            polls += 1
            log?.push(objectId)
            if (attempt_that_hits && polls >= attempt_that_hits)
              return Promise.resolve({ object: { json: { id: objectId, owner: OWNER, friends: { contents: [] } } } })
            // the EXACT shape a fullnode that has not published the object yet answers with — a THROWN read,
            // which is what took the whole first-ever add down after one attempt.
            return Promise.reject(new Error('Object not found'))
          },
        },
      },
    })
}

describe('#1759 — a friend list the network has not published yet is SAID, never swallowed', () => {
  test('the bounded wait answers FALSE when it runs out — a verdict a caller can act on, not a throw', async () => {
    const slept = []
    const verdict = await await_friend_list_indexed(LIST_ID, {
      attempts: 3,
      get_sdk_fn: sdk_reading_on(0),
      sleep_fn: (ms) => {
        slept.push(ms)
        return Promise.resolve()
      },
    })
    expect(verdict).toBe(false)
    expect(slept).toHaveLength(2) // bounded: it waits BETWEEN attempts only, never after the last
  })

  test('it answers TRUE the moment the list resolves, and spends no delay it does not need', async () => {
    const slept = []
    const read = []
    const verdict = await await_friend_list_indexed(LIST_ID, {
      attempts: 4,
      get_sdk_fn: sdk_reading_on(1, read),
      sleep_fn: (ms) => {
        slept.push(ms)
        return Promise.resolve()
      },
    })
    expect(verdict).toBe(true)
    expect(slept).toEqual([])
    expect(read).toEqual([LIST_ID]) // it polls the list the create receipt named, never a re-derived id
  })

  test('a late fullnode still resolves inside the budget', async () => {
    const verdict = await await_friend_list_indexed(LIST_ID, {
      attempts: 4,
      get_sdk_fn: sdk_reading_on(3),
      sleep_fn: () => Promise.resolve(),
    })
    expect(verdict).toBe(true)
  })

  test('the exhausted path has honest copy in all six locales — and it never invites a second create', () => {
    for (const language of ['en', 'fr', 'de', 'es', 'ja', 'uk']) {
      const copy = i18n.t('friends.list_not_readable_yet', { lng: language })
      expect(copy).not.toBe('friends.list_not_readable_yet')
      expect(copy.length).toBeGreaterThan(0)
    }
    // the English line says the two things the player needs: the list EXISTS, and pressing Add again is safe
    // (a second `create_friend_list` aborts on chain — EListExists — so the copy must not suggest one).
    expect(i18n.t('friends.list_not_readable_yet', { lng: 'en' })).toMatch(/created/i)
    expect(i18n.t('friends.list_not_readable_yet', { lng: 'en' })).toMatch(/again/i)
  })
})
