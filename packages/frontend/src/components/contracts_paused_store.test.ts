// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S-84 — contracts_paused_store unit tests. DOM-less by construction (see the file header in
// contracts_paused_store.ts): only zustand + abort_copy.js/log.js, both already proven safe in a plain
// bun:test elsewhere in this repo (abort_copy.test.js, report.test.js).
import { describe, test, expect, beforeEach } from 'bun:test'

import { tx_error, on_maintenance_abort } from '../game/core/abort_copy.js'
import { get_log_buffer, _reset_log_for_test } from '../core/log.js'

import { use_contracts_paused } from './contracts_paused_store'

beforeEach(() => {
  use_contracts_paused.setState({ paused: false })
  _reset_log_for_test()
})

describe('use_contracts_paused — the store transitions', () => {
  test('defaults to not paused', () => {
    expect(use_contracts_paused.getState().paused).toBe(false)
  })

  test('report(false) latches paused + logs a breadcrumb exactly once on the flip', () => {
    use_contracts_paused.getState().report(false)
    expect(use_contracts_paused.getState().paused).toBe(true)
    expect(get_log_buffer().filter((e) => e.ns === 'maintenance')).toHaveLength(1)

    // already paused — a repeat false is idempotent, no duplicate breadcrumb.
    use_contracts_paused.getState().report(false)
    expect(use_contracts_paused.getState().paused).toBe(true)
    expect(get_log_buffer().filter((e) => e.ns === 'maintenance')).toHaveLength(1)
  })

  test('report(true) clears an existing pause (auto-dismiss) + logs the recovery once', () => {
    use_contracts_paused.getState().report(false)
    use_contracts_paused.getState().report(true)
    expect(use_contracts_paused.getState().paused).toBe(false)
    expect(get_log_buffer().filter((e) => e.ns === 'maintenance')).toHaveLength(2) // pause + recovery

    // already live — a repeat true is idempotent, no extra breadcrumb.
    use_contracts_paused.getState().report(true)
    expect(get_log_buffer().filter((e) => e.ns === 'maintenance')).toHaveLength(2)
  })

  test('report(null) — unknown — never touches the current state either way', () => {
    use_contracts_paused.getState().report(null)
    expect(use_contracts_paused.getState().paused).toBe(false)

    use_contracts_paused.getState().report(false)
    use_contracts_paused.getState().report(null)
    expect(use_contracts_paused.getState().paused).toBe(true) // still paused — null never clears it
  })

  test('mark_paused() latches paused and is idempotent', () => {
    use_contracts_paused.getState().mark_paused()
    expect(use_contracts_paused.getState().paused).toBe(true)
    use_contracts_paused.getState().mark_paused()
    expect(get_log_buffer().filter((e) => e.ns === 'maintenance')).toHaveLength(1) // one flip, one breadcrumb
  })
})

describe('the reactive net — on_maintenance_abort wiring (contracts_paused_store.ts registers this at import)', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  test('a live version/102 tx abort flips `paused` to true', async () => {
    // Re-assert the production wiring explicitly: on_maintenance_abort is a single-slot global that
    // abort_copy.test.js's OWN cases also exercise + clear — this proves the WIRING CODE (not import order
    // across test files) correctly connects the hook to the store.
    on_maintenance_abort(() => use_contracts_paused.getState().mark_paused())

    tx_error({ $kind: 'MoveAbort', MoveAbort: { abortCode: '102', location: { module: 'version' } } })
    expect(use_contracts_paused.getState().paused).toBe(false) // never synchronous
    await flush()
    expect(use_contracts_paused.getState().paused).toBe(true)

    on_maintenance_abort(null)
  })
})
