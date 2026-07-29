# Reuse registry — RED self-test fixture

Two rows: one anchored on a real declaration (its fact must be found in both other homes), one
anchored on a comment line (the registry-anchor lane must report a row that protects nothing).

| Fact domain            | Canonical home                                                           |
| ---------------------- | ------------------------------------------------------------------------ |
| Test protocol constant | `packages/alpha/src/protocol.js:5` — the fixture's exported constant.    |
| Rotten anchor          | `packages/alpha/src/protocol.js:3` — a comment, so nothing is protected. |
