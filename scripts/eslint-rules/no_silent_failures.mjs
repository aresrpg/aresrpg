// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// scripts/eslint-rules/no_silent_failures.mjs — THE SILENT-FAILURE TRIPWIRE (docs/CODE_LAW.md L-D1,
// Agent Standard #3 "no silent failure, ever").
//
// The class it catches: a failure handler that ERASES its failure — `.catch(() => undefined)`,
// `.catch(() => null)`, `.catch(() => {})`, `try { … } catch { return DEFAULT }`. The handler runs, the
// program keeps going, and the fact that something broke exists nowhere: no throw, no report, no failure
// value. Every downstream reader then reasons about a coerced success. Board census 2026-07-30 measured
// this class at 16.6% of the open board (26/157) — swallowed catches, bare-null returns, unexplained
// refusals, cached negatives, raw errors reaching players.
//
// The law: instruments THROW, never coerce. A handler must SPEAK — exactly one of three doors:
//   1. RE-THROW      — `throw`/`Promise.reject` anywhere in the handler (the failure keeps travelling).
//   2. FAILURE VALUE — return the failure as DATA: a `{ ok: false, … }` / `{ error }` / `{ state, events }`
//                      shape, a failure constructor, or the caught error itself (L-D1).
//   3. REPORT        — call a sanctioned channel from the `sinks` registry below (report_error, game_log,
//                      console.error/warn, Sentry.captureException, a player-facing toast).
//
// Like the one-pipeline tripwire this is a LEXICAL rule, not a type system: only handlers written inline as
// function expressions are judged (`.catch(handle_error)` passes a named reference — indirect dispatch, out
// of scope by design), and the whole handler subtree counts, nested callbacks included. Precision over
// recall: a handler that speaks ANYWHERE is silent nowhere.

const FUNCTION_TYPES = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'])

// THE REGISTRY OF SANCTIONED SINKS — matched as fragments against the callee's source text, so
// `use_toast.getState().add(…)` matches `toast` and `Sentry.captureException(e)` matches
// `captureException`. Census 2026-07-30 over packages/**/src + api: game_log 358, report_error 52,
// console.error 112, console.warn 57, toast 29, Sentry.captureException 4.
const DEFAULT_SINKS = [
  'console.error', // the universal floor
  'console.warn',
  'console.trace',
  'game_log', // packages/frontend/src/core/log.js — the in-game ring buffer report.js attaches to errors
  'report_', // core/report.js: report_error, report_boundary_error, report_chunk_load_failure
  'captureException', // Sentry, bare or namespaced
  'toast', // the player-facing door: toast(), use_toast.getState().add(…), toast_err
  'notify_',
  'capture_',
  'log_', // log_telemetry, log_fight_fingerprint
  'reject', // Promise.reject / a deferred's reject — the failure keeps travelling
]

// Keys that make a returned object a FAILURE VALUE rather than a coerced success (L-D1 reducer shapes).
const FAILURE_KEYS = new Set(['ok', 'error', 'errors', 'err', 'failure', 'reason', 'events', 'problem'])
// Identifiers that CONSTRUCT a failure value.
const FAILURE_CONSTRUCTORS = new Set(['err', 'error', 'errors', 'failure', 'fail', 'left', 'Err', 'Left', 'Failure'])

const is_function = (node) => node != null && FUNCTION_TYPES.has(node.type)

/** Depth-first walk over an AST subtree. Nested plain functions ARE descended (a handler that speaks from
 *  inside a `queueMicrotask` still speaks); `skip` prunes subtrees that own a DIFFERENT failure. */
const walk = (node, visit, skip) => {
  if (!node || typeof node.type !== 'string') return
  if (skip?.(node)) return
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue
    const child = node[key]
    if (Array.isArray(child)) {
      for (const item of child) if (item && typeof item.type === 'string') walk(item, visit, skip)
    } else if (child && typeof child.type === 'string') walk(child, visit, skip)
  }
}

/** The inline handler function of a `.catch(fn)` call, or null (a named reference is indirect dispatch). */
const catch_handler_of = (node) => {
  if (node?.type !== 'CallExpression') return null
  const { callee } = node
  if (callee.type !== 'MemberExpression' || callee.computed) return null
  if (callee.property.type !== 'Identifier' || callee.property.name !== 'catch') return null
  const [handler] = node.arguments
  return is_function(handler) ? handler : null
}

/** A subtree that owns a failure of its OWN — its speech is about a different error, so it never
 *  discharges the enclosing handler. This is what keeps an inner `.catch` from laundering an outer swallow. */
const owns_another_failure = (node) =>
  node.type === 'CatchClause' || (is_function(node) && catch_handler_of(node.parent) === node)

const allowed_file = (context) => {
  const allow = context.options?.[0]?.allow ?? []
  const filename = String(context.filename ?? '').replace(/\\/g, '/')
  return allow.some((fragment) => filename.includes(fragment))
}

/** The handler's own parameter names — `return e` hands the failure back as data, so it counts. */
const bound_names = (param) => {
  if (param?.type === 'Identifier') return [param.name]
  if (param?.type === 'ObjectPattern' || param?.type === 'ArrayPattern') {
    const names = []
    walk(param, (node) => {
      if (node.type === 'Identifier') names.push(node.name)
    })
    return names
  }
  return []
}

/** Is `node` a value that carries the failure forward (rather than erasing it)? */
const is_failure_value = (node, caught) => {
  if (!node) return false // `return` with no argument erases
  if (node.type === 'Identifier') return caught.has(node.name)
  if (node.type === 'MemberExpression') return is_failure_value(node.object, caught) // `e.message`, `e.code`
  if (node.type === 'AwaitExpression') return is_failure_value(node.argument, caught)
  if (node.type === 'NewExpression') return node.callee?.type === 'Identifier' && /Error$/.test(node.callee.name)
  if (node.type === 'ObjectExpression')
    return node.properties.some((property) => {
      if (property.type === 'SpreadElement') return is_failure_value(property.argument, caught)
      const key = property.computed ? null : (property.key?.name ?? property.key?.value)
      return typeof key === 'string' && FAILURE_KEYS.has(key)
    })
  if (node.type === 'CallExpression')
    return node.callee?.type === 'Identifier' && FAILURE_CONSTRUCTORS.has(node.callee.name)
  if (node.type === 'ConditionalExpression')
    // both branches must carry it — one erasing branch is still an erasure
    return is_failure_value(node.consequent, caught) && is_failure_value(node.alternate, caught)
  if (node.type === 'LogicalExpression') return is_failure_value(node.right, caught)
  return false
}

/** Does this handler SPEAK — throw, report through a sanctioned sink, or return the failure as data? */
const speaks = (handler, body, caught, sinks, source_code) => {
  // A concise arrow body is an implicit return: `(e) => ({ ok: false, error: e })`.
  if (is_function(handler) && handler.body?.type !== 'BlockStatement' && is_failure_value(handler.body, caught))
    return true
  let spoke = false
  walk(
    body,
    (node) => {
      if (spoke) return
      if (node.type === 'ThrowStatement') spoke = true
      else if (node.type === 'ReturnStatement' && is_failure_value(node.argument, caught)) spoke = true
      else if (node.type === 'CallExpression') {
        const callee = source_code.getText(node.callee)
        if (sinks.some((fragment) => callee.includes(fragment))) spoke = true
      }
    },
    owns_another_failure
  )
  return spoke
}

const no_swallowed_failure = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'a failure handler (catch block or `.catch()` handler) must throw, report through a sanctioned channel, or return a typed failure value — never coerce the failure into a default (L-D1; no silent failure, ever)',
    },
    schema: [
      {
        type: 'object',
        properties: {
          sinks: {
            type: 'array',
            items: { type: 'string' },
            description:
              'the registry of sanctioned reporting channels — source-text fragments matched against the callee of any call inside the handler',
          },
          allow: {
            type: 'array',
            items: { type: 'string' },
            description: 'filename fragments (posix) where the rule is silent',
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      silentFailure:
        'this {{kind}} SWALLOWS the failure — it never throws, never reports, and never returns a failure value, ' +
        'so the break exists nowhere and every caller downstream reads a coerced success. ' +
        'Instruments THROW, never coerce (docs/CODE_LAW.md L-D1): re-throw it, return it as data ' +
        '(`{ ok: false, error }` / the caught error itself), or speak through a sanctioned channel ' +
        '(`report_error` · `game_log` · `console.error` · a player-facing toast).',
    },
  },
  create(context) {
    if (allowed_file(context)) return {}
    const source_code = context.sourceCode
    const sinks = context.options?.[0]?.sinks ?? DEFAULT_SINKS

    const judge = (handler, body, param, kind, report_node) => {
      const caught = new Set(bound_names(param))
      if (speaks(handler, body, caught, sinks, source_code)) return
      context.report({ node: report_node, messageId: 'silentFailure', data: { kind } })
    }

    return {
      CatchClause(node) {
        judge(null, node.body, node.param, 'catch block', node)
      },
      CallExpression(node) {
        const handler = catch_handler_of(node) // null = a named reference, indirect dispatch, out of scope
        if (!handler) return
        judge(handler, handler.body, handler.params?.[0], '`.catch()` handler', handler)
      },
    }
  },
}

export default {
  meta: { name: 'no-silent-failures', version: '1.0.0' },
  rules: { 'no-swallowed-failure': no_swallowed_failure },
}
