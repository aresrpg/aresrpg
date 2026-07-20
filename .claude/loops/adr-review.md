# Loop rubric — ADR sense-check

**Pace:** slow — monthly-ish, or whenever an ADR is proposed/superseded, or after an incident
that touched a ruled area. **Substrate:** fresh-context agent run.
**Pairing declaration:** the cheap way to win is rubber-stamping the record as coherent — the
counter is rule 3 below: every ADR must be checked against the CODE, not against other ADRs
(reports consuming reports is the failure mode this loop exists to prevent).

## Inputs
- The full ADR set (`docs/adr/`), status-ordered.
- `FROZEN.md`, `docs/CODE_LAW.md`.
- The codebase at HEAD — the only ground truth.

## The rubric
1. **Internal coherence:** do any two accepted ADRs contradict? (Same subject, incompatible
   decisions, neither superseding the other.)
2. **Reality parity:** for each accepted ADR — does the code actually do what it says? Cite the
   implementing file(s) or flag the drift. An ADR the code ignores is either dead (supersede it)
   or a violation (file the issue).
3. **Consequence honesty:** did the costs the ADR predicted materialize? Did unpredicted ones?
   A consequences section that aged badly is a lesson — record it in the superseding ADR.
4. **Coverage:** did any significant architectural decision land WITHOUT an ADR since the last
   review (visible in the merge history as a structural change with no record)? Draft the missing
   ADR retroactively — the court records what happened, not just what was planned.
5. **Frozen integrity:** does any ADR (or any merged change) quietly weaken a `FROZEN.md` rule?
   That finding outranks everything else in the report.

## Output contract
- One comment on the standing ADR-review issue: per-rubric verdicts with cites.
- Drift findings → issues labeled `adr` + `tech-debt`.
- Contradictions/dead ADRs → draft superseding ADRs as PRs (status: proposed — a human accepts).
