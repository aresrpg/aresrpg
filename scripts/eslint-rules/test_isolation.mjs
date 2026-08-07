// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// scripts/eslint-rules/test_isolation.mjs — THE CROSS-FILE TEST-POISON TRIPWIRE.
//
// The class it catches: a test file that replaces a shared module's export and never puts it back.
// `bun test` runs a package's whole suite in ONE process, so a module namespace is process-global:
// `spyOn(namespace, 'export')` at module top level rewrites that export for EVERY file loaded after
// this one, and the only thing deciding who "after" means is the filesystem's readdir order.
//
// This is the same hazard the written law already covers for `mock.module` — but through a door nobody
// wrote down, which is precisely why it bit. Measured 2026-08-07: WorldTravelModal.test.jsx spied
// `react-i18next`'s `useTranslation` with a `{ t }`-only stub and never restored it. Run first (macOS
// readdir), a sibling's `afterAll` healed the module and the suite was green; run last (CI readdir), the
// stub survived and 16 unrelated tests died on `i18n.resolvedLanguage`. Same tree, same commit, opposite
// verdicts — the suite's answer depended on the machine.
//
// The law: a top-level namespace spy must be RESTORED. Like the other house tripwires this is LEXICAL,
// not a type system — precision over recall:
//   · Only NAMESPACE bindings are judged (`import * as ns`, `const ns = await import(…)`,
//     `const ns = require(…)`). `spyOn(console, …)`, `spyOn(globalThis, …)` and `spyOn(local_obj, …)`
//     are out of scope: they are process-global too, but they are not the module-record class and they
//     carry their own idioms (see the follow-up named in the lane's return).
//   · Only TOP-LEVEL spies are judged. A spy installed inside `beforeEach`/`test` is already scoped by a
//     lifecycle hook by construction; a top-level one is installed at IMPORT time and has no owner.
//   · A file that restores ANYWHERE is unrestored nowhere: one `mockRestore()`/`restoreAllMocks()` call
//     clears the file. A file that installs two spies and restores one is a rarity not worth the false
//     positives — the same "speaks anywhere" idiom no_silent_failures.mjs uses for its sinks.

const FUNCTION_TYPES = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'])

// The restore doors. Matched as fragments against the callee's source text, so `spy.mockRestore()`,
// `for (const s of spies) s.mockRestore()` and `mock.restoreAllMocks()` all count.
const RESTORE_DOORS = ['mockRestore', 'restoreAllMocks']

const is_module_top_level = (node) => {
  let current = node.parent
  while (current) {
    if (FUNCTION_TYPES.has(current.type)) return false
    current = current.parent
  }
  return true
}

/** `require('x')` or `await import('x')` or `import('x')` — the runtime forms of a namespace import. */
const is_module_load = (init) => {
  if (!init) return false
  const expression = init.type === 'AwaitExpression' ? init.argument : init
  if (expression?.type === 'ImportExpression') return true
  return expression?.type === 'CallExpression' && expression.callee?.name === 'require'
}

const no_unrestored_namespace_spy = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'a top-level spyOn over an imported module namespace must be restored — an unrestored one rewrites that export for every test file loaded afterwards',
    },
    schema: [],
    messages: {
      unrestoredNamespaceSpy:
        'this top-level `spyOn({{namespace}}, …)` rewrites a PROCESS-GLOBAL module record and is never ' +
        'restored, so every test file loaded after this one sees the stub — and which files those are is ' +
        'decided by readdir order, not by you. Capture the spy and restore it: ' +
        '`const spies = [spyOn({{namespace}}, …)]` plus `afterAll(() => { for (const spy of spies) spy.mockRestore() })`.',
    },
  },
  create(context) {
    const source_code = context.sourceCode
    const namespaces = new Set()
    const spies = []
    let restores = false

    return {
      ImportNamespaceSpecifier(node) {
        namespaces.add(node.local.name)
      },
      VariableDeclarator(node) {
        if (node.id.type === 'Identifier' && is_module_load(node.init)) namespaces.add(node.id.name)
      },
      CallExpression(node) {
        const callee = source_code.getText(node.callee)
        if (RESTORE_DOORS.some((door) => callee.includes(door))) restores = true
        if (callee !== 'spyOn' && !callee.endsWith('.spyOn')) return
        if (node.arguments[0]?.type !== 'Identifier') return
        if (!is_module_top_level(node)) return
        spies.push(node)
      },
      'Program:exit'() {
        if (restores) return
        for (const node of spies)
          if (namespaces.has(node.arguments[0].name))
            context.report({
              node,
              messageId: 'unrestoredNamespaceSpy',
              data: { namespace: node.arguments[0].name },
            })
      },
    }
  },
}

export default {
  meta: { name: 'test-isolation', version: '1.0.0' },
  rules: {
    'no-unrestored-namespace-spy': no_unrestored_namespace_spy,
  },
}
