// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Exact-score complexity ratchet. SonarJS owns cognitive-complexity calculation; this adapter
// adds the repository's preferred targets, hard ceilings, and inherited-hotspot baseline.

const FUNCTION_WRAPPERS = new Set([
  'ChainExpression',
  'TSAsExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
])

export const COMPLEXITY_LIMITS = Object.freeze({
  cognitive: Object.freeze({ preferred: 10, hard: 15 }),
  cyclomatic: Object.freeze({ preferred: 8, hard: 12 }),
})

const node_text = (source_code, node) => (node ? source_code.getText(node).replace(/\s+/g, ' ') : '?')

const unwrap_function = (node) => {
  let current = node
  while (current.parent && FUNCTION_WRAPPERS.has(current.parent.type)) current = current.parent
  return current
}

const local_function_label = (node, source_code) => {
  if (node.type === 'FunctionDeclaration' && node.id) return node.id.name
  if (node.type === 'FunctionExpression' && node.id) return node.id.name

  const wrapped = unwrap_function(node)
  const { parent } = wrapped
  if (!parent) return `anonymous(${node.params.map((param) => node_text(source_code, param)).join(',')})`
  if (parent.type === 'VariableDeclarator') return node_text(source_code, parent.id)
  if (parent.type === 'AssignmentExpression') return node_text(source_code, parent.left)
  if (parent.type === 'Property' || parent.type === 'PropertyDefinition' || parent.type === 'MethodDefinition')
    return node_text(source_code, parent.key)
  if (parent.type === 'JSXAttribute') return node_text(source_code, parent.name)
  if (parent.type === 'CallExpression' || parent.type === 'NewExpression') {
    const argument_index = parent.arguments.indexOf(wrapped)
    return `${node_text(source_code, parent.callee)}[${argument_index}](${node.params
      .map((param) => node_text(source_code, param))
      .join(',')})`
  }
  return `anonymous(${node.params.map((param) => node_text(source_code, param)).join(',')})`
}

const enclosing_function = (node) => {
  let current = node.parent
  while (current) {
    if (
      current.type === 'ArrowFunctionExpression' ||
      current.type === 'FunctionDeclaration' ||
      current.type === 'FunctionExpression'
    )
      return current
    current = current.parent
  }
  return null
}

export const function_label = (node, source_code) => {
  const local = local_function_label(node, source_code)
  const enclosing = enclosing_function(node)
  return enclosing ? `${function_label(enclosing, source_code)} > ${local}` : local
}

const sorted_scores = (scores) => [...scores].sort((left, right) => right - left)

const group_scores = (observations) =>
  Object.fromEntries(
    Object.entries(Object.groupBy(observations, ({ label }) => label))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, rows]) => [label, sorted_scores(rows.map(({ score }) => score))])
  )

const same_scores = (left = [], right = []) =>
  left.length === right.length && left.every((score, index) => score === right[index])

export const score_change = (before = [], after = []) => {
  const width = Math.max(before.length, after.length)
  const regressed = Array.from({ length: width }, (_, index) => (after[index] ?? 0) > (before[index] ?? 0)).some(
    Boolean
  )
  return Object.freeze({ regressed, changed: !same_scores(before, after) })
}

export const unsafe_baseline_change = (metric, before = [], after = []) => {
  const { regressed } = score_change(before, after)
  if (before.length) return regressed ? 'regression' : null
  return (after[0] ?? 0) > COMPLEXITY_LIMITS[metric].hard ? 'hardCeiling' : null
}

const relative_filename = (repo_root, filename) => filename.slice(repo_root.length + 1).replaceAll('\\', '/')

const report_score_changes = ({ context, metric, observations, baseline, repo_root, limits }) => {
  const filename = relative_filename(repo_root, context.filename)
  const actual = group_scores(observations)
  const expected = baseline[metric]?.[filename] ?? {}
  const collect = context.settings['complexity-gate']?.collect === true

  if (collect) {
    Object.entries(actual).forEach(([label, scores]) =>
      context.report({
        loc: { line: 1, column: 0 },
        messageId: 'collection',
        data: { metric, payload: JSON.stringify({ label, scores }) },
      })
    )
    return
  }

  const labels = [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort()
  labels.forEach((label) => {
    const before = expected[label] ?? []
    const after = actual[label] ?? []
    if (same_scores(before, after)) return
    const { regressed } = score_change(before, after)
    const maximum = after[0] ?? 0
    const message_id =
      before.length === 0
        ? ['baselineMissing', 'hardCeiling'][Number(maximum > limits.hard)]
        : ['stale', 'regression'][Number(regressed)]
    context.report({
      loc: { line: 1, column: 0 },
      messageId: message_id,
      data: {
        metric,
        label,
        before: before.length ? before.join(', ') : 'none',
        after: after.length ? after.join(', ') : 'none',
        hard: limits.hard,
      },
    })
  })
}

const rule_meta = {
  type: 'suggestion',
  schema: [{ type: 'integer', minimum: 0 }],
  messages: {
    collection: 'COMPLEXITY_BASELINE {{metric}} {{payload}}',
    hardCeiling: '{{metric}} complexity for {{label}} is {{after}}; new code may never exceed {{hard}}.',
    baselineMissing:
      '{{metric}} complexity for {{label}} is {{after}}; run `bun run complexity:baseline` to accept this reviewed soft hotspot.',
    regression: '{{metric}} complexity for {{label}} increased from {{before}} to {{after}}.',
    stale:
      '{{metric}} complexity for {{label}} improved from {{before}} to {{after}}; run `bun run complexity:baseline` to ratchet the baseline.',
  },
}

const metric_rule = ({ metric, upstream_rule, report_listener, score_field, baseline, repo_root }) => ({
  meta: rule_meta,
  create(context) {
    const observations = []
    let reporting_function = null
    const limits = COMPLEXITY_LIMITS[metric]
    const upstream_context = Object.create(context, {
      report: {
        value: (descriptor) => {
          const score = Number(descriptor.data?.[score_field])
          if (reporting_function && Number.isFinite(score))
            observations.push({ label: function_label(reporting_function, context.sourceCode), score })
        },
      },
    })
    const listeners = upstream_rule.create(upstream_context)
    const upstream_report = listeners[report_listener]
    const upstream_program_exit = listeners['Program:exit']
    return {
      ...listeners,
      [report_listener](...args) {
        reporting_function = report_listener === 'onCodePathEnd' ? args[1] : args[0]
        upstream_report?.(...args)
        reporting_function = null
      },
      'Program:exit'(node) {
        upstream_program_exit?.(node)
        report_score_changes({ context, metric, observations, baseline, repo_root, limits })
      },
    }
  },
})

const cyclomatic_rule = {
  meta: rule_meta,
  create(context) {
    const observations = []
    const complexities = []
    const increase = () => {
      complexities[complexities.length - 1] += 1
    }
    return {
      onCodePathStart() {
        complexities.push(1)
      },
      CatchClause: increase,
      ConditionalExpression: increase,
      LogicalExpression: increase,
      ForStatement: increase,
      ForInStatement: increase,
      ForOfStatement: increase,
      IfStatement: increase,
      WhileStatement: increase,
      DoWhileStatement: increase,
      AssignmentPattern: increase,
      'SwitchCase[test]': increase,
      AssignmentExpression(node) {
        if (['&&=', '||=', '??='].includes(node.operator)) increase()
      },
      MemberExpression(node) {
        if (node.optional) increase()
      },
      CallExpression(node) {
        if (node.optional) increase()
      },
      onCodePathEnd(code_path, node) {
        const score = complexities.pop()
        if (code_path.origin === 'function' && score > COMPLEXITY_LIMITS.cyclomatic.preferred)
          observations.push({ label: function_label(node, context.sourceCode), score })
      },
      'Program:exit'() {
        report_score_changes({
          context,
          metric: 'cyclomatic',
          observations,
          baseline: context.settings['complexity-gate']?.baseline ?? {},
          repo_root: context.settings['complexity-gate']?.repo_root ?? '',
          limits: COMPLEXITY_LIMITS.cyclomatic,
        })
      },
    }
  },
}

export const create_complexity_gate = ({ sonarjs, baseline, repo_root }) => ({
  rules: {
    cognitive: metric_rule({
      metric: 'cognitive',
      upstream_rule: sonarjs.rules['cognitive-complexity'],
      report_listener: ':function:exit',
      score_field: 'complexityAmount',
      baseline,
      repo_root,
    }),
    cyclomatic: {
      ...cyclomatic_rule,
      create(context) {
        const settings = {
          ...context.settings,
          'complexity-gate': { ...context.settings['complexity-gate'], baseline, repo_root },
        }
        return cyclomatic_rule.create(Object.create(context, { settings: { value: settings } }))
      },
    },
  },
})
