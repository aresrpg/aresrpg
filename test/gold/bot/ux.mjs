// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// UX-FINDINGS RECORDER — the ui-mode evidence layer that turns "test as a player" into
// MECHANICAL findings, never fake scores. The sdk run of the SAME behavior is the CONTROL GROUP ("pure gameplay
// through PTB building only"); the ui run diffs against it, so UI overhead is exposed by construction. Pure &
// unit-provable: (observation per step) → (finding classes). Consumed by bot/ui_driver.mjs; the run wires the
// sdk-mode summary as `baseline` so friction is a real delta, not an adjective.
//
// Finding classes: delay_over_budget · dead_time · rage_click · unwired · friction · plus the
// SUBJECTIVE axes (fun/intuitive) as flaggable HEURISTICS (long_wait / repeated_errors / backtracking) — flags,
// never scores. Each finding carries the measured number + the budget it violated (provenance law).
import fs from 'node:fs'
import path from 'node:path'

/**
 * @param {{ baseline?: { steps?:number, clicks?:number, ms?:number }, budgets?: Record<string, number>,
 *   long_wait_ms?: number }} opts  baseline = the sdk-mode run of the same behavior (the control group)
 */
export function make_ux({ baseline = null, budgets = {}, long_wait_ms = 4000 } = {}) {
  const findings = []
  const steps = []
  let clicks = 0
  const add = (cls, step, measured, budget, note) => findings.push({ class: cls, step, measured, budget, note })

  /**
   * Record one UI step observation.
   * @param {{ step:string, verb?:string, budget_key?:string, click_to_response_ms?:number,
   *   feedback_ms?:number, effect_observed?:boolean, clicks?:number, retries?:number, backtracked?:boolean,
   *   console_errors?:number }} o
   */
  function observe(o) {
    steps.push(o)
    clicks += o.clicks ?? 1
    const budget = o.budget_key != null ? budgets[o.budget_key] : undefined

    // delay_over_budget: click→response exceeded the versioned timing ceiling (§8)
    if (budget != null && o.click_to_response_ms != null && o.click_to_response_ms > budget)
      add(
        'delay_over_budget',
        o.step,
        o.click_to_response_ms,
        budget,
        `${o.verb ?? o.step} took ${o.click_to_response_ms}ms > ${budget}ms budget`
      )

    // dead_time: an action fired but no visible feedback for a long window (the "did it work?" gap)
    if (o.feedback_ms != null && o.feedback_ms > long_wait_ms)
      add(
        'dead_time',
        o.step,
        o.feedback_ms,
        long_wait_ms,
        `no visible feedback for ${o.feedback_ms}ms after ${o.verb ?? o.step}`
      )

    // unwired: the control was driven but produced NO observable effect (effect-per-click law, §7b)
    if (o.effect_observed === false)
      add(
        'unwired',
        o.step,
        0,
        null,
        `${o.verb ?? o.step}: control produced no observable effect (tx/net/store/route/ui) — not wired`
      )

    // rage_click / retry: the player had to click/retry repeatedly to get through a step
    if ((o.retries ?? 0) >= 2 || (o.clicks ?? 1) >= 3)
      add(
        'rage_click',
        o.step,
        o.retries ?? o.clicks,
        2,
        `${o.retries ?? o.clicks} clicks/retries to complete ${o.verb ?? o.step}`
      )

    // SUBJECTIVE heuristics (fun/intuitive) — flags, never scores
    if (o.click_to_response_ms != null && o.click_to_response_ms > long_wait_ms)
      add(
        'long_wait',
        o.step,
        o.click_to_response_ms,
        long_wait_ms,
        `a ${o.click_to_response_ms}ms wait reads as sluggish/unfun`
      )
    if ((o.console_errors ?? 0) > 0)
      add(
        'repeated_errors',
        o.step,
        o.console_errors,
        0,
        `${o.console_errors} console error(s) during ${o.verb ?? o.step}`
      )
    if (o.backtracked)
      add('backtracking', o.step, 1, 0, `player had to backtrack at ${o.verb ?? o.step} (unintuitive flow)`)
  }

  /** Aggregate + (optionally) write ux_findings.json. friction = ui totals vs the sdk baseline control group. */
  function report(out_dir) {
    const friction = baseline
      ? {
          ui_steps: steps.length,
          sdk_steps: baseline.steps ?? null,
          ui_clicks: clicks,
          extra_clicks_vs_sdk: baseline.clicks != null ? clicks - baseline.clicks : null,
          ui_ms: steps.reduce((s, o) => s + (o.click_to_response_ms ?? 0), 0),
          sdk_ms: baseline.ms ?? null,
        }
      : null
    // friction becomes a finding when the UI cost markedly more clicks than the pure-gameplay control
    if (friction?.extra_clicks_vs_sdk != null && friction.extra_clicks_vs_sdk > steps.length)
      add(
        'friction',
        'run',
        friction.extra_clicks_vs_sdk,
        steps.length,
        `UI needed ${friction.extra_clicks_vs_sdk} more clicks than the sdk control for the same behavior`
      )

    const report = {
      total_steps: steps.length,
      total_clicks: clicks,
      friction,
      by_class: findings.reduce((m, f) => ((m[f.class] = (m[f.class] ?? 0) + 1), m), {}),
      findings,
    }
    if (out_dir) fs.writeFileSync(path.join(out_dir, 'ux_findings.json'), JSON.stringify(report, null, 2))
    return report
  }

  return {
    observe,
    report,
    findings,
    get clicks() {
      return clicks
    },
  }
}
