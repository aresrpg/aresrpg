# Loop rubric — issue triage

| | |
|---|---|
| **Owner** | scheduled workflow, or ad hoc via a session — a maintainer acts on anything filed |
| **Budget** | ≤30 min per pass; touches labels/comments only, never code |
| **Kill-condition** | stops the moment the open-issue backlog it screens is empty; never re-touches an issue a human already labeled `triaged` |

**Pace:** daily-ish, or on demand. **Substrate:** fresh-context agent run over the live issue
list — never last run's memory of it.

## Inputs
- `gh issue list --repo aresrpg/aresrpg --state open` — labels, last-activity timestamps.
- `gh label list --repo aresrpg/aresrpg` — the existing taxonomy; never invent a label ad hoc.
- `CONTRIBUTING.md`'s Scope section — content/balance proposals are design conversations, not
  PR-shaped tickets.

## The rubric
1. **Label completeness** — does every open issue carry at least one area/type label? Propose
   the missing one as a comment if you're not confident applying it directly.
2. **Staleness** — no activity in 60+ days: a comment asking for a repro/status update, or a
   close-with-reason if the report no longer reproduces against `edge`.
3. **Duplicate collapse** — same symptom, different issue number: cross-link both, close the
   newer one pointing at the surviving thread, never delete history.
4. **Scope check** — an issue shaped as a content/balance change gets flagged as a design
   conversation per `CONTRIBUTING.md`, not silently left PR-shaped.
5. **`good-first-issue` quality** — does the label still describe a genuinely self-contained
   starter task, or has the surrounding code moved out from under it since it was applied?

## Output contract
- Label changes and comments only — this loop never pushes code, never closes without a reason
  comment.
- Anything ambiguous (is this really a duplicate? really stale?) gets a comment proposing the
  action, not a silent close — a human confirms before it lands.
