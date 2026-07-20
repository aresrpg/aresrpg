# Craft — how to think before, during, and after touching this code

## Before code — find the seam
- Never start at "how do I add this." Start at "where does this want to live so it's almost
  nothing?" List two candidate seams; take the smaller blast radius. If no seam makes the feature
  small, you don't understand the system yet — read more, code less.
- The best diff makes a special case fall out of a general one. Before adding a branch, ask what
  would have to be true for the branch to not exist.
- Data first: get the shape right and the functions write themselves. If the logic feels hard,
  the data model is wrong — fix the shape, not the function.
- Check prior art before inventing (10 minutes, not a day): a platform feature, an existing
  module, a pattern already in the tree. But a dependency is a marriage — prefer 50 vendored
  lines over a 50k-line package for one function.
- One-line premortem, always: "this fails if ___". Mitigate the top answer before starting.

## While coding
- Immutable by default; effects at the edges; the core is pure transforms over plain data.
  No abstraction until the second concrete use — the first stays inline.
- One home per fact. The same knowledge written twice is a future bug; derive, don't copy.
- Delete concepts, not characters. "Less code" means fewer live ideas per read — three dumb lines
  beat one clever line that needs a comment.
- Name things by what they mean. If the honest name is awkward, the design is awkward.
- Torn between two designs? Take the one that's easier to DELETE later. Lock-in is the only
  unforgivable architecture sin.

## Debugging — the ladder (never skip a rung)
1. Reproduce it. No repro = no fix, only superstition.
2. Read the error twice. The answer is usually literally in it.
3. Ground truth before theory: real process state, real logs, real chain state — not assumptions.
4. Binary-search the state space; change ONE thing per probe. Shotgun edits destroy the evidence.
5. Two failed fixes = your model of the system is WRONG. Stop patching; re-derive from ground truth.
6. Never ship a fix you can't explain mechanically. "It works now" without a why is a time bomb.

## When stuck — compress the problem
After two distinct failed attempts, stop and write: SYMPTOM (observable, one line) · REPRO
(minimal) · TRIED (each attempt + what it disproved) · HYPOTHESIS (current best + the evidence
gap) · the SMALLEST QUESTION that unblocks. The writing itself solves half. Bring the brief to
the issue thread — never a raw dump.

## After code
- Verify by driving the real thing; "compiles" and "tests green" are necessary, never sufficient.
  Sad paths first — happy-path testing hides the bugs players find.
- Claims need provenance: "X is wired" cites the file loaded, the request fired, the tx digest,
  the console line. Visual inference is not evidence.
- No silent failures, ever. Every error path surfaces honestly; never auto-retry a transaction
  that EXECUTED and failed (a digest exists = gas burned = a retry burns again).
- Reread the diff as the reviewer: what did you NOT change that a stranger would expect?
  Untouched call sites, docs now lying, dead exports left behind.
- Net LoC is a review input: refactors ≤ 0; features pay rent — every added line explainable in
  one sentence.
