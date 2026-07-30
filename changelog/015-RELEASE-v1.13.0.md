# v1.13.0 — the simulator opens (2026-07-30)

## New features

- **A fight simulator you can play offline** — build a fight from nothing: pick seats, gear them
  with max-roll items, place mobs, drive the board cell by cell and cast for real. Same fight math
  as the world, no wallet and nothing at stake. The old build calculator is retired.
- **Hack mode** — one settings toggle swaps the world for a neon grid: glowing sun, breathing
  floor, psychedelic sky, a pinned daytime, a remapped minimap, and a radio playing over it.
  It arms and disarms without a reload.
- **Companions live their own lives** — pets follow as independent world entities instead of
  welded rigs, fish-family pets hover above you, and other players' companions now appear
  beside them.
- **The party rebuilt around groups** — the lobby button invites to a group, party rows state
  honestly whether someone is with you, blocked or in transit, and far followers ride the dragon
  to catch up instead of teleporting.
- **See the damage before you commit** — the turn preview shows this turn's exact rolled damage,
  the same roll the chain resolves.
- **Mob packs are real groups** — every pack carries its member roster, difficulty grades with
  distance from the shore, and bosses stay fenced to their own rooms.
- **Marketplace history and proceeds** — a HISTORY tab, a red dot when sales are waiting, and
  every kiosk's earnings collected in one transaction.
- **The map draws the world** — zone boundaries and names now render on the big map, and stat
  rows show what your equipment contributes to each characteristic.
- **Fewer detours** — duplicate stacks merge on world load, recipe ingredients and end-fight mob
  rows deep-link into the encyclopedia and bestiary, and a spend guard states every transaction's
  cost in plain language, in all six languages.
- **Faster starts** — boot media downloads defer, the encyclopedia catalog loads lazily, and cold
  world reads run in parallel.

The fix you will feel first: a hit that restores health finally reads as a heal instead of damage,
and an idle turn auto-passes instead of hanging forever. Base health regeneration is now a third
of what it was.

Also: 607 bug fixes and stability improvements — full notes →
https://github.com/aresrpg/aresrpg/compare/v1.12.50...v1.13.0
