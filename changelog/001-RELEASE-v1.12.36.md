---
type: release
date: 2026-07-21
title: v1.12.36 — AresRPG goes source-available
---

# v1.12.36 — AresRPG goes source-available

The lands of Ares have a new home: the whole game — client, voxel engine, combat
system, on-chain contracts — now lives in the open at **github.com/aresrpg/aresrpg**.
Read it, build it, run it locally, and help us make it better. Every release from
this one forward ships straight from this repository, tagged and published the
moment it lands.

## Combat, steadier than ever

This release carries a deep rework of how your fights stay in sync with the chain:

- **Kills stick.** A defeated creature stays down — no more ghosts flickering back
  for a heartbeat after the killing blow.
- **Invisibility holds.** Vanish for three turns and the world respects it — your
  cloak no longer drops early after ending a turn.
- **Turns commit honestly.** Actions the game can't accept are refused before they
  cost you anything, and what you see on the board is what the chain recorded.
- **Fight recordings.** Battles are now replayable timelines under the hood — every
  future fix is proven against real recorded fights before it ships.

## The new era

- Work happens in pull requests, tested by the same gates for everyone — maintainers
  included.
- Found a bug? Open an issue, or come tell us on [Discord](https://discord.gg/aresrpg).
- Want to contribute? `good-first-issue` marks self-contained starting points.

Your characters, your items, your progress: on-chain, in your wallet, yours —
that part never changes.
