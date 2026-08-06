<!-- SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available -->

# ADR 004 — fight start proves membership, it does not re-derive the zone

Status: ACCEPTED (2026-08-06). The door landed in `98874e21f`, deployed 2026-08-05 in the chain
ceremony pinned by `758a649c7`, and the client gate opened in `c3eac413d`. Supersedes nothing;
interacts with ADR 001 (lineage) and ADR 002 (a Move change has two landings).

## Context

A fight start had to authenticate one fact: this mob group belongs to this searched zone. The
claim path answered it by re-deriving the ENTIRE zone on chain and linear-scanning for one
spawn id. Measured (#2194, 270 captured transactions, wallet-arithmetic-verified): that single
mechanism was ≥34.7% — realistically ~45% — of an entire play-hour's gas. The control isolates
it: `fight::join` seats a full participant for 1.62 mSUI of compute, while fight-start averaged
48.95 mSUI on structurally identical PTBs (13.2 → 115.7 mSUI by zone complexity). Seating is ~3%
of the bill; the derivation is the rest.

The chain already commits to the membership fact at SEARCH time — but formats 2/3 commit it as a
flat hash over the whole derived set, so checking one row requires rebuilding every row. The cost
is the COMMITMENT'S CONSTRUCTION, not the derivation's implementation. Format 1 already stored a
real Merkle root and authenticated in O(log n); the file's own comment nonetheless declared the
re-derivation deliberate — _"the derivation IS the proof; there is nothing a Merkle path would
save"_ — and the same file disproved it.

## Decision

**Commitment format 4**: the same derived set as format 3 (member lists, #1110/#1111), committed
as `0x04 ‖ merkle_root` over per-group leaves instead of one flat digest
(`packages/move/foundation/sources/zone_gen.move:51,742,783`). A fresh search rolls format 4
(`packages/move/aresrpg/sources/zones.move:301-330`). A fight start against such a zone brings a
witness — index, template, roster, progress, position, size, seed, path — and the door verifies
ONE inclusion path against the stored root (`zones.move:643-656`, via
`zone_gen::mob_group_member_root_matches:805`), then joins the same shared security tail every
claim door already ran.

**Old formats keep their doors.** The format is not a flag we choose: the leading byte of a
zone's own stored commitment selects its derivation, forever. Formats 1/2 keep the original
derive-or-proof doors, format 3 keeps the whole-set derive door, and a format-4 zone still
ACCEPTS the derive door as the fallback a client takes when it cannot compose a witness
(`zones.move:401-402,583,588`; the sim decodes the same byte at
`packages/sim/src/zone_derive.js:181-188`). Nothing at format ≤3 lost a path, and no zone was
migrated.

## Consequences

**The measured delta.** Recorded on #2227 with its method: both doors simulated (devInspect, zero
on-chain executions) against the SAME live zone and mob group — zone 488:487, the first format-4
zone, committed by digest `6DyVZvrs4ZanUy1GdwbmB3hEQnBQGELTDkQ7r6TrNzG9` — byte-stable across two
runs per door. Old door: computation 78,100,000 MIST, net 113,060,152. Witness door: 39,200,000 /
74,160,152. **Computation −49.81%, net −34.41%**, storage identical both sides, witness +382 tx
bytes. That is a mid-size zone; the ratio grows with density — the claim leg alone measured
73,599 → 12,776 units (−82.6%) at production density (48 groups), and search pays the tree build
once (+10,957 units), repaid by the first fight.

**The twin is a triplet, and all three legs shipped in the same arc.** Move commits the root; the
sim decodes the byte and mirrors format 3 row for row
(`packages/sim/test/zone_format4_twin.test.js`); the indexer serves `group_root` + `group_count`
off the `zones::ZoneGroupRootKey` dynamic field (`packages/rpc/api/views.js:735-741`) so the
client can compose the ≤6-level witness through `compose_mob_group_proof`, which recomputes the
root and FAILS SHUT — null degrades to the original door, never a broken claim. A format only one
leg understands is an unplayable zone.

**A cheap door nobody can take is not a saving.** The Move arm shipped end to end while the client
short-circuited every zone to the expensive door on a comment the same window had falsified, with
a test pinning the stale law — CI green on the wrong behavior until `c3eac413d` (#2227). The
decision is now taken from the served root's own leading byte
(`packages/frontend/src/world-shell/dungeon_engage_actions.js:123-131`), not from a client-side
belief about what the deployed package supports.

**Cost, and where it was paid.** `aresrpg` grew 99,304 → 100,010 bytes; the pinned budget rose
with a written adjudication in the same commit (`packages/move/scripts/ceremony_preflight_compat.mjs:116`),
leaving 2,390 bytes of the 102,400 chain ceiling. The verifier is homed in `foundation` — which
had room — precisely so the door itself was the only aresrpg-side spend.

**ADR 001 did not bind this, and that is not luck.** ADR 001's republish-only constraint was
consumed by the republish that minted the current lineage (origin
`0x2c41f09398414a1c51b0ccbd63057aef1e8e1aeedd3313b2852554dba596eb26`). Format 4 was then designed
add-functions-only — new doors, no public signature changed, no struct altered — so it rode an
UPGRADE inside that lineage (digest `mdTuX7afeQsgkVqfoCmkgmgdYBKK6XLbsRHUrS4ZBzu`, `latest` →
`0x1a561cc4…`). Object type identity is the ORIGIN id, which did not move: characters, kiosks and
every already-searched zone survived untouched, and pre-existing zones kept serving format 3.

## Alternatives considered

- **Make the re-derivation cheaper.** Refused: an optimized rebuild is still O(zone) per fight
  start. The commitment shape, not the loop, is the cost.
- **Migrate existing zones to format 4.** Refused: a zone's commitment is state a player already
  searched under; rewriting it rewrites history, and the retained derive door makes it pointless.
- **A root per group, no tree.** Refused: O(n) commitment storage at search time to save O(log n)
  at claim. The tree pays once and is read once.
- **Do nothing.** Refused: ~45% of play-hour gas for one membership check, with the answer already
  present in format 1.

## What would force revisiting

The root is a function of the zone's derived SHAPE — the leaf contents
(`zone_gen.move:742`) and the duplicate-last tree over them. Any change to the group stream (new
per-group fields, different roster truncation, a changed group ordering) changes the leaf and
therefore the root. That is a NEW format byte with its own triplet, never an edit to format 4:
every zone already committed under `0x04` must keep verifying under the rule it was committed
with.
