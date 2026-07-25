# Zone Composition — the commitment byte decides how a zone is read

Status: ADOPTED (2026-07-25). This is the architecture decision record for seed-derived zone
composition and the mob-group claim door. Code that contradicts this document is wrong; changing
this document is a reviewed, deliberate act.

## The rule

**A zone is read with the derivation it was written with.** A discovered zone stores only its
composition seed and its consumed bitmaps; the group and cell lists derive from that seed. Which
derivation runs is not a version flag any reader chooses — it is one byte, read off the zone's own
stored `ZoneGroupCommitment.root`:

| Stored root               | Format      | Placement          | Claim witness                                                              |
| ------------------------- | ----------- | ------------------ | -------------------------------------------------------------------------- |
| absent                    | 1 (legacy)  | rejection sampling | `≤6`-level Merkle sibling path                                             |
| 32 bytes, bare            | 1 (legacy)  | rejection sampling | `≤6`-level Merkle sibling path                                             |
| 33 bytes, `0x02 ‖ digest` | 2 (lattice) | 40×40 cell lattice | EMPTY proof vector, chain re-derives                                       |
| anything else             | 0           | —                  | no writer produces it; a reader treats it as a version skew, never a guess |

Getting the byte wrong derives a world the chain never committed: every `spawn_id` becomes fiction
and the claim door aborts `ESpawnNotFound` (108). That is not hypothetical — it is the defect #816
fixed on live zone `487:487`.

## Format 1 — the legacy Merkle root

`zones::search_zone` commits a 32-byte Blake2b-256 duplicate-last Merkle root over the FULL derived
mob-group stream, leaves being the canonical BCS `MobGroupLeaf` (world, zx, zy, zone_seed,
discovered_at_ms, index, spawn_id, template, x, z, group_size, group_seed). Placement is rejection
sampling: re-roll a free position until it clears the 20-block minimum spacing (variable draw count,
`POS_ATTEMPTS = 64` before accepting the last roll). A claim carries the leaf facts, its index and
the sibling path; the chain verifies the path instead of re-deriving the stream. With `MAX_GROUPS =
64` the path is at most 6 levels, and that is the compute diet: **577.8M → 7.32M MIST at G=64**.

## Format 2 — the whole-set commitment

```
root = 0x02 ‖ blake2b256("aresrpg.zone-group.commitment" ‖ 0x02 ‖ bcs(MobGroupSet))
MobGroupSet { world, zx, zy, zone_seed, discovered_at_ms, groups: vector<MobGroup> }
MobGroup    { spawn_id, template, x, z, group_size, group_seed }
```

**One hash over the whole set — not a root over per-group leaves.** There is no tree, so there are
no siblings to serve and no membership path to send. A claim on a format-2 zone supplies an EMPTY
proof vector; the chain re-derives the entire stream on-chain, rebuilds the commitment and compares
it. A non-empty vector aborts `EBadGroupProof` (110).

Placement is the lattice: the zone box (clipped to world bounds) is diced into whole 40×40 cells,
the cell pool is drawn WITHOUT replacement (Fisher-Yates against the unconsumed tail), and each
spawn is jittered `+10 + [0,20]` on each axis into its cell's middle 21 blocks. Spacing is therefore
structural, not sampled: neighbouring cells are at least `40 - 20 = 20` apart and no two spawns can
share a cell. The cell count is also the zone's capacity — a zone with fewer cells than the rolled
group count yields one group per cell.

**Draw layout, per mob group: 8 draws** — weighted template pick (1) · group size (1) · position (3)
· group seed (1) · `spawn_id` hi/lo (2). The position triple is the whole delta from legacy's 2: one
Fisher-Yates selection plus one jitter draw per axis. **The last cell costs 7**: the selection draws
`p_roll_u64(state, i, pool.length - 1)`, and that primitive SKIPS the draw entirely when `lo >= hi`,
so on the final unconsumed cell the PRNG state does not advance for the selection. A twin that
always draws desynchronises the whole remaining stream. Resource cells share the same lattice, one
anchor per entry (a grown gather field spends one anchor, not one per cell).

## One rule, five consumers — where the byte is read

The dispatch is written once per runtime and nowhere else. Any new reader of a zone's groups goes
through one of these doors; none of them may re-implement the test.

| Home                                             | Function                                                                 | Role                                                                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/move/foundation/sources/zone_gen.move` | `mob_group_commitment_format`                                            | the byte reader (1 / 2 / 0), plus `mob_group_commitment` and `mob_group_commitment_matches` for format 2                                                                                  |
| `packages/move/aresrpg/sources/zones.move`       | `group_commitment_format`                                                | reads the stored DF; a MISSING commitment reports 1. Feeds `derive_mobs` / `derive_res` — the only in-package doors to a zone's groups and cells — and the `resolve_mob_group` claim door |
| `packages/sim/src/zone_derive.js`                | `commitment_format`                                                      | the client derivation twin, byte-for-byte with `zone_gen`                                                                                                                                 |
| `packages/sdk/src/fight_proof.js`                | `normalized_commitment` → `compose_mob_group_proof`                      | the witness producer: Merkle path for format 1, empty vector for format 2, typed failure on an unknown shape                                                                              |
| `packages/rpc`                                   | `map_group_root_field` (indexer) → `/v1/zones?world=&zone=` `group_root` | serves the byte; a composer that drops it silently derives the legacy world                                                                                                               |

## Consequences a reader must not miss

- **The `≤6`-level witness story and the 577.8M → 7.32M MIST figures are FORMAT-1 ONLY.** On a
  lattice zone the proof door buys the commitment check, not the compute saving — the chain
  re-derives the full stream either way. The diet's numbers have not been re-measured per format;
  quoting them for a format-2 zone is wrong (#837).
- **Zones discovered by the current package are format 2.** Format 1 is the pre-lattice history that
  must keep resolving forever, not a path anything new lands on.
- **A read path that forwards the seed but drops the commitment root cannot dispatch** even when
  both derivations are implemented. The root travels with the zone state, always.

## Known divergence: source vs deployed

The vendored Move tree is knowingly behind the deployed lineage on the claim path, tracked in #841:
`search_internal` writes a bare 32-byte root where deployed v3 writes the tagged commitment, and
`resolve_mob_group` has no format-2 branch. `FROZEN.md` anchor 1 makes chain readback the truth and
the chain runs deployed bytecode, so runtime is unaffected — this is source fidelity and
future-upgrade safety, not a live defect. The behaviour this document describes is the DEPLOYED
behaviour, disassembled from the testnet `foundation.latest` package and verified against live chain
reads (#836), which is what every client in this repo is written against.

## Provenance

Landed across #816 (sim twin, parity-pinned to 368 values read from the deployed package on zone
`487:487`), #840 (the Move half of the derivation), and #836 (the witness producer + the empty-proof
door). Before this record the rule existed only as code commentary in `zone_derive.js` and three
merged PR bodies — the gap #837 named.
