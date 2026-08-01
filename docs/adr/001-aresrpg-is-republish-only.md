<!-- SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available -->

# ADR 001 — the `aresrpg` package is republish-only until the next ceremony

Status: PROPOSED (2026-08-02, retroactive — the decision landed 2026-08-01 in `75c4a3537`).
Supersedes nothing. A maintainer accepts or refuses this record; it does not change code.

## Context

`aresrpg` compiled to 101,818 of Sui's 102,400-byte hard `max_object_size` — 582 bytes of
headroom, with every remaining Move feature blocked behind a size fight (#1794, #1279).

The chosen lever (#1794 "Variant B", PR #1833, `75c4a3537`) demotes 51 `public fun` whose only
callers are Move tests to `#[test_only]`, plus 1 private helper and 4 constants they orphaned.
Measured −2,579 bytes. The budget followed the tree down to 99,239 (`72eb77391`).

Two rulings rode with it, both recorded only in
`packages/move/scripts/ceremony_preflight_compat.mjs:91-97`:

- **19 AdminCap-gated operator levers that also had no non-test caller stay public** — emergency
  domain freeze, world teardown, config dials. Incident response must not require a republish.
  Measured cost of that ruling: 2,206 bytes.
- **The shrink is republish-only.** Dropping public functions is an INCOMPATIBLE upgrade, so it
  lands with a fresh lineage, never over the live one.

## Decision

`aresrpg` on `edge` is no longer upgrade-compatible with the deployed lineage
(`packages/sdk/src/deployment/release.json`, `generated_at: 2026-07-27T22:51:44Z`). It reaches
players only through a **republish** — a fresh package lineage — and every Move change landed on
`edge` after `75c4a3537` inherits that constraint whether or not it is itself incompatible.

## Consequences

**Predicted and accepted.** Headroom 582 → 3,161 bytes; the #387 weapon-shape work and the rest
of the Move backlog become landable in-tree again. The budget is a ratchet, so the win cannot be
silently spent.

**Predicted, arrived through an unpredicted door.** The caller census read Move sources and
literal JS `target:` strings. The seed ceremony composes one call by INTERPOLATED name
(`::consumable_effect::${ceff.fn}`), so three doors and three constants were demoted that a
ceremony needs. Cost of the correction: +87 bytes (`e7bdaec95`) and a class gate
(`seed_full_corpus_doors.test.mjs`) that derives every name the interpolation can hold. Recorded
here because the lesson generalises: a caller census over source text cannot see a call site that
is assembled at runtime.

**Unpredicted, and the reason this record exists.** Between the demotion and the ceremony, the
live package cannot receive ANY fix by upgrade. Work now held on `edge` with no chain path
includes `#1842`'s global-freeze restoration — two `config.assert_enabled()` calls in
`shop::buy`/`buy_many`, the market money door that asserted only its domain bit while the GLOBAL
emergency freeze did not stop it selling — plus the P0 grant doors (#1571) and #387. A kill-switch
that measurably did not reach a money path is now queued behind a ceremony with no ticket and no
date. Nothing in the tree says so: `git grep upgrade-train` over `*.md` and `.github/` returns
nothing, and `node packages/move/scripts/ceremony_preflight_compat.mjs --mode-check` prints
`preflight mode: COMPAT — no REPUBLISH_WINDOW marker` — the machine-readable statement of which
lineage mode the tree is in says the opposite of the truth.

## Alternatives considered

- **Relocate the cold admin surface to a sibling package** (#1594, ~5KB, upgrade-compatible,
  no republish). Strictly better on this axis and still open; it was not taken because the
  demotion was cheaper to land. Accepting this ADR should re-rank #1594, whose stated DoD
  (≥2KB of headroom) the demotion has already met by a path that costs a republish.
- **The designed package split** (#1279) — the structural answer, owner-gated, unchanged by this.
- **Do nothing** — refused: 582 bytes blocks the spine.

## What would make this record unnecessary

A gate, not prose: run the compat leg of `ceremony_preflight_compat.mjs` in CI on Move PRs (it is
the same build the size leg already performs), so a PR that breaks upgrade compatibility either
carries the `REPUBLISH_WINDOW` marker or reds. Today the file's stated purpose — "catch
IncompatibleUpgrade BEFORE any ceremony, mechanically" — has no automated arming: the only two
invocations in the tree are `--mode-check` and `--size-only`
(`.github/workflows/checks.yml:220-221`).
