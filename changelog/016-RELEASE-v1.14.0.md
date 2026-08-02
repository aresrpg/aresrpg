# v1.14.0 — the world, re-seeded (2026-08-02)

## New features

- **A whole world, published fresh** — 1,863 items, 383 mobs, 1,434 recipes, 240 spells with
  localized descriptions, and 20 worlds, all republished onto a new lineage and served from a
  single verified snapshot. Spell descriptions read as prose in all six languages.
- **Player-to-player connections have one home** — the fight-turn courtesy overlay rides the room
  you are already in, the link never claims to be connected over zero channels, and the retired
  server-side position and chat routes are gone rather than dormant.
- **A sponsored transaction says what it is doing** — per-leg timing on the sponsored door, the
  login legs run in parallel with the challenge signing, and a refusal decodes into honest player
  copy instead of a raw error.

The fix you will feel first: **tackle is a toll, not a wall.** Being tackled costs movement and
leaves you the movement you still have, instead of ending your turn where you stand — and the
board greys the range you lost rather than deleting it, so you can see exactly what the tackle
took. Joining a fight in progress goes through one door, so a seat can no longer be admitted twice
or read as empty after it evaporates.

Also on the board this round: poison rolls its damage every tick instead of once, a hit that lands
on a fighter stops reporting empty ground, crush stops handing out free rerolls, mob portraits stop
guessing their own filenames (about 126 that looked missing were there all along), an oversized
gift refusal reads as prose, and the experience boost rounds its remainder instead of eating it.

Also: 53 tracked issues closed, plus stability and performance work across the fight core, the
sponsor, the indexer and the engine — full notes →
https://github.com/aresrpg/aresrpg/compare/v1.13.0...v1.14.0
