# Code Law — loading door

The full FP constitution lives at `docs/CODE_LAW.md` — every law with its why, its source, and
its mechanical enforcement (ESLint rule id, semgrep/depcruise gate, or CodeQL query). Lint
messages cite law ids; this file is the summary an agent must hold at all times:

- **Pure by default.** Same input → same output, no observable side effect. Core logic is
  transforms over plain data.
- **One reducer per stateful domain; effects at the edges.** Async results re-enter as INPUTS
  through the reducer door. No async callback ever writes a store — at any call depth (the deep
  tier catches laundered writes through helpers).
- **Never mutate shared state.** Return new values; parameters are the caller's. Construction is
  local: mutating a value the function just created is building, not mutating.
- **No classes, no `this`.** Factories, closures, plain data. (Three sanctioned platform seams:
  React error boundaries, `extends Error`, the engine's lighting-model extension.)
- **Failures flow as data.** Reducer-shaped returns over thrown control flow; throw only at
  boundaries; decode errors once, at the seam.
- **Decode tests assert captured wire bytes** — a codec test that encodes with the same model it
  decodes with proves nothing; pin at least one real captured payload with provenance.
- **snake_case for every dev-chosen binding.** camelCase is a library's name, never a choice.
  PascalCase = components; SCREAMING_SNAKE = constants.
- **Severities only ratchet up.** A cleaned domain is promoted to ERROR, never demoted. Baselines
  only shrink; `--rebaseline` is an explicit, reviewed act (see `FROZEN.md`).
