# Loop rubric — architecture audit

**Pace:** per session, event-triggered (after any large merge to edge; after any incident).
**Substrate:** an agent run with fresh context — never the author of the code under audit.
**Pairing declaration:** the cheap way to win this loop is vacuous approval ("looks clean") —
the counter is that every verdict must cite file:line evidence or name the exact absence checked
(globs searched + a positive control). An unevidenced verdict is an invalid run.

## Inputs (artifacts only — never chat memory)
- The diff since the last audit issue's recorded commit anchor (`git diff <anchor>..edge`).
- `docs/CODE_LAW.md` + `FROZEN.md` + the ADR set (`docs/adr/`).
- The standing loop issues (coverage/meaning/drift) for context on known debt.

## The rubric — answer each with evidence
1. **Smallest architecture:** for each new module/abstraction in the diff — does it have a second
   concrete use? Could it be deleted by moving its logic into an existing seam? Name the seam.
2. **Single source of truth:** does any fact now live in two homes (a value, a formula, a state
   shape, a derivation)? The same knowledge reachable by two paths counts.
3. **Reducer law in spirit:** beyond what the mechanical gates catch — does any new code COMPUTE
   an outcome a reducer already computes (shadow logic)? Does any effect fire outside an edge?
4. **Seam quality:** are new boundaries honest (data in, data out) or do they smuggle behavior
   (callbacks, shared mutable context, implicit ordering)?
5. **Deletability:** if this feature were cut next month, is its removal a directory delete or
   surgery? Name what entangles it.
6. **The uncomfortable half:** what in this diff would its author least want examined? Examine it.

## Output contract (GitHub artifacts, nothing else)
- One issue comment per audit on the standing `loop:conscience`-adjacent audit issue — verdict
  per rubric item, `file:line` cites, severity-ordered.
- Concrete violations → their own issues (labels: `tech-debt` or `bug`, `area:*`, priority).
- Structural disagreements with a recorded decision → a DRAFT ADR superseding the old one, argued
  on design grounds — never a silent divergence.
