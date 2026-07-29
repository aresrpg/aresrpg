// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// TEST CONVENTION (#123, cross-file dangling-promise pollution): `get_sdk_implementation` below is
// PROCESS-WIDE (bun's `mock.module` has no unmock API — the whole 337-file `bun test src` run shares ONE
// module instance). A test's async mock — this one or any local `let x = async () => (...)` a test file
// reassigns for a fire-and-forget production call — must NEVER return a promise that resolves on a real
// macrotask timer (`setTimeout(resolve, Nms)`), even when N looks small. A production fire-and-forget call
// (e.g. `void route_settlement(...)`) can chain several `await`s past the mock before its own continuation
// writes to a shared singleton (fight_store/use_dungeon/game_log/this sdk mock) — and that continuation only
// drains inside THIS test's own teardown if it settles strictly before any macrotask boundary. A macrotask
// timer settles LATER than a normal afterEach's `flush_engine()` (setTimeout(0) + a microtask flush) has
// already released these shared singletons to whichever test the process happens to be running next.
// RULE: resolve LATE, never NEVER (a permanently-pending promise hangs the whole shared process at exit —
// the original #117 bug) — but resolve on a MICROTASK (`new Promise((resolve) => queueMicrotask(resolve))`),
// never a macrotask/timer. A microtask-only resolution always finishes before the next timer fires, so it is
// always caught by ITS OWN test's teardown and can never leak into a later file. See
// world-shell/fight_liveness.test.js's two `settle_fight` mocks for the worked example.
//
// SECOND RULE, same issue class: `mock.module('../chain/sdk', ...)` below is the ONE registration for this
// path — bun's mock.module has no unmock API, so the LAST `mock.module()` call any file makes against the
// SAME resolved path wins process-wide, permanently, for every file that runs after it. A file that wants a
// DIFFERENT get_sdk shape must call `set_expedition_sdk_mock(...)` (armed in ITS OWN beforeEach, cleared in
// its afterEach via `reset_expedition_sdk_mock()`) — NEVER a second direct `mock.module('../chain/sdk', ...)`.
// world-shell/world_checkpoint.test.js shipped exactly this violation: a competing static mock.module call
// that, depending on full-suite file order, could silently strip `set_expedition_sdk_mock` of any effect for
// every file downstream (the #123 TypeError — `sdk.grpc_client.core.getObject` on an empty `{}` — was that
// mock's exact return shape leaking into items_sale_actions.test.js). Grep `mock.module(['"].*chain/sdk` before
// adding a new one; there must only ever be this one.
// THIRD RULE, same issue class (#1564): the registration below is not just process-wide, it is
// IRREVERSIBLE — a file that needs the REAL `get_sdk` cannot get it back by importing `../chain/sdk`,
// because bun re-points that module's namespace for every importer the moment this helper loads
// ANYWHERE in the process. The live-chain rows (chain/live_reads.test.js, chain/read_templates.test.js)
// were exactly that victim: green alone, red inside `bun test src` with `expedition SDK mock was not
// configured`, purely because some earlier world-shell file pulled this helper in. So the real
// implementation is captured HERE, as a function VALUE, before the mock.module call below re-points the
// namespace (a captured value survives the swap; the namespace binding does not) — and handed out
// through `use_real_expedition_sdk()`. One home owns both shapes; nothing weakens the loud
// unconfigured throw, which stays the default for every other file.
import { mock } from 'bun:test'

// A COPIED value, deliberately — an ESM `import { get_sdk }` binding is live and follows the swap below
// straight back into this module's own indirection (an infinite recursion); a const copy does not.
const real_get_sdk = (await import('../chain/sdk')).get_sdk

const unconfigured_get_sdk = async () => {
  throw new Error('expedition SDK mock was not configured')
}

let get_sdk_implementation = unconfigured_get_sdk

export const set_expedition_sdk_mock = (implementation) => {
  get_sdk_implementation = implementation
}

export const reset_expedition_sdk_mock = () => {
  get_sdk_implementation = unconfigured_get_sdk
}

/** Opt a live-chain suite back onto the REAL, unmocked `get_sdk` — the one sanctioned escape. */
export const use_real_expedition_sdk = () => {
  get_sdk_implementation = real_get_sdk
}

mock.module('../chain/sdk', () => ({
  get_sdk: (...args) => get_sdk_implementation(...args),
}))
