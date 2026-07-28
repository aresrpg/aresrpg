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
- **FILING BAR:** file only evidence-backed P2+ rows; P3/cosmetic observations go into their epic's checklist directly, never as new issues.
- One comment on the standing ADR-review issue: per-rubric verdicts with cites.
- Drift findings → issues labeled `adr` + `tech-debt`.
- Contradictions/dead ADRs → draft superseding ADRs as PRs (status: proposed — a human accepts).

## Filing valve (binding, every pass)

Only P0/P1 findings may file individual issue rows. Every other finding APPENDS to this loop's
standing epic row as a checkbox (one line: `- [ ] <claim> · <file:line or evidence link>`), in the
same pass, never a new row. If the loop has no standing epic yet, the pass's FIRST non-P0/P1
finding creates it (one epic per loop, labeled with the loop's own label + `epic`) and every
later finding appends there. Board intake is a budget; the drain must outrun it.

Before filing ANY row or checkbox: search open rows for the same finding (title keywords +
surface) — "before creating an issue you should double check what we have." A match means a
comment or checkbox on the EXISTING row, never a new one.
