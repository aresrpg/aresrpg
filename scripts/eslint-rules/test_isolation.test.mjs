// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RuleTester suite for the CROSS-FILE TEST-POISON tripwire (scripts/eslint-rules/test_isolation.mjs).
// The headline invalid fixture is the measured original: WorldTravelModal.test.jsx's unrestored
// `react-i18next` namespace spy, which made the frontend suite's verdict depend on readdir order
// (macOS green / CI 16 reds on the same commit, 2026-08-07).
// Runs under `bun test` (wired into `ares test`'s unit lane via scripts/ares.mjs).
import { describe, it } from 'bun:test'
import { RuleTester } from 'eslint'

import plugin from './test_isolation.mjs'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
})

tester.run('no-unrestored-namespace-spy', plugin.rules['no-unrestored-namespace-spy'], {
  valid: [
    {
      name: 'the correct pattern — the top-level namespace spy is captured and restored in afterAll',
      code: `
        import * as react_i18next from 'react-i18next'
        const spies = [spyOn(react_i18next, 'useTranslation').mockImplementation(() => ({ t: (k) => k }))]
        afterAll(() => { for (const spy of spies) spy.mockRestore() })
      `,
    },
    {
      name: 'a dynamic-import namespace restored through a single named spy',
      code: `
        const sfx = await import('./sfx.js')
        const alarm = spyOn(sfx, 'play')
        afterAll(() => alarm.mockRestore())
      `,
    },
    {
      name: 'restoreAllMocks is a restore door too',
      code: `
        import * as sfx from './sfx.js'
        spyOn(sfx, 'play')
        afterEach(() => mock.restoreAllMocks())
      `,
    },
    {
      name: 'a spy installed inside a lifecycle hook is already scoped — out of scope by design',
      code: `
        import * as sfx from './sfx.js'
        beforeEach(() => { spyOn(sfx, 'play').mockImplementation(() => {}) })
      `,
    },
    {
      name: 'a spy installed inside a test body is out of scope by design',
      code: `
        import * as sfx from './sfx.js'
        test('plays', () => { spyOn(sfx, 'play') })
      `,
    },
    {
      name: 'globalThis is not a module namespace — its own idiom, out of scope',
      code: `import * as sfx from './sfx.js'; spyOn(globalThis, 'fetch').mockImplementation(async () => ({}))`,
    },
    {
      name: 'console is not a module namespace',
      code: `import * as sfx from './sfx.js'; spyOn(console, 'error').mockImplementation(() => {})`,
    },
    {
      name: 'a NAMED import is not a namespace binding — spying it cannot reach the module record',
      code: `import { helpers } from './helpers.js'; spyOn(helpers, 'run')`,
    },
    {
      name: 'a locally constructed object is the caller’s own — spying it leaks nothing',
      code: `const seam = { play: () => {} }; spyOn(seam, 'play')`,
    },
    {
      name: 'a require() namespace restored explicitly',
      code: `const sfx = require('./sfx.js'); const s = spyOn(sfx, 'play'); afterAll(() => s.mockRestore())`,
    },
  ],
  invalid: [
    {
      name: 'THE MEASURED ORIGINAL — react-i18next useTranslation spied at top level, never restored',
      code: `
        import * as react_i18next from 'react-i18next'
        spyOn(react_i18next, 'useTranslation').mockImplementation(() => ({ t: (k) => k }))
      `,
      errors: [{ messageId: 'unrestoredNamespaceSpy', data: { namespace: 'react_i18next' } }],
    },
    {
      name: 'the same shape through a dynamic import',
      code: `
        const react_i18next = await import('react-i18next')
        spyOn(react_i18next, 'useTranslation').mockImplementation(() => ({ t: (k) => k }))
      `,
      errors: [{ messageId: 'unrestoredNamespaceSpy' }],
    },
    {
      name: 'captured in a const but never restored — the capture is not the cure',
      code: `
        import * as sfx from '../core/audio/sfx.js'
        const alarm = spyOn(sfx, 'play_fight_sfx').mockImplementation(() => {})
      `,
      errors: [{ messageId: 'unrestoredNamespaceSpy', data: { namespace: 'sfx' } }],
    },
    {
      name: 'a require() namespace spied at top level with no restore',
      code: `const sfx = require('./sfx.js'); spyOn(sfx, 'play')`,
      errors: [{ messageId: 'unrestoredNamespaceSpy' }],
    },
    {
      name: 'two unrestored namespace spies are two findings',
      code: `
        import * as a from './a.js'
        import * as b from './b.js'
        spyOn(a, 'one')
        spyOn(b, 'two')
      `,
      errors: [{ messageId: 'unrestoredNamespaceSpy' }, { messageId: 'unrestoredNamespaceSpy' }],
    },
  ],
})
