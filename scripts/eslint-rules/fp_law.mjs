// scripts/eslint-rules/fp_law.mjs — THE FP-LAW TRIPWIRES (docs/CODE_LAW.md).
//
// Three lexical rules the mature plugins cannot express without typed linting (the root lint runs
// untyped — see eslint.config.js), each mapped to a law in docs/CODE_LAW.md:
//
//   fp-law/snake-case               — L-N1: dev-chosen names are snake_case (house law; camelCase
//                                     is only ever a library's name, never a declaration choice).
//   fp-law/no-mutating-methods      — L-I1/L-I2: never mutate shared state or parameters. Flags
//                                     `x.push/sort/splice/…()`, `delete x.y`, `Object.assign(x, …)`
//                                     on receivers that are not provably LOCAL CONSTRUCTION.
//   fp-law/no-module-scope-effects  — L-P3: importing a module must be pure. Timers, network,
//                                     listeners, DOM/storage touches fire from the app edge, not
//                                     from module load.
//
// Like one_pipeline.mjs these are TRIPWIRES, not type systems: precision over recall, near-zero
// false positives, every message cites the law it enforces.

const FUNCTION_TYPES = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'])
// Sync array combinators + IIFEs run in their caller's timeline/scope — the walks treat them as transparent.
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

const is_function = (node) => node != null && FUNCTION_TYPES.has(node.type)

/** Non-computed member property name, or bare identifier name. */
const static_name = (node) => {
  if (node?.type === 'Identifier') return node.name
  if (node?.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier')
    return node.property.name
  return null
}

const allowed_file = (context) => {
  const allow = context.options?.[0]?.allow ?? []
  // Match against the REPO-relative path: an absolute prefix like ~/dev/aresrpg would make a
  // fragment such as '/dev/' exempt every file (measured 2026-07-17 — the rule went silent).
  const cwd = String(context.cwd ?? '').replace(/\\/g, '/')
  const filename = String(context.filename ?? '')
    .replace(/\\/g, '/')
    .replace(cwd.endsWith('/') ? cwd : `${cwd}/`, '')
  return allow.some((fragment) => filename.includes(fragment))
}

const allow_schema = [
  {
    type: 'object',
    properties: {
      allow: {
        type: 'array',
        items: { type: 'string' },
        description: 'filename fragments (posix) where the rule is silent',
      },
    },
    additionalProperties: false,
  },
]

const resolve_variable = (scope, name) => {
  let current = scope
  while (current) {
    const variable = current.set.get(name)
    if (variable) return variable
    current = current.upper
  }
  return null
}

const enclosing_function = (node) => {
  let current = node.parent
  while (current && !is_function(current)) current = current.parent
  return current ?? null
}

/** The function that OWNS `node`'s execution, walking transparently through IIFEs and sync array
 *  combinator callbacks (they run inside their caller). null = module scope. */
const owning_function = (node) => {
  let fn = enclosing_function(node)
  while (fn) {
    const { parent } = fn
    if (parent?.type === 'CallExpression' && parent.callee === fn) {
      fn = enclosing_function(fn) // IIFE — transparent
      continue
    }
    if (
      parent?.type === 'CallExpression' &&
      parent.arguments.includes(fn) &&
      parent.callee.type === 'MemberExpression' &&
      SYNC_COMBINATORS.has(static_name(parent.callee))
    ) {
      fn = enclosing_function(fn) // sync combinator callback — transparent
      continue
    }
    return fn
  }
  return null
}

// ── fp-law/snake-case (L-N1) ───────────────────────────────────────────────────────────────────
// A dev-CHOSEN name that starts lowercase and contains an uppercase letter is camelCase — banned.
// Capital-start names pass (PascalCase components, SCREAMING_SNAKE constants). Names the dev did
// NOT choose are never flagged: imports, shorthand destructuring (the library's field name),
// object literal keys (external API shapes).
const is_camel_case = (name) => /^_*[a-z$]/.test(name) && /[A-Z]/.test(name)

const snake_case = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'dev-chosen bindings are snake_case (docs/CODE_LAW.md L-N1) — camelCase is a library name, not a declaration choice',
    },
    schema: allow_schema,
    messages: {
      camel:
        '`{{name}}` is camelCase — dev-chosen bindings are snake_case (docs/CODE_LAW.md L-N1). ' +
        'Rename, or destructure without an alias if this is a library field.',
    },
  },
  create(context) {
    if (allowed_file(context)) return {}
    const report = (node) => context.report({ node, messageId: 'camel', data: { name: node.name } })
    // Dev-chosen binding positions inside a declaration pattern. Shorthand object properties keep
    // the source object's field name — skipped; a RENAME (`{ theirName: our_name }`) is a choice.
    const check_pattern = (pattern) => {
      if (!pattern) return
      switch (pattern.type) {
        case 'Identifier':
          if (is_camel_case(pattern.name)) report(pattern)
          return
        case 'ObjectPattern':
          for (const property of pattern.properties) {
            if (property.type === 'RestElement') check_pattern(property.argument)
            else if (!property.shorthand) check_pattern(property.value) // a RENAME is a choice; shorthand keeps the lib name
          }
          return
        case 'ArrayPattern':
          for (const element of pattern.elements) check_pattern(element)
          return
        case 'AssignmentPattern':
          check_pattern(pattern.left)
          return
        case 'RestElement':
          check_pattern(pattern.argument)
          return
        default:
          return
      }
    }
    return {
      VariableDeclarator(node) {
        check_pattern(node.id)
      },
      FunctionDeclaration(node) {
        if (node.id && is_camel_case(node.id.name)) report(node.id)
      },
      ':function'(node) {
        for (const parameter of node.params) check_pattern(parameter)
      },
      CatchClause(node) {
        check_pattern(node.param)
      },
    }
  },
}

// ── fp-law/no-mutating-methods (L-I1 / L-I2) ───────────────────────────────────────────────────
const MUTATING_METHODS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'])

/** A receiver expression that is FRESH by construction: a literal, a `new`, or any call result
 *  (functions return new values — that is the law this rule enforces; `get_registry().push()` is
 *  out of scope by design, precision over recall). */
const is_fresh_expression = (node) => {
  if (!node) return false
  if (node.type === 'AwaitExpression') return is_fresh_expression(node.argument)
  return (
    node.type === 'ArrayExpression' ||
    node.type === 'ObjectExpression' ||
    node.type === 'NewExpression' ||
    node.type === 'CallExpression'
  )
}

/** Root object of a member chain: `a.b.c` → `a`. */
const member_root = (node) => {
  let current = node
  while (current.type === 'MemberExpression') current = current.object
  return current
}

const no_mutating_methods = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'no mutation of shared state or parameters (docs/CODE_LAW.md L-I1/L-I2) — mutate only what THIS function just created',
    },
    schema: allow_schema,
    messages: {
      mutation:
        '`{{text}}` mutates a value this function did not create — "mutation hides change; hidden change ' +
        'manifests chaos" (docs/CODE_LAW.md L-I1). Copy first (spread / toSorted / toReversed / toSpliced / with), ' +
        'or build the value where it is born.',
      paramMutation:
        "`{{text}}` mutates a function parameter — the caller's value is not yours to change " +
        '(docs/CODE_LAW.md L-I2). Return a new value instead.',
    },
  },
  create(context) {
    if (allowed_file(context)) return {}
    const source_code = context.sourceCode

    /** Is `identifier` a reduce-accumulator? (first param of a `.reduce()/.reduceRight()` callback —
     *  fold-local accumulation is CONSTRUCTION, docs/CODE_LAW.md L-I3.) */
    const is_reduce_accumulator = (variable) => {
      const definition = variable?.defs?.[0]
      if (definition?.type !== 'Parameter') return false
      const fn = definition.node
      if (!is_function(fn) || fn.params[0] !== definition.name) return false
      const { parent } = fn
      return (
        parent?.type === 'CallExpression' &&
        parent.arguments[0] === fn &&
        parent.callee.type === 'MemberExpression' &&
        (static_name(parent.callee) === 'reduce' || static_name(parent.callee) === 'reduceRight')
      )
    }

    /** Verdict for mutating `receiver` at `site`: null = allowed, else a messageId. */
    const mutation_verdict = (receiver, site) => {
      if (is_fresh_expression(receiver)) return null
      const root = member_root(receiver)
      if (is_fresh_expression(root)) return null // `Object.entries(x)[0].…` — fresh chain
      if (root.type === 'ThisExpression') return 'mutation' // `this` is banned elsewhere; still a shared write
      if (root.type !== 'Identifier') return 'mutation'
      const variable = resolve_variable(source_code.getScope(site), root.name)
      if (!variable) return 'mutation' // unresolved/global — shared by definition
      if (is_reduce_accumulator(variable)) return null
      const [definition] = variable.defs
      if (!definition) return 'mutation'
      if (definition.type === 'Parameter') return 'paramMutation'
      if (definition.type !== 'Variable') return 'mutation'
      const declarator = definition.node
      if (!is_fresh_expression(declarator.init)) return 'mutation' // alias / late-assigned binding
      // Fresh local — but only construction INSIDE the same owning function (or same module scope).
      // A module-scope `const cache = []` mutated from inside a function is shared mutable state.
      return owning_function(declarator) === owning_function(site) ? null : 'mutation'
    }

    const report = (node, message_id) =>
      context.report({
        node,
        messageId: message_id,
        data: { text: source_code.getText(node).split('\n')[0].slice(0, 60) },
      })

    return {
      CallExpression(node) {
        const { callee } = node
        if (callee.type !== 'MemberExpression') return
        const name = static_name(callee)
        if (MUTATING_METHODS.has(name)) {
          const verdict = mutation_verdict(callee.object, node)
          if (verdict) report(node, verdict)
          return
        }
        // Object.assign(target, …) mutates target — only a fresh target is construction.
        if (
          name === 'assign' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Object' &&
          node.arguments.length > 0
        ) {
          const verdict = mutation_verdict(node.arguments[0], node)
          if (verdict) report(node, verdict)
        }
      },
      UnaryExpression(node) {
        if (node.operator !== 'delete') return
        if (node.argument.type !== 'MemberExpression') return
        const verdict = mutation_verdict(node.argument.object, node)
        if (verdict) report(node, verdict)
      },
    }
  },
}

// ── fp-law/no-module-scope-effects (L-P3) ──────────────────────────────────────────────────────
const EFFECT_CALLS = new Set([
  'setTimeout',
  'setInterval',
  'setImmediate',
  'queueMicrotask',
  'requestAnimationFrame',
  'requestIdleCallback',
  'fetch',
  'addEventListener',
])
const EFFECT_RECEIVERS = new Set(['document', 'localStorage', 'sessionStorage', 'navigator', 'process'])
const EFFECT_CONSTRUCTORS = new Set(['WebSocket', 'XMLHttpRequest', 'Worker', 'SharedWorker', 'EventSource'])

/** Property names along a member chain, root excluded: `process.env.URL` → ['env', 'URL']. */
const chain_names = (node) => {
  const names = []
  let current = node
  while (current.type === 'MemberExpression') {
    const name = static_name(current)
    if (name) names.push(name)
    current = current.object
  }
  return names
}

const no_module_scope_effects = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'importing a module must be pure (docs/CODE_LAW.md L-P3) — timers/network/listeners/DOM fire from the app edge, not from module load',
    },
    schema: allow_schema,
    messages: {
      moduleEffect:
        '`{{text}}` runs at module load — importing a module must be pure (docs/CODE_LAW.md L-P3). ' +
        'Export a function and let the app edge (entry file / lifecycle hook) invoke the effect.',
    },
  },
  create(context) {
    if (allowed_file(context)) return {}
    const source_code = context.sourceCode
    const check = (node, effect_name) => {
      if (!effect_name) return
      if (owning_function(node) !== null) return
      context.report({
        node,
        messageId: 'moduleEffect',
        data: { text: source_code.getText(node).split('\n')[0].slice(0, 60) },
      })
    }
    return {
      CallExpression(node) {
        const { callee } = node
        if (callee.type === 'Identifier' && EFFECT_CALLS.has(callee.name)) return check(node, callee.name)
        if (callee.type === 'MemberExpression') {
          const method = static_name(callee)
          if (EFFECT_CALLS.has(method)) return check(node, method)
          const root = member_root(callee.object)
          if (
            root.type === 'Identifier' &&
            EFFECT_RECEIVERS.has(root.name) &&
            // reading config is not an effect: `process.env.LIST.split(',')` at module scope is fine
            !(root.name === 'process' && chain_names(callee).includes('env'))
          )
            return check(node, root.name)
        }
      },
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && EFFECT_CONSTRUCTORS.has(node.callee.name))
          check(node, node.callee.name)
      },
    }
  },
}

export default {
  meta: { name: 'fp-law', version: '1.0.0' },
  rules: {
    'snake-case': snake_case,
    'no-mutating-methods': no_mutating_methods,
    'no-module-scope-effects': no_module_scope_effects,
  },
}
