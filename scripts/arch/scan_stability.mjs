// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// scan_stability.mjs — the max-of-3 law for baseline WRITES (#2016), one home for all three
// semgrep-driven ratchets (arch/semgrep, sim-constants, entropy-before-validation).
//
// THE INCIDENT: the arch tree scan alternated 144/140 findings on an UNCHANGED tree inside one
// window under CPU contention, while the rule's fixture self-test stayed stable. semgrep abandons a
// file whose per-file budget runs out and emits NOTHING for it — so a scan under load silently
// under-reports. A `--write-baseline` landing on such a run records a floor that is too tight to
// reproduce: the next honest run exceeds it and the gate reds on noise, or the missing file is
// baselined at zero and its real findings can never be re-detected.
//
// THE LAW: a count that feeds a baseline WRITE (or any decision that TIGHTENS a floor) is max-of-3.
// A single-pass write is refused at the door — the discipline belongs to the gate, not to whoever
// happens to be running it. Comparison-only runs stay single-pass: a comparison can only ever be
// wrong in the safe direction (an under-measured run cannot exceed the floor).
//
// WHY THE MAX IS A UNION: three runs over one unchanged tree differ only by dropout, so each run's
// findings are a subset of the truth and the union across runs IS the per-key maximum — computed
// once, rule-agnostically, over raw semgrep rows, which is why all three verdicts can share it.
// Where two runs somehow disagree beyond dropout, the union is still the only safe direction for a
// FLOOR: a floor may never be tighter than something the tree has actually produced.
import fs from 'node:fs'

export const MIN_STABILITY_RUNS = 3

/** A semgrep row's identity on an unchanged tree: rule, file, exact span. */
const finding_id = (row) =>
  [row.check_id, row.path, row.start?.line, row.start?.col, row.end?.line, row.end?.col].join('|')

/**
 * merge_stable_scan(scan_paths) — max-of-N over N≥3 raw semgrep JSON payloads of the SAME scan.
 * Returns `{ ok: false, error }` when handed too few runs, else
 * `{ ok: true, scan, per_run_totals, unstable }` where `scan` is a semgrep-shaped payload holding
 * the merged (maximal) result set.
 */
export const merge_stable_scan = (scan_paths) => {
  if (scan_paths.length < MIN_STABILITY_RUNS)
    return {
      ok: false,
      error:
        `BASELINE WRITE REFUSED (#2016) — ${scan_paths.length} scan run(s) supplied, ${MIN_STABILITY_RUNS} required. ` +
        'A tree scan under CPU load silently drops the findings of files it could not finish, so a floor ' +
        'written from one pass is a number nobody can reproduce. Run the gate itself ' +
        '(`--write-baseline`), which scans the tree ' +
        `${MIN_STABILITY_RUNS}× and writes the maximum.`,
    }
  const runs = scan_paths.map((scan_path) => JSON.parse(fs.readFileSync(scan_path, 'utf8')).results ?? [])
  const merged = runs
    .flat()
    .reduce((by_id, row) => (by_id.has(finding_id(row)) ? by_id : new Map(by_id).set(finding_id(row), row)), new Map())
  const per_run_totals = runs.map((results) => results.length)
  return {
    ok: true,
    scan: { results: [...merged.values()] },
    per_run_totals,
    unstable: new Set(per_run_totals).size > 1,
  }
}

/** The line every baseline write prints — the wobble is never silent, the per-run counts are named. */
export const stability_line = ({ per_run_totals, unstable }) =>
  unstable
    ? `  scan WOBBLED across ${per_run_totals.length} runs (${per_run_totals.join(', ')} raw finding(s)) — ` +
      'writing the max-of-' +
      `${per_run_totals.length} floor (#2016)`
    : `  scan stable across ${per_run_totals.length} runs (${per_run_totals[0]} raw finding(s))`
