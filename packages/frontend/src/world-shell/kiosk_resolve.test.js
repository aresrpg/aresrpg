// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// buy_destination_kiosk resolution tests (the mirror of the settlement bug): a purchase must land in the ACTIVE
// character's kiosk (the SAME kiosk equip/dungeon-burn resolve), not a first-cap sibling that strands it. Pure
// injection — every function takes `sdk` as a param, so a plain mock drives it; ZERO mock.module (process-global
// collision law). Models a real live wallet: cap[0] is NOT the character's kiosk.

import { afterAll, beforeEach, describe, expect, it } from 'bun:test'

import { get_log_buffer, _reset_log_for_test } from '../core/log.js'
import { invalidate as invalidate_kiosk_cap_cache } from '../chain/kiosk_cap_cache.js'

import * as kiosk_resolve from './kiosk_resolve.js'
import { buy_destination_kiosk, cap_for_kiosk, join_kiosk_for_character } from './kiosk_resolve.js'

const ADDR = '0xowner'
const CHAR_ID = '0xcharacter'
// Two personal kiosks. cap[0] (KIOSK_FIRST) is FIRST in the list but does NOT hold the character; the character
// is locked in KIOSK_CHAR (the sibling) — the exact multi-kiosk shape that stranded a wallet's keys.
const KIOSK_FIRST = '0xfirstkiosk'
const CAP_FIRST = '0xfirstcap'
const KIOSK_CHAR = '0xcharkiosk'
const CAP_CHAR = '0xcharcap'

const CAPS = [
  { kioskId: KIOSK_FIRST, objectId: CAP_FIRST, isPersonal: true },
  { kioskId: KIOSK_CHAR, objectId: CAP_CHAR, isPersonal: true },
]

/** A mock sdk. `owner_map[id]` = the ObjectOwner getObject reports for `id` (the character's one-hop kiosk). */
function make_sdk(owner_map) {
  return {
    kiosk_client: {
      getOwnedKiosks: async () => ({ kioskOwnerCaps: CAPS }),
    },
    grpc_client: {
      core: {
        getObject: async ({ objectId }) => ({
          object: objectId in owner_map ? { owner: { ObjectOwner: owner_map[objectId] } } : null,
        }),
      },
    },
  }
}

// ── diagnostic spy (the fallback must be LOGGED, never silent) — the outlet is the game_log ring
// buffer now (S-Sentry convention: console is player-silent; the buffer feeds Sentry breadcrumbs).
let info_calls = /** @type {string[]} */ ([])
const snapshot_logs = () => {
  info_calls = get_log_buffer().map((e) => `[${e.ns}] ${e.message}`)
}
beforeEach(() => {
  _reset_log_for_test()
  info_calls = []
  // The resolver reads the wallet-caps through the session cache (chain/kiosk_cap_cache) now; clear it between
  // cases so each test's injected sdk is authoritative (the module-global cache would otherwise bleed one
  // case's CAPS into the next — the exact thing wallet-switch invalidation guards against in production).
  invalidate_kiosk_cap_cache()
  // #123 (test ceremony / shared-fixture class): kiosk_resolve.js's record_probe only fires
  // game_log('kiosk_probe', ...) when `typeof window !== 'undefined'` — a browser-context gate. globalThis is
  // process-wide, and several OTHER world-shell/game test files deliberately LEAVE `window` defined forever
  // once first set (documented non-cleanup — "deleting window in an afterAll races other files' module
  // initialization when the scoped game suite runs concurrently"). Every test below this line assumes a
  // headless (no window) environment to keep the probe silent; reset-before-use rather than trust whatever an
  // earlier file left behind. The 'kiosk_for_character branch identity' describe block re-arms its own window
  // per test (it wants the probe active) — this delete always runs first (outer beforeEach).
  delete globalThis.window
})

describe('buy_destination_kiosk (purchase lock-target resolution)', () => {
  // #123 ROOT CAUSE (found + fixed, was LIVE-CANDIDATE #117): the extra log.info line was kiosk_resolve.js's
  // OWN record_probe firing — it only calls game_log('kiosk_probe', ...) when `typeof window !== 'undefined'`,
  // and several OTHER world-shell/game test files deliberately leave globalThis.window defined forever once
  // first set (a documented non-cleanup — deleting it in afterAll would race concurrent module init). This
  // file's own 'kiosk_for_character branch identity' describe block below is the only one meant to see the
  // probe fire; these tests never expected window to exist at all. Fixed at the source: the file-level
  // beforeEach above now deletes globalThis.window before every test regardless of what an earlier file left
  // behind (reset-before-use), and that describe block re-arms its own window per test.
  it('active character → the CHARACTER’s kiosk (never first-cap), silently', async () => {
    // The character is one-hop owned by KIOSK_CHAR (the sibling, not cap[0]).
    const sdk = make_sdk({ [CHAR_ID]: KIOSK_CHAR })
    const handle = await buy_destination_kiosk(sdk, ADDR, CHAR_ID)
    expect(handle).toEqual({ kiosk_id: KIOSK_CHAR, personal_kiosk_cap_id: CAP_CHAR })
    snapshot_logs()
    // NOT the first cap — this is the whole fix.
    expect(handle.kiosk_id).not.toBe(KIOSK_FIRST)
    // Normal path logs nothing (only the fallback narrates).
    expect(info_calls.length).toBe(0)
  })

  it('no active character (roster-screen buy) → any personal kiosk, LOGGED', async () => {
    const sdk = make_sdk({})
    const handle = await buy_destination_kiosk(sdk, ADDR, null)
    expect(handle).toEqual({ kiosk_id: KIOSK_FIRST, personal_kiosk_cap_id: CAP_FIRST })
    snapshot_logs()
    expect(info_calls.length).toBe(1)
    expect(info_calls[0]).toContain(KIOSK_FIRST)
  })

  // #123 ROOT CAUSE (found + fixed, was LIVE-CANDIDATE #117): same globalThis.window leak as the test above,
  // fixed at the source — see that test's comment.
  it('active character but its kiosk unresolvable (escrowed) → fallback + LOGGED', async () => {
    // getObject returns null for the character → kiosk_for_character yields null → fallback, never silent.
    const sdk = make_sdk({})
    const handle = await buy_destination_kiosk(sdk, ADDR, CHAR_ID)
    expect(handle.kiosk_id).toBe(KIOSK_FIRST)
    snapshot_logs()
    expect(info_calls.length).toBe(1)
    expect(info_calls[0]).toContain(KIOSK_FIRST)
  })

  it('no personal kiosk at all → null (the caller then onboards one)', async () => {
    const sdk = {
      kiosk_client: { getOwnedKiosks: async () => ({ kioskOwnerCaps: [] }) },
      grpc_client: { core: { getObject: async () => ({ object: null }) } },
    }
    const handle = await buy_destination_kiosk(sdk, ADDR, CHAR_ID)
    expect(handle).toBe(null)
    expect(info_calls.length).toBe(0)
  })
})

describe('cap_for_kiosk (cap lookup FROM a known kiosk id — the inverse resolve)', () => {
  it('resolves the cap of a non-first personal kiosk (the stranded-key shape)', async () => {
    const sdk = make_sdk({})
    const cap_id = await cap_for_kiosk(sdk, ADDR, KIOSK_CHAR) // the sibling, not cap[0]
    expect(cap_id).toBe(CAP_CHAR)
  })

  it('resolves cap[0] just as well', async () => {
    const sdk = make_sdk({})
    const cap_id = await cap_for_kiosk(sdk, ADDR, KIOSK_FIRST)
    expect(cap_id).toBe(CAP_FIRST)
  })

  it('unknown / non-personal kiosk id → null', async () => {
    const sdk = make_sdk({})
    expect(await cap_for_kiosk(sdk, ADDR, '0xnotmine')).toBe(null)
  })
})

// join_kiosk_for_character — the create→auto-join race fix. A just-minted character's kiosk pair enters the
// roster reducer from the create receipt, so the auto-join firing seconds later resolves with ZERO reads
// instead of racing the chain-direct owned-object index on a brand-new object. Without a known handle it falls to the
// derive-from-character resolver with a BOUNDED read-only retry (never the join tx). The instant-`sleep` injection
// keeps the backoff test-fast.
/** A spy sdk that counts chain reads and lets the character resolve only from `resolve_on_attempt` onward. */
function spy_sdk({ char_id, resolve_on_attempt = 1, kiosk = KIOSK_CHAR }) {
  let char_reads = 0
  let owned_reads = 0
  return {
    calls: () => ({ char_reads, owned_reads }),
    kiosk_client: {
      getOwnedKiosks: async () => {
        owned_reads += 1
        return { kioskOwnerCaps: CAPS }
      },
    },
    grpc_client: {
      core: {
        getObject: async (/** @type {{objectId:string}} */ { objectId }) => {
          if (objectId !== char_id) return { object: null } // no two-hop needed (char maps one-hop to a cap kiosk)
          char_reads += 1
          // Index lag: the just-minted character is invisible until `resolve_on_attempt` (each walk = one read).
          return { object: char_reads >= resolve_on_attempt ? { owner: { ObjectOwner: kiosk } } : null }
        },
      },
    },
  }
}
const NOOP_SLEEP = async () => {}

describe('join_kiosk_for_character (create→auto-join race — reducer handle + bounded resolver retry)', () => {
  it('receipt-reduced handle → returns the pair with ZERO reads (no resolver call — the whole race fix)', async () => {
    const CHAR = '0xfresh_created'
    const sdk = spy_sdk({ char_id: CHAR })
    const handle = await join_kiosk_for_character(sdk, ADDR, CHAR, {
      known_handle: { kiosk_id: KIOSK_CHAR, personal_kiosk_cap_id: CAP_CHAR },
      sleep: NOOP_SLEEP,
    })
    expect(handle).toEqual({ kiosk_id: KIOSK_CHAR, personal_kiosk_cap_id: CAP_CHAR })
    expect(sdk.calls()).toEqual({ char_reads: 0, owned_reads: 0 }) // no chain read raced the fresh mint
  })

  it('no reducer handle (rejoin / legacy) → derives through the resolver, no retry when visible', async () => {
    const CHAR = '0xlegacy_a'
    const sdk = spy_sdk({ char_id: CHAR, resolve_on_attempt: 1 })
    const handle = await join_kiosk_for_character(sdk, ADDR, CHAR, NOOP_SLEEP)
    expect(handle).toEqual({ kiosk_id: KIOSK_CHAR, personal_kiosk_cap_id: CAP_CHAR })
    expect(sdk.calls().char_reads).toBe(1)
  })

  it('index lag → BOUNDED read retry, resolves on a later attempt (join tx never retried)', async () => {
    const CHAR = '0xlagging'
    const sdk = spy_sdk({ char_id: CHAR, resolve_on_attempt: 3 })
    let sleeps = 0
    const handle = await join_kiosk_for_character(sdk, ADDR, CHAR, async () => {
      sleeps += 1
    })
    expect(handle).toEqual({ kiosk_id: KIOSK_CHAR, personal_kiosk_cap_id: CAP_CHAR })
    expect(sdk.calls().char_reads).toBe(3) // retried the READ until the fresh object surfaced
    expect(sleeps).toBe(2) // two backoffs between three attempts
  })

  it('genuinely absent → null after a BOUNDED 3 attempts (never grinds)', async () => {
    const CHAR = '0xnever'
    const sdk = spy_sdk({ char_id: CHAR, resolve_on_attempt: 99 })
    const handle = await join_kiosk_for_character(sdk, ADDR, CHAR, NOOP_SLEEP)
    expect(handle).toBe(null)
    expect(sdk.calls().char_reads).toBe(3) // exactly 3, then the honest absence (the manual switcher is the retry)
  })

  it('an incomplete reducer handle is ignored (no false hit — falls through to the resolver)', async () => {
    const CHAR = '0xpartial'
    const sdk = spy_sdk({ char_id: CHAR, resolve_on_attempt: 1 })
    const handle = await join_kiosk_for_character(sdk, ADDR, CHAR, {
      // @ts-expect-error — deliberately missing personal_kiosk_cap_id
      known_handle: { kiosk_id: KIOSK_CHAR },
      sleep: NOOP_SLEEP,
    })
    expect(sdk.calls().char_reads).toBe(1) // the partial handle did NOT short-circuit — the resolver ran
    expect(handle).toEqual({ kiosk_id: KIOSK_CHAR, personal_kiosk_cap_id: CAP_CHAR })
  })
})

// ── kiosk_for_character null-path BRANCH IDENTITY (BOOT24b) ────────────────────────────────────────
// Four distinct null paths used to surface downstream as ONE indistinguishable failure ("character
// kiosk did not resolve"); three boots were burned telling them apart forensically. Every probe entry
// now names its branch, and kiosk_resolve_last_failure() hands that identity to callers after a null —
// derived from the SAME probe ring, one home, no new state. The probe records only in a window context
// (it is a browser-side diagnostic), so this block stubs a minimal `window` for its own tests only.
const FIELD_ID = '0xdoffield'

/** sdk whose getObject answers per-id `owner` shapes and whose caps list is injectable. */
function branch_sdk({ owners = {}, caps = CAPS } = {}) {
  return {
    kiosk_client: { getOwnedKiosks: async () => ({ kioskOwnerCaps: caps }) },
    grpc_client: {
      core: {
        getObject: async (/** @type {{objectId:string}} */ { objectId }) => ({
          object: objectId in owners ? { owner: owners[objectId] } : null,
        }),
      },
    },
  }
}

describe('kiosk_for_character branch identity (the four null paths + resolved, each named by the probe)', () => {
  // Re-arms per test: the file-level beforeEach above (outer, runs first) unconditionally deletes
  // globalThis.window, so this describe-scoped beforeEach (inner, runs second) sets it back for every one
  // of ITS OWN tests — the probe this block exercises needs `window` defined to fire.
  beforeEach(() => {
    globalThis.window = /** @type {any} */ ({})
  })
  afterAll(() => {
    delete globalThis.window
    delete globalThis.__ARES_KIOSK_PROBE // no ring residue for other files in this process
  })

  const last_probe = () => {
    const ring = globalThis.__ARES_KIOSK_PROBE ?? []
    return ring[ring.length - 1]
  }

  it("(a) hop-1 owner read yields no ObjectOwner → null, branch 'no_first_owner'", async () => {
    const sdk = branch_sdk({ owners: { [CHAR_ID]: { AddressOwner: ADDR } } })
    expect(await kiosk_resolve.kiosk_for_character(sdk, ADDR, CHAR_ID)).toBe(null)
    expect(last_probe().branch).toBe('no_first_owner')
  })

  it("(b) no PERSONAL caps → null, branch 'no_personal_caps' (root cause wins even with a derivable kiosk id)", async () => {
    // The ownership chain fully resolves to a kiosk id — but the wallet holds zero personal caps, and
    // THAT is the root cause the branch must name (precedence over the two-hop outcome).
    const sdk = branch_sdk({
      owners: { [CHAR_ID]: { ObjectOwner: FIELD_ID }, [FIELD_ID]: { ObjectOwner: KIOSK_CHAR } },
      caps: [{ kioskId: KIOSK_CHAR, objectId: CAP_CHAR, isPersonal: false }],
    })
    expect(await kiosk_resolve.kiosk_for_character(sdk, ADDR, CHAR_ID)).toBe(null)
    expect(last_probe().branch).toBe('no_personal_caps')
  })

  it("(c) one-hop miss AND hop-2 yields no kiosk id → null, branch 'two_hop_no_kiosk'", async () => {
    const sdk = branch_sdk({
      owners: { [CHAR_ID]: { ObjectOwner: FIELD_ID }, [FIELD_ID]: { AddressOwner: ADDR } },
    })
    expect(await kiosk_resolve.kiosk_for_character(sdk, ADDR, CHAR_ID)).toBe(null)
    expect(last_probe().branch).toBe('two_hop_no_kiosk')
  })

  it("(d) hop-2 kiosk id found but matching no cap → null, branch 'no_cap_match'", async () => {
    const sdk = branch_sdk({
      owners: { [CHAR_ID]: { ObjectOwner: FIELD_ID }, [FIELD_ID]: { ObjectOwner: '0xforeign_kiosk' } },
    })
    expect(await kiosk_resolve.kiosk_for_character(sdk, ADDR, CHAR_ID)).toBe(null)
    expect(last_probe().branch).toBe('no_cap_match')
  })

  it("success → handle + branch 'resolved'", async () => {
    const sdk = branch_sdk({ owners: { [CHAR_ID]: { ObjectOwner: KIOSK_CHAR } } })
    expect(await kiosk_resolve.kiosk_for_character(sdk, ADDR, CHAR_ID)).toEqual({
      kiosk_id: KIOSK_CHAR,
      personal_kiosk_cap_id: CAP_CHAR,
    })
    expect(last_probe().branch).toBe('resolved')
  })

  it('kiosk_resolve_last_failure() hands the null identity to callers off the SAME ring', async () => {
    expect(typeof kiosk_resolve.kiosk_resolve_last_failure).toBe('function')
    const sdk = branch_sdk({ owners: { [CHAR_ID]: { AddressOwner: ADDR } } })
    expect(await kiosk_resolve.kiosk_for_character(sdk, ADDR, CHAR_ID)).toBe(null)
    const failure = kiosk_resolve.kiosk_resolve_last_failure()
    expect(failure?.branch).toBe('no_first_owner')
    expect(failure?.character_id).toBe(CHAR_ID)
    expect(typeof failure?.t).toBe('number')
  })
})

// ── S-57 UX: the wallet-caps read is CACHED, not re-run per resolve (repeated queries were slowing the UX).
// Every gameplay tx (equip / buy / dungeon / fight / feed) resolves its
// character's kiosk through kiosk_for_character; at HEAD each call re-ran getOwnedKiosks — 1-3s on a multi-kiosk
// zkLogin wallet, UNTIMED (it fires before the tx clock starts, so it hid from the latency table). A
// PersonalKioskCap is SOULBOUND, so the caps are read ONCE per session. RED at HEAD: two resolves = two reads.
describe('kiosk_for_character caches the wallet-caps read (no getOwnedKiosks per gameplay tx)', () => {
  /** Counts getOwnedKiosks + getObject; character one-hop-owned by KIOSK_CHAR (the non-first sibling, cap[1]). */
  function counting_sdk() {
    let owned_reads = 0
    let char_reads = 0
    return {
      reads: () => ({ owned_reads, char_reads }),
      kiosk_client: {
        getOwnedKiosks: async () => {
          owned_reads += 1
          return { kioskOwnerCaps: CAPS }
        },
      },
      grpc_client: {
        core: {
          getObject: async () => {
            char_reads += 1
            return { object: { owner: { ObjectOwner: KIOSK_CHAR } } }
          },
        },
      },
    }
  }

  it('two sequential resolves for the same wallet make ONE getOwnedKiosks (RED at HEAD: two)', async () => {
    const sdk = counting_sdk()
    await kiosk_resolve.kiosk_for_character(sdk, ADDR, CHAR_ID)
    await kiosk_resolve.kiosk_for_character(sdk, ADDR, CHAR_ID)
    expect(sdk.reads().owned_reads).toBe(1) // second resolve is a cache hit — the soulbound cap never re-reads
    expect(sdk.reads().char_reads).toBe(2) // the character-owner read is NOT cached (only the wallet caps are)
  })

  it('money-path equivalence: the cached resolve returns the EXACT cap the live read would (char kiosk, never cap[0])', async () => {
    const sdk = counting_sdk()
    const live = await kiosk_resolve.kiosk_for_character(sdk, ADDR, CHAR_ID) // cold: the live getOwnedKiosks read
    const cached = await kiosk_resolve.kiosk_for_character(sdk, ADDR, CHAR_ID) // warm: served from the cache
    // The cache returns the SAME handle the live read produced — and it is the CHARACTER's kiosk (KIOSK_CHAR /
    // CAP_CHAR), the identity a fresh getOwnedKiosks picks, NOT the first-cap sibling. The cache never changes
    // WHICH kiosk resolves (the money-path law — a wrong cap builds a PTB the chain aborts, EItemNotFound).
    expect(live).toEqual({ kiosk_id: KIOSK_CHAR, personal_kiosk_cap_id: CAP_CHAR })
    expect(cached).toEqual(live)
    expect(cached.kiosk_id).not.toBe(KIOSK_FIRST)
    expect(sdk.reads().owned_reads).toBe(1)
  })

  it('two-hop (DOF Field → kiosk) stays correct through the cache, still ONE caps read', async () => {
    // character → DOF Field wrapper (FIELD_ID) → kiosk (KIOSK_CHAR): the one-hop misses, the two-hop resolves.
    let owned_reads = 0
    const owners = { [CHAR_ID]: { ObjectOwner: FIELD_ID }, [FIELD_ID]: { ObjectOwner: KIOSK_CHAR } }
    const sdk = {
      reads: () => owned_reads,
      kiosk_client: {
        getOwnedKiosks: async () => {
          owned_reads += 1
          return { kioskOwnerCaps: CAPS }
        },
      },
      grpc_client: {
        core: {
          getObject: async (/** @type {{objectId:string}} */ { objectId }) => ({
            object: objectId in owners ? { owner: owners[objectId] } : null,
          }),
        },
      },
    }
    const live = await kiosk_resolve.kiosk_for_character(sdk, ADDR, CHAR_ID)
    const cached = await kiosk_resolve.kiosk_for_character(sdk, ADDR, CHAR_ID)
    expect(live).toEqual({ kiosk_id: KIOSK_CHAR, personal_kiosk_cap_id: CAP_CHAR })
    expect(cached).toEqual(live) // the two-hop walk still resolves the same cap on the cached caps set
    expect(sdk.reads()).toBe(1) // caps cached across both resolves, even though each still walks the char owner
  })

  it('any_personal_kiosk and cap_for_kiosk share the same cached caps read (zero extra getOwnedKiosks)', async () => {
    const sdk = counting_sdk()
    const any = await kiosk_resolve.any_personal_kiosk(sdk, ADDR)
    const cap_id = await kiosk_resolve.cap_for_kiosk(sdk, ADDR, KIOSK_CHAR)
    expect(any).toEqual({ kiosk_id: KIOSK_FIRST, personal_kiosk_cap_id: CAP_FIRST }) // first personal = cap[0]
    expect(cap_id).toBe(CAP_CHAR) // the inverse lookup, from the same cached list
    expect(sdk.reads().owned_reads).toBe(1)
  })
})

// ── THE CACHE LAW transition (DECISIONS 08:12: never cache absence without an invalidation edge) ─────
// A FRESH wallet's just-minted PersonalKioskCap lags the owned-object index a checkpoint or two (the same lag
// join_kiosk_for_character's read retries absorb). At HEAD get_personal_caps froze that empty caps read FOREVER
// — no invalidation edge fires on character-create / world-join (only buy + wallet-reset), so every gameplay
// resolve after the fresh join returned a permanent null cap (branch no_personal_caps → all SEVEN callers dead).
// This is the law's mandated TRANSITION case: absent → the cap indexes → the NEXT resolve must find it live.
describe('kiosk_for_character re-resolves once a fresh wallet’s PersonalKioskCap finally indexes (THE CACHE LAW)', () => {
  it('cap not yet indexed → null; after it indexes, the next resolve finds it via ONE new live read', async () => {
    let owned_reads = 0
    let caps = /** @type {any[]} */ ([]) // fresh wallet: the PersonalKioskCap has not hit the owned-object index yet
    const sdk = {
      reads: () => owned_reads,
      kiosk_client: {
        getOwnedKiosks: async () => {
          owned_reads += 1
          return { kioskOwnerCaps: caps }
        },
      },
      grpc_client: {
        // The character is kiosk-locked from mint — its owner is stable at KIOSK_CHAR the whole time; only the
        // wallet's cap visibility lags, so the caps read is the ONLY variable across the transition.
        core: {
          getObject: async (/** @type {{objectId:string}} */ { objectId }) => ({
            object: objectId === CHAR_ID ? { owner: { ObjectOwner: KIOSK_CHAR } } : null,
          }),
        },
      },
    }
    // (1) fresh join: caps absent → honest null (no_personal_caps), NOT a frozen forever-null.
    expect(await kiosk_resolve.kiosk_for_character(sdk, ADDR, CHAR_ID)).toBeNull()
    // (2) the PersonalKioskCap finally lands in the owned-object index.
    caps = [{ kioskId: KIOSK_CHAR, objectId: CAP_CHAR, isPersonal: true }]
    // (3) the next resolve must re-read live and resolve the handle. RED at HEAD: the frozen [] stays null forever.
    expect(await kiosk_resolve.kiosk_for_character(sdk, ADDR, CHAR_ID)).toEqual({
      kiosk_id: KIOSK_CHAR,
      personal_kiosk_cap_id: CAP_CHAR,
    })
    expect(sdk.reads()).toBe(2) // exactly one new live caps read for the second resolve — the empty was never memoized
  })
})
