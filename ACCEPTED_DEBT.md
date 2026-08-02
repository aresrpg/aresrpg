# ACCEPTED_DEBT — the materiality bar's class list

A finding becomes a board row ONLY if it passes one of three tests: **player-felt** (crash,
wrong outcome, visible wait, confusion, money) · **floor/constitution** (money, keys, truth,
SSOT, the one-reducer law, the deterministic twin — these have NO threshold, ever) ·
**release-gate** (blocks the current spine phase). Everything below the bar is accepted debt:
real, known, and deliberately not tracked as issues — an instrument told to find issues will
always find issues; the tail is discarded at the instrument, not triaged at the board.

Instruments (audits, loops, harvest passes) report their **top-5 findings ranked by the bar**
and discard the rest unwritten. Armed gates and ratchet baselines are exempt — they mint no
rows and only shrink. This file is the class list instruments must not report; changing it is
a visible, reviewed act (one line per class), the same governance as FROZEN.md.

## Accepted classes

- **docs-drift** — stale code-comment citations, comments describing moved code, referenced
  docs that no longer exist. Corrected whenever the file is next touched; tests are the truth.
- **naming drift outside hot paths** — legacy names on stable surfaces (e.g. dungeon_* for
  universal fight paths). Renames ride refactor trains that touch the surface anyway.
- **dev-tooling ergonomics** — local-dev friction that blocks no QA drive and no gate
  (preview binding quirks, watch-mode niceties).
- **CI noise** — skipped-run spam, dead declared triggers, cosmetic workflow warnings that
  cost pennies and gate nothing.
- **typedef completeness outside money/chain paths** — display-field type gaps; types tighten
  as surfaces are touched. (Money/chain typedefs are floor-class and stay row-eligible.)
- **janitor class** — orphaned hooks, dead exports, stale flags discovered in passing. The
  continuous janitor sweep owns deletion; discovery does not mint rows.
- **instrument self-reference** — baselines/manifests describing their own stale state; fixed
  at the next rebaseline, which is already a reviewed act.

## What never lands here

Money paths. Key handling. Anything SSOT (a second source of truth is a constitution
violation at any size). Twin parity. Player-felt behavior at any severity. A class may only
be added by a visible edit to this file — and any single finding inside an accepted class that
crosses a floor test is a row regardless of its class.
