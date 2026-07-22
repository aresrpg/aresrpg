// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
const STEP_KEYS = ['do', 'loop', 'assert', 'use', 'checkpoint', 'expect_abort']

const is_step = (step) => STEP_KEYS.some((key) => key in (step ?? {}))

function resolve_params(value, params) {
  if (typeof value === 'string' && value.startsWith('$')) {
    const resolved = params[value.slice(1)]
    if (resolved === undefined) throw new Error(`unbound behavior param ${value}`)
    return resolved
  }
  if (Array.isArray(value)) return value.map((entry) => resolve_params(entry, params))
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolve_params(entry, params)]))
  return value
}

function validate_expected_abort(name, step) {
  const expected = step.expect_abort
  if (!expected || typeof expected.do !== 'string') throw new Error(`[${name}] expect_abort needs do`)
  if (typeof expected.module !== 'string' || !expected.module) throw new Error(`[${name}] expect_abort needs module`)
  if (!Number.isInteger(expected.abort_code)) throw new Error(`[${name}] expect_abort needs integer abort_code`)
  if (typeof expected.no_digest !== 'boolean') throw new Error(`[${name}] expect_abort needs boolean no_digest`)
  if (!Array.isArray(expected.no_state_delta) || expected.no_state_delta.length === 0)
    throw new Error(`[${name}] expect_abort requires nonempty no_state_delta[]`)
  if (step.optional) throw new Error(`[${name}] expect_abort cannot be optional`)
}

/** Flatten, validate, and parameter-bind a data-only behavior. */
export function compile_behavior(behavior, params = {}) {
  if (!behavior?.name || !Array.isArray(behavior.steps)) throw new Error('behavior needs { name, steps[] }')
  const bound = { ...behavior.defaults, ...params }
  const out = []
  for (const raw of behavior.steps) {
    if (!is_step(raw)) throw new Error(`[${behavior.name}] invalid step ${JSON.stringify(raw)}`)
    if (typeof raw === 'object' && Object.values(raw).some((value) => typeof value === 'function'))
      throw new Error(`[${behavior.name}] steps are DATA only — no functions`)
    if ('expect' in raw) throw new Error(`[${behavior.name}] legacy expect is unsupported; use expect_abort`)
    if (raw.use) {
      out.push(...compile_behavior(raw.use, resolve_params(raw.with ?? {}, bound)))
      continue
    }
    if (raw.loop) {
      if (!raw.max_iters || !raw.max_minutes)
        throw new Error(`[${behavior.name}] loop watchdogs are MANDATORY (max_iters + max_minutes)`)
      out.push({
        loop: compile_behavior({ name: `${behavior.name}.loop`, defaults: bound, steps: raw.loop }),
        until: resolve_params(raw.until, bound),
        max_iters: raw.max_iters,
        max_minutes: raw.max_minutes,
      })
      continue
    }
    const step = resolve_params(raw, bound)
    if (step.expect_abort) validate_expected_abort(behavior.name, step)
    out.push(step)
  }
  return out
}

const oracle_name = (spec) => (typeof spec === 'string' ? spec : spec?.oracle)
const oracle_args = (spec) => (typeof spec === 'string' ? {} : (spec?.args ?? {}))
function canonical_value(value) {
  if (Array.isArray(value)) return value.map(canonical_value)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical_value(value[key])])
  )
}
const canonical = (value) => JSON.stringify(canonical_value(value))

/** Execute one no-submit negative step and prove its typed abort and selected state invariants. */
export async function verify_expected_abort({ step, execute, snapshot }) {
  const expected = step.expect_abort
  validate_expected_abort('runtime', step)
  const before = []
  for (const spec of expected.no_state_delta)
    before.push({ oracle: oracle_name(spec), value: await snapshot(oracle_name(spec), oracle_args(spec)) })
  const result = await execute(expected.with ?? {})
  if (result?.ok) throw new Error(`expected ${expected.module}::${expected.abort_code}, transaction succeeded`)
  if (expected.no_digest && result?.digest)
    throw new Error(`expected no digest for ${expected.module}::${expected.abort_code}, got ${result.digest}`)
  if (!expected.no_digest && !result?.digest)
    throw new Error(`expected executed abort ${expected.module}::${expected.abort_code} to carry a digest`)
  if (result?.abort_module !== expected.module || Number(result?.abort_code) !== expected.abort_code)
    throw new Error(
      `expected abort ${expected.module}::${expected.abort_code}, got ${result?.abort_module ?? 'unknown'}::${result?.abort_code ?? 'unknown'}`
    )
  const after = []
  for (const spec of expected.no_state_delta)
    after.push({ oracle: oracle_name(spec), value: await snapshot(oracle_name(spec), oracle_args(spec)) })
  for (let index = 0; index < before.length; index += 1) {
    if (canonical(before[index].value) !== canonical(after[index].value))
      throw new Error(
        `expected no state delta for ${before[index].oracle}: ${canonical(before[index].value)} -> ${canonical(after[index].value)}`
      )
  }
  return { ok: true, result, before, after }
}
