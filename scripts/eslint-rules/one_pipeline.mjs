// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// scripts/eslint-rules/one_pipeline.mjs — THE ONE-REDUCER TRIPWIRE (CLAUDE.md CLIENT-INDEPENDENCE/ONE-PIPELINE).
//
// The class it catches: an async callback (timer / promise chain / event listener / await continuation) writing a
// zustand store directly — `set(...)` / `X.setState(...)` off a stale closure. That exact shape shipped the
// v1.12.28 prod crash (a setTimeout writing fight state). The law: async results re-enter a stateful domain as
// INPUTS through its reducer door (`input(msg, now)` / a store action); nothing else writes.
//
// This is a lexical TRIPWIRE, not a type system: it flags writes that are *lexically inside* an async callback
// (walking through transparent sync combinators like .forEach/.map). A write hidden behind a named helper that a
// timer merely calls is out of scope by design — precision over recall, near-zero false positives.

const SCHEDULERS = new Set([
  'setTimeout',
  'setInterval',
  'setImmediate',
  'queueMicrotask',
  'requestAnimationFrame',
  'requestIdleCallback',
])
const PROMISE_METHODS = new Set(['then', 'catch', 'finally'])
const LISTENER_METHODS = new Set(['addEventListener', 'addListener', 'on', 'once', 'subscribe'])
// Sync array combinators are TRANSPARENT: a write inside `.forEach(cb)` still belongs to the surrounding context.
const SYNC_COMBINATORS = new Set([
  'forEach',
  'map',
  'filter',
  'reduce',
  'reduceRight',
  'some',
  'every',
  'find',
  'findIndex',
  'findLast',
  'flatMap',
  'sort',
])
const FUNCTION_TYPES = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'])
const GLOBAL_RECEIVERS = new Set(['window', 'globalThis', 'self'])

const is_function = (node) => node != null && FUNCTION_TYPES.has(node.type)

const is_global_receiver = (node) => node?.type === 'Identifier' && GLOBAL_RECEIVERS.has(node.name)

/** Non-computed member property name, or bare identifier name. */
const static_name = (node) => {
  if (node?.type === 'Identifier') return node.name
  if (node?.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier')
    return node.property.name
  return null
}

const allowed_file = (context) => {
  const allow = context.options?.[0]?.allow ?? []
  const filename = String(context.filename ?? '').replace(/\\/g, '/')
  return allow.some((fragment) => filename.includes(fragment))
}

const allow_schema = [
  {
    type: 'object',
    properties: {
      allow: {
        type: 'array',
        items: { type: 'string' },
        description: 'filename fragments (posix) where the rule is silent — the reducer modules that own `set`',
      },
    },
    additionalProperties: false,
  },
]

const enclosing_function = (node) => {
  let current = node.parent
  while (current && !is_function(current)) current = current.parent
  return current ?? null
}

/** Collect the source-range ends of every await boundary at `node`'s own function level (nested functions are
 *  their own timelines). A `for await` body is a continuation from its first iteration. */
const collect_await_ends = (node, ends) => {
  if (!node || typeof node.type !== 'string' || is_function(node)) return
  if (node.type === 'AwaitExpression') ends.push(node.range[1])
  if (node.type === 'ForOfStatement' && node.await) ends.push(node.body.range[0])
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue
    const child = node[key]
    if (Array.isArray(child)) {
      for (const item of child) if (item && typeof item.type === 'string') collect_await_ends(item, ends)
    } else if (child && typeof child.type === 'string') collect_await_ends(child, ends)
  }
}

/** The async-callback context a write is lexically inside, or null. Walks up the function chain; only IIFE and
 *  sync-array-combinator boundaries are crossed (they run in their parent's timeline — the walk itself encodes
 *  transparency), anything else stops the walk (precision over recall). */
const async_context_of = (write) => {
  let fn = enclosing_function(write)
  while (fn) {
    if (fn.async) {
      const await_ends = []
      collect_await_ends(fn.body, await_ends)
      if (await_ends.some((end) => end <= write.range[0]))
        return 'an await continuation (code after `await` resumes as a later microtask)'
    }
    const { parent } = fn
    if (parent?.type !== 'CallExpression') return null // a named/assigned definition — indirect dispatch, out of scope
    if (parent.callee === fn) {
      fn = enclosing_function(fn) // IIFE — transparent
      continue
    }
    if (!parent.arguments.includes(fn)) return null
    const { callee } = parent
    const name = static_name(callee)
    if (callee.type === 'Identifier' && SCHEDULERS.has(name)) return `a \`${name}\` callback`
    if (callee.type === 'MemberExpression' && SCHEDULERS.has(name) && is_global_receiver(callee.object))
      return `a \`${name}\` callback`
    if (callee.type === 'MemberExpression' && PROMISE_METHODS.has(name)) return `a promise \`.${name}()\` callback`
    if (callee.type === 'MemberExpression' && LISTENER_METHODS.has(name)) return `a \`.${name}()\` listener`
    if (callee.type === 'MemberExpression' && SYNC_COMBINATORS.has(name)) {
      fn = enclosing_function(fn) // sync combinator — transparent
      continue
    }
    return null // unknown callback holder — do not guess
  }
  return null
}

const resolve_variable = (scope, name) => {
  let current = scope
  while (current) {
    const variable = current.set.get(name)
    if (variable) return variable
    current = current.upper
  }
  return null
}

/** A store-write callee, or null: `X.setState(...)` (never `this.`), or a bare `set(...)`/`setState(...)` that
 *  resolves to a function parameter / an object-destructured binding (the zustand setter shapes). */
const writer_of = (node, source_code) => {
  const { callee } = node
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'setState' &&
    callee.object.type !== 'ThisExpression'
  )
    return source_code.getText(callee)
  if (callee.type !== 'Identifier' || (callee.name !== 'set' && callee.name !== 'setState')) return null
  const definition = resolve_variable(source_code.getScope(node), callee.name)?.defs?.[0]
  if (!definition) return null
  if (definition.type === 'Parameter') return callee.name
  if (
    definition.type === 'Variable' &&
    definition.node.type === 'VariableDeclarator' &&
    definition.node.id.type === 'ObjectPattern'
  )
    return callee.name
  return null
}

const no_async_store_write = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'no store write (`set`/`setState`) lexically inside an async callback — async results re-enter through the reducer door (ONE-PIPELINE law; the v1.12.28 crash class)',
    },
    schema: allow_schema,
    messages: {
      asyncWrite:
        '`{{writer}}` fires inside {{context}} — the v1.12.28 crash class (a stale-closure store write). ' +
        'Async results enter through the reducer door: dispatch `input(msg, now)` (or the store action that wraps it) ' +
        'and let the ONE reducer fold it — never `set()` from a callback. See CLAUDE.md ONE-PIPELINE.',
    },
  },
  create(context) {
    if (allowed_file(context)) return {}
    const source_code = context.sourceCode
    return {
      CallExpression(node) {
        const writer = writer_of(node, source_code)
        if (!writer) return
        const async_context = async_context_of(node)
        if (!async_context) return
        context.report({ node, messageId: 'asyncWrite', data: { writer, context: async_context } })
      },
    }
  },
}

const no_settimeout_in_stores = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'no setTimeout/setInterval inside a store module (any module importing zustand) — time enters the reducer as a tick input, never as a module-local second clock',
    },
    schema: allow_schema,
    messages: {
      timerInStore:
        'a `{{name}}` inside a store module is a second clock racing the reducer. Time enters as an INPUT: an ' +
        "app-edge ticker dispatches `input({ type: 'tick' }, now)` and the reducer folds deadlines/failsafes from " +
        'live state — see CLAUDE.md ONE-PIPELINE and fight/store.js `tick`.',
    },
  },
  create(context) {
    if (allowed_file(context)) return {}
    let is_store_module = false
    const timers = []
    return {
      ImportDeclaration(node) {
        if (String(node.source.value).startsWith('zustand')) is_store_module = true
      },
      CallExpression(node) {
        const { callee } = node
        const name =
          callee.type === 'Identifier'
            ? callee.name
            : callee.type === 'MemberExpression' && !callee.computed && is_global_receiver(callee.object)
              ? static_name(callee)
              : null
        if (name === 'setTimeout' || name === 'setInterval') timers.push({ node, name })
      },
      'Program:exit'() {
        if (!is_store_module) return
        for (const { node, name } of timers) context.report({ node, messageId: 'timerInStore', data: { name } })
      },
    }
  },
}

export default {
  meta: { name: 'one-pipeline', version: '1.0.0' },
  rules: {
    'no-async-store-write': no_async_store_write,
    'no-settimeout-in-stores': no_settimeout_in_stores,
  },
}
