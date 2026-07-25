// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// contracts_paused_modal.test.tsx — dismissal wiring (owner ruling 2026-07-24, "I should be able to close
// it"). The real state-machine correctness (dismiss / re-arm) is proven in contracts_paused_store.test.ts;
// this file proves the COMPONENT side, split into what this repo can actually execute:
//
//   1. ContractsPausedModalHost's visibility GATE, through REAL React reconciliation
//      (renderToStaticMarkup) — a dismissed wall renders NOTHING even while `paused` stays true. This is the
//      literal "unmounts" behavior the ticket's RED-FIRST ask wanted proven.
//   2. The SHOWN branch (ContractsPausedModal itself) reaches `createPortal(children, document.body)`
//      unconditionally — and `document` is genuinely undefined in this repo's bun:test (verified directly:
//      a bare createPortal call throws `ReferenceError: document is not defined`, matching
//      contracts_paused_store.ts's header note that no jsdom/RTL harness exists here). So the three dismiss
//      AFFORDANCES (corner X / ESC / backdrop click) can't be exercised by a real click/keydown — they're
//      proven wired to the same `on_dismiss` handler via a source-shape assertion instead, mirroring
//      crush_menu.test.tsx's `crush_menu_source` idiom (used there for the exact same reason: its own
//      portal-based confirm dialog is equally unmountable in this harness).
import { readFileSync } from 'node:fs'

import { describe, test, expect, beforeEach } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import { reset_auth_mock } from '../test_helpers/auth_mock.js'
import i18n from '../i18n'

import { use_contracts_paused } from './contracts_paused_store'

// Dynamic import, AFTER the static imports above (crush_menu.test.tsx's own idiom, for the same reason): Bun's
// mock.module registry must finish registering `../auth`'s double (auth_mock.js's top-level side effect)
// BEFORE contracts_paused_modal.tsx's own `import '../auth'` ever evaluates — a static top-level import here
// races the mock and hits the REAL auth module, which touches `window` at import time and throws.
const contracts_paused_modal = await import('./contracts_paused_modal')
const contracts_paused_modal_source = readFileSync(new URL('./contracts_paused_modal.tsx', import.meta.url), 'utf8')
const modal_frame_source = readFileSync(new URL('./modal_frame.tsx', import.meta.url), 'utf8')

const render_host = () =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <contracts_paused_modal.ContractsPausedModalHost />
    </I18nextProvider>
  )

beforeEach(() => {
  use_contracts_paused.setState({ paused: false, dismissed: false })
  reset_auth_mock()
})

describe('ContractsPausedModalHost — the visibility gate (real render)', () => {
  test('renders nothing while logged out, even if paused', () => {
    reset_auth_mock({ address: null })
    use_contracts_paused.setState({ paused: true, dismissed: false })
    expect(render_host()).toBe('')
  })

  test('renders nothing while not paused', () => {
    reset_auth_mock({ address: '0xplayer' })
    use_contracts_paused.setState({ paused: false, dismissed: false })
    expect(render_host()).toBe('')
  })

  test('renders nothing once dismissed, even though the chain is still confirmed paused — the ticket\'s "unmounts" ask', () => {
    reset_auth_mock({ address: '0xplayer' })
    use_contracts_paused.setState({ paused: true, dismissed: true })
    expect(render_host()).toBe('')
  })
})

describe('the dismiss affordances are wired to on_dismiss (source-shape — no click/keydown DOM harness here)', () => {
  test('Host reads the store dismiss action and threads it to the modal prop', () => {
    expect(contracts_paused_modal_source).toContain('const dismiss = use_contracts_paused((s) => s.dismiss)')
    expect(contracts_paused_modal_source).toContain('on_dismiss={dismiss}')
  })

  // The three dismiss doors (X / Escape / backdrop) were extracted VERBATIM into the shared house dialog
  // shell (modal_frame.tsx) that this modal now re-composes; that file is where the wiring lives, and the
  // modal proves it threads `on_dismiss` into it. One home, same three doors.
  test('the modal hands its on_dismiss to the shared dialog shell', () => {
    expect(contracts_paused_modal_source).toContain('<ModalFrame on_close={on_dismiss}')
  })

  test('the corner X button fires the shell close directly', () => {
    expect(modal_frame_source).toContain('onClick={on_close}')
    expect(modal_frame_source).toContain('<X size={16} className="text-muted" />')
  })

  test('Escape fires the shell close', () => {
    expect(modal_frame_source).toContain("if (event.key === 'Escape') on_close()")
  })

  test('a backdrop click (not a click on the card itself) fires the shell close', () => {
    expect(modal_frame_source).toContain('if (event.target === event.currentTarget) on_close()')
  })
})
