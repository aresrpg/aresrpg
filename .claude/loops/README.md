# Loops

Standing judgment passes — scheduled work that runs without anyone remembering to run it. Each
rubric is committed here; the loop's findings land on the board, never in code.

- `architecture-audit.md` — structure and dual-homes: hourly sweep of fresh landings, ~4h full pass.
- `adr-review.md` — are the recorded decisions still true of the code?
- `dependency-security.md` — dependency and code-scanning alert triage.
- `flaky-watch.md` — tests that flip; a flaky gate is a disarmed gate.
- `issue-triage.md` — the board stays legible: labels, duplicates, staleness.
- `meta-audit.md` — the loop that audits the loops: does each still touch reality?

**THE RULE:** a new loop names, in one line, the concern no existing loop owns AND the gate that
will eventually replace it — no orphan concerns, no immortal prose. Redundant loops merge; every
loop is a candidate for graduation into CI. It also ships the four hardening clauses every
rubric here carries — the ROW BAR, the SELF-CLEANING leg, FIX-FIRST, the MATERIALITY VALVE —
because a loop that files theory, files stale, files immaterial, or never closes its own rows
submerges the board instead of draining it.
The meta-audit loop asserts their presence, so a rubric added without them is a finding.
