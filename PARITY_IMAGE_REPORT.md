# Parity Image SSOT Report

Issue #1536, SSOT kill-list row 5.

## Result

`packages/fight/src/fingerprint.js` now owns the fight package's only parity image. Production divergence reporting
and parity/coop regression tests consume `fingerprint_state`; the legacy image and its public re-export are gone.

The image retains its viewer-free roster/status/turn anchor and now includes the canonical facts the removed image
used to guard: fight id, phase, winner, turn deadline, turn-seed inputs, and fighter liveness, invisibility, AP, MP,
and readiness. Native bigint seed values normalize to decimal strings before JSON hashing. No fight fold, store,
presentation, or renderer behavior changed.

## Per-test translations

- `test/parity.test.js`
  - The store-door fold and direct fold now compare serialized `fingerprint_state` images. The direct side is a real
    headless core built by admitting the same normalized receipt actions, rather than a second board-shaped image.
  - Duplicate/stale/out-of-order convergence compares complete fingerprint images instead of legacy hashes.
  - `wave`, `presented_seq`, and the per-seat settlement machine are viewer-local and therefore intentionally absent
    from `fingerprint_state`; their prior nonterminal expectations remain as direct state assertions.
- `test/scenario_coop.test.js`
  - Alice and Bob now byte-compare their production `fingerprint_state` images. The concrete committed HP assertions
    remain direct reads.
- `test/inc0_guards.test.js`
  - A foreign snapshot's no-op guarantee compares the production image.
  - AP, MP, and readiness are viewer-free committed truth, so they were added to `fingerprint_state`; the corruption
    rows now perturb the canonical core input and prove the production image diverges.
  - Refused local intent/composite checks concern viewer-local prediction state. They remain direct AP/HP/entry reads,
    not parity-image assertions.
- `test/parity_contexts.test.js`
  - World, dungeon, and kolizeum now compare complete fingerprint sequences; distinct progress is counted from the
    serialized images.
- `test/one_ingress.test.js`
  - Receipt/journal/snapshot arrival-order cases now compare complete production images.
  - The derivation run exposed a formerly hidden turn-anchor mismatch: the fixture had combined v2 and v3 events
    into one impossible v3 receipt. It now delivers two receipts at their captured transaction versions. Version-only
    stale-snapshot comparisons use one stable positive deadline, so equivalent canonical turns have the same anchor.
- `test/reconcile_properties.test.js`
  - Canonical no-op/idempotence rows compare fingerprint images. The provider-refusal row additionally compares the
    direct prediction entries because local prediction is intentionally outside the image.
- `test/hermetic.test.js`
  - Added the structural class gate: source exports matching fingerprint/parity-image/legacy image vocabulary must
    resolve exactly to `fingerprint.js` exports `fingerprint_state` and `fight_fingerprint`.

## Deletions

- Deleted `packages/fight/src/legacy_hash.js`.
- Deleted the `canonical_state` / `state_hash` re-export from `packages/fight/src/inputs.js`.
- Removed all dead legacy-image imports from `parity.test.js`, `scenario_coop.test.js`, `inc0_guards.test.js`,
  `parity_contexts.test.js`, `one_ingress.test.js`, and `reconcile_properties.test.js`.
- Updated stale `state_hash` / `canonical_state` comments in `journal_normalize.js` and
  `placement_ghosts_fold.test.js`.

## Derivation and gate tails

Targeted translation run 1 honestly exposed seven mismatches: three viewer-local ledger comparisons and four
turn-anchor mismatches from the synthetic cross-version receipt/snapshot fixtures. After the translations above,
targeted run 2 was green:

```text
44 pass
1 skip
0 fail
122 expect() calls
Ran 45 tests across 7 files. [120.00ms]
```

Required fight suite (`cd packages/fight && bun test ./test`), exit 0:

```text
944 pass
23 skip
0 fail
42492 expect() calls
Ran 967 tests across 159 files. [1.78s]
```

Required root lint (`bun run lint`), exit 0 on the second allowed attempt. The first attempt reached constraints but
lacked ignored Move build witnesses and could not initialize Semgrep's sandboxed CA/log paths. The final attempt
used fresh local Move build outputs plus explicit writable Semgrep paths:

```text
MOVE LOCK REV GATE PASSED. every environment pins one framework lineage at the CI toolchain's commit (6effb4523834), and every git dependency matches its manifest.

ALL CONSTRAINT GATES PASSED.
```

Required root typecheck (`bun run typecheck`), exit 0:

```text
$ bun run --cwd packages/engine typecheck && bun run --cwd packages/sdk typecheck && bun run --cwd packages/sim typecheck && bun run --cwd packages/frontend typecheck
$ tsc --noEmit --checkJs
$ tsc --build
$ tsc --build
$ tsc --noEmit
```

## Commits

- `aac7ff9e fix(fight): unify parity on production fingerprint`
- `0ffe472a test(fight): pin parity image ownership`

No push was performed.
