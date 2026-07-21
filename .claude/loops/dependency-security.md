# Loop rubric — dependency & code-scanning alert triage

| | |
|---|---|
| **Owner** | whoever holds repo security-alert access triages; this pass drafts the finding |
| **Budget** | ≤20 min per alert; escalate rather than grind an unclear one |
| **Kill-condition** | stops the instant an alert is boarded (issue filed) or dismissed with evidence — never left open-ended |

**Pace:** event-triggered (a new Dependabot/code-scanning alert) plus a periodic sweep of the
open alert list. **Substrate:** fresh-context agent run — the alert is the input, not a memory
of a previous triage pass.

**Scope note:** this loop triages ALREADY-PUBLIC advisories (a CVE Dependabot already knows
about) and boards findings as normal public issues. It is NOT the route for a NEW vulnerability
found in this repo's own code — that goes through the private security advisory flow
(`SECURITY.md`), never here.

## Inputs
- The alert itself: advisory id, severity, affected version range.
- `bun.lock` — the ACTUALLY resolved version, not the advisory's stated range.
- The dependent source, if the alert claims a reachable path.

## The rubric
1. **Reachability** — is the flagged code path actually reachable from this repo's usage, or a
   transitive dependency never invoked in an exploitable way? Cite the call site, or the exact
   globs searched and their absence.
2. **Version reality** — does `bun.lock` resolve inside the vulnerable range, or already float
   above the fix? A dismissal needs the resolved version as evidence, never an assumption.
3. **Fix path** — a non-breaking bump boards as an issue with the exact version; a breaking bump
   notes the blast radius (what else in the tree pins the old major).
4. **Money/auth surfaces** — an alert touching `packages/move`, `api/`, or the rpc gas-pool
   escalates immediately, never sits in the routine sweep queue.
5. **Dismissal discipline** — every dismissal carries its evidence (resolved version +
   non-reachability proof) in the alert's own dismiss reason, never a silent close.

## Output contract
- One issue per boarded alert (`security`, `dependencies` labels), version + reachability
  evidence in the body.
- Dismissals recorded on the alert itself, evidence-first — never silent.
