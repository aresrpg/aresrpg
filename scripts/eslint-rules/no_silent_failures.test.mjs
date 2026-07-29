// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RuleTester suite for the SILENT-FAILURE tripwire (scripts/eslint-rules/no_silent_failures.mjs).
//
// TWO CONTROLS, both required (seat law 2026-07-30):
//   POSITIVE (history) — fixtures shaped like the specimens that motivated the rule. Necessary,
//     never sufficient: a rule that only reds on history is a regression suite wearing a gate's name.
//   NEGATIVE (fresh)   — violations authored NEW in this file, in shapes that appear nowhere in the
//     board census or tonight's specimens. They prove the rule generalizes from the CLASS, not from
//     the incidents. Every fresh fixture is a control capable of failing: each one is a legal program
//     that only the rule's own machinery distinguishes from its `valid` twin below.
// Runs under `bun test` (wired into the unit lane via scripts/ares.mjs), same harness as one_pipeline.
import { describe, it } from 'bun:test'
import { RuleTester } from 'eslint'

import plugin from './no_silent_failures.mjs'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
})

tester.run('no-swallowed-failure', plugin.rules['no-swallowed-failure'], {
  valid: [
    // ---- door 1: RE-THROW ----
    {
      name: 'catch that re-throws — the failure keeps travelling',
      code: `try { parse(raw) } catch (e) { throw e }`,
    },
    {
      name: 'catch that decodes once and throws a domain error at the seam (L-D1)',
      code: `try { await send(tx) } catch (e) { throw new ChainError(decode(e)) }`,
    },
    {
      name: '.catch that re-throws after inspecting',
      code: `fetch_rows().catch((e) => { if (is_abort(e)) return { ok: false, error: e }; throw e })`,
    },
    {
      name: '.catch returning Promise.reject keeps the rejection alive',
      code: `load().catch((e) => Promise.reject(e))`,
    },
    // ---- door 2: FAILURE VALUE ----
    {
      name: 'concise arrow returning a reducer-shaped failure',
      code: `read_state().catch((e) => ({ ok: false, error: e }))`,
    },
    {
      name: 'block arrow returning a failure shape',
      code: `read_state().catch((e) => { return { ok: false, code: 'READ_FAILED', error: e } })`,
    },
    {
      name: 'catch returning the caught error itself — failure as data',
      code: `const decode_or_fail = (bytes) => { try { return decode(bytes) } catch (e) { return e } }`,
    },
    {
      name: 'catch returning a member of the caught error',
      code: `const decode_or_fail = (bytes) => { try { return decode(bytes) } catch (e) { return e.message } }`,
    },
    {
      name: 'catch returning a failure constructor',
      code: `const decode_or_fail = (bytes) => { try { return decode(bytes) } catch (e) { return failure(e) } }`,
    },
    {
      name: 'destructured catch binding still counts as carrying the failure',
      code: `load().catch(({ message }) => ({ error: message }))`,
    },
    {
      name: 'reducer-shaped { state, events } return carries the failure as an event',
      code: `const step = (s, c) => { try { return fold(s, c) } catch (e) { return { state: s, events: [{ type: 'error', e }] } } }`,
    },
    // ---- door 3: REPORT through a sanctioned sink ----
    {
      name: 'catch reporting through report_error',
      code: `try { mount() } catch (e) { report_error(e, { where: 'mount' }) }`,
    },
    {
      name: '.catch speaking through game_log',
      code: `save().catch((e) => game_log('inventory', 'save failed', e))`,
    },
    {
      name: '.catch speaking through console.error',
      code: `screenshot(path).catch((e) => console.error('screenshot failed', e))`,
    },
    {
      name: '.catch speaking through the player-facing toast door',
      code: `commit().catch((e) => use_toast.getState().add(humanize_tx_error(e)))`,
    },
    {
      name: '.catch speaking through Sentry',
      code: `boot().catch((e) => Sentry.captureException(e))`,
    },
    {
      name: 'a sink nested one callback deep still speaks',
      code: `load().catch((e) => queueMicrotask(() => report_error(e)))`,
    },
    {
      name: 'a sink on only one branch still speaks — partial speech is speech',
      code: `load().catch((e) => { if (is_offline(e)) return { ok: false, error: e }; console.error(e) })`,
    },
    // ---- out of scope by design (precision over recall) ----
    {
      name: 'a named handler reference is indirect dispatch — not judged',
      code: `load().catch(report_error)`,
    },
    {
      name: 'an unrelated .catch-named method on a non-promise is not judged when handed a reference',
      code: `net.catch(handler)`,
    },
    {
      name: 'allowlisted file — the rule is silent',
      code: `load().catch(() => null)`,
      filename: '/repo/packages/frontend/e2e/probe.spec.ts',
      options: [{ allow: ['/e2e/'] }],
    },
    {
      name: 'a caller-supplied sink registry replaces the default one',
      code: `load().catch((e) => house_channel(e))`,
      options: [{ sinks: ['house_channel'] }],
    },
  ],

  invalid: [
    // ================= POSITIVE CONTROL — the specimen shapes that motivated the rule =================
    {
      name: 'SPECIMEN: .catch(() => undefined) around a screenshot — lied about the artifact',
      code: `page.screenshot({ path: out }).catch(() => undefined)`,
      errors: [{ messageId: 'silentFailure', data: { kind: '`.catch()` handler' } }],
    },
    {
      name: 'SPECIMEN: .catch(() => null) around a fast-path read — made the bug unfalsifiable',
      code: `const read = async (id) => { const row = await read_fast(id).catch(() => null); return row }`,
      errors: [{ messageId: 'silentFailure' }],
    },
    {
      name: 'SPECIMEN: .catch(() => {}) — the empty-arrow form no-empty cannot see',
      code: `registration.update().catch(() => {})`,
      errors: [{ messageId: 'silentFailure' }],
    },
    {
      name: 'SPECIMEN: a refusal that logs busy and shows the player nothing',
      code: `const do_cast = async (spell) => { try { await cast(spell) } catch { set_busy(false) } }`,
      errors: [{ messageId: 'silentFailure', data: { kind: 'catch block' } }],
    },
    {
      name: 'SPECIMEN: a cached negative — the failure becomes an entry nobody can distinguish from truth',
      code: `const icon = async (id) => { try { return await fetch_icon(id) } catch (e) { cache.set(id, MISSING); return MISSING } }`,
      errors: [{ messageId: 'silentFailure' }],
    },

    // ================ NEGATIVE CONTROL — FRESH shapes authored new, in no specimen ================
    // Each is a legal program whose only difference from a `valid` twin above is that it erases.
    {
      name: 'FRESH: a catch that coerces to a numeric default (no null, no undefined anywhere)',
      code: `const parse_level = (raw) => { try { return decode_level(raw) } catch { return 1 } }`,
      errors: [{ messageId: 'silentFailure', data: { kind: 'catch block' } }],
    },
    {
      name: 'FRESH: a catch that increments a private counter and moves on — bookkeeping is not speech',
      code: `try { flush(queue) } catch { failures = failures + 1 }`,
      errors: [{ messageId: 'silentFailure' }],
    },
    {
      name: 'FRESH: an async .catch handler that awaits a cleanup and returns nothing',
      code: `sync_kiosk(id).catch(async (e) => { await release_lock(id) })`,
      errors: [{ messageId: 'silentFailure' }],
    },
    {
      name: 'FRESH: a catch returning an object with no failure key — a coerced success shape',
      code: `const party = async (id) => { try { return await load_party(id) } catch { return { members: [], leader: null } } }`,
      errors: [{ messageId: 'silentFailure' }],
    },
    {
      name: 'FRESH: a ternary whose one branch erases — half a failure value is none',
      code: `read(id).catch((e) => (is_missing(e) ? { ok: false, error: e } : undefined))`,
      errors: [{ messageId: 'silentFailure' }],
    },
    {
      name: 'FRESH: a catch that returns the LAST GOOD value — the staleness is invisible',
      code: `const poll = async () => { try { last_good = await poll_chain() } catch { return last_good } }`,
      errors: [{ messageId: 'silentFailure' }],
    },
    {
      name: 'FRESH: a bare `return` in a catch — an early exit indistinguishable from success',
      code: `async function refresh(id) { try { await pull(id) } catch { return } }`,
      errors: [{ messageId: 'silentFailure' }],
    },
    {
      name: 'FRESH: a .catch that swallows into a resolved promise',
      code: `preload(url).catch(() => Promise.resolve(EMPTY))`,
      errors: [{ messageId: 'silentFailure' }],
    },
    {
      name: 'FRESH: nested — the inner handler speaks, the OUTER one erases',
      code: `outer().catch((e) => { inner().catch((x) => { report_error(x) }) })`,
      errors: [{ messageId: 'silentFailure' }],
    },
    {
      name: 'FRESH: a catch that only re-reads state, discarding the caught binding entirely',
      code: `const send = async (tx) => { try { await commit(tx) } catch (e) { use_fight.getState().refresh() } }`,
      errors: [{ messageId: 'silentFailure' }],
    },
    {
      name: 'FRESH: two independent swallows in one file both red',
      code: `a().catch(() => false)\nb().catch(() => '')`,
      errors: [{ messageId: 'silentFailure' }, { messageId: 'silentFailure' }],
    },
  ],
})
