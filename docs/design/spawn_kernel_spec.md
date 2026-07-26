# SPAWN KERNEL — mixed-species packs, distance-graded levels, the engine door (design spec)

`Status: ADOPTED (2026-07-27)` — code that contradicts this document is wrong.

Source: issues [#1110](https://github.com/aresrpg/aresrpg/issues/1110) (mixed-species groups) and
[#1111](https://github.com/aresrpg/aresrpg/issues/1111) (equal spawn + graded difficulty). The four
rulings below are transcribed **verbatim** from that thread and are binding: amendment 3 fixes the
shape of a new `fight::create` door, and a Move public signature cannot be revised after publish.

Landed in two halves: PR #1149 (the derivation kernel — formats 1/2 untouched, everything new inert)
and the engine-door wave (this spec's amendment 3 — the door that makes format 3 reachable).

---

## 0. The ruling — the wave's constitution

_(verbatim, issue #1110)_

The build lane's investigation established three ground truths that reshape this issue:

1. **The fight contract is one-spec-per-group by construction**: `engine/fight.move create_round(spec: &MobSpec, group_size)` — there is no member-list seam anywhere between the zone kernel and the engine. The commitment (`MobGroupLeaf`/format 2) commits exactly `{template, group_size, group_seed}`.
2. **The dungeon door REJECTS mixed** (`dungeon.move assert_homogeneous`) — the corpus's mixed families are mixed across rooms, never within a fight. Dungeons stay homogeneous (authored rooms); MIXED IS THE WORLD'S FEATURE.
3. **Levels are drawn engine-side, uniform(min,max), distance is not an input** — no plumbed value carries progress into the engine.

**The wave (one publish, six packages, inseparable):**

- `zone_gen`: `derive_mob_groups` format-3 variant emitting a per-group MEMBER LIST (`vector<template_idx>`, len = group_size); `mob_group_commitment_format` gains the format-3 byte — formats 1/2 keep deriving so every in-flight zone's stored commitment stays valid (the existing mechanism at zone_gen.move:385-389). Any draw-order change without the format bump corrupts in-flight zones — the bump is mandatory.
- `engine`: new entry points beside the old (upgrade-compat law — never edit public signatures): a create path taking the member list, and the mob level draw gains a `progress` input (0-1000) plumbed via a new GroupTicket constructor — level bands lerp toward the authored max with distance. THIS is where #1111's gradient lands.
- `aresrpg/zone_comp`: `eligible_mob_weights` drops its level-cap zeroing IN THE SAME COMMIT the graded draw lands — substitution, not addition. Either half alone is a shipped regression (membership-only = a fresh character meets full-band mobs at spawn; gradient-only = the monoculture survives).
- `sdk/fight_proof.js` + `sim/zone_derive.js` + `frontend/spawn_compose.js`: format-3 mirrors, same commit, parity fixtures on pinned seeds (twin law).
- Migration: none — new searches roll format 3; old zones replay their committed format.

## 1. Amendment 1 — dungeon rider + composition

_(verbatim, issue #1110)_

**Dungeon rider — family-strict, not template-strict.** `dungeon.move assert_homogeneous` is TEMPLATE-strict today (`roster.borrow(i) == template_id`), which makes donor-pattern boss rooms (boss + same-family adds — different templates, one family) unauthorable. Constraint discovered: `MobTemplate` carries NO family field, and a Sui upgrade cannot add struct fields to existing objects — so family-strict cannot key off the template. Resolution for the wave: the room's own AUTHORED roster is the allowlist — replace the template-equality assert with validation against the room's authored member set (family becomes a corpus-side authoring concept; the chain accepts what the room authored, rejects anything else). Fixture-gated in the same commit: a boss+adds roster must pass, a roster row absent from the room's authored set must abort.

**Composition ruling for wave 1 (YAGNI applied):** world mixed packs are RANDOM per-member draws from the zone's eligible roster — no authored pack tables in this wave. If the felt result reads wrong (random mixes feeling incoherent), authored pack overrides become a follow-up seam, corpus-side first. The seed holds composition tables until then.

## 2. Amendment 2 — the boss member-draw fence

_(verbatim, issue #1110)_

Content QA finding: 9 boss rows sit in the pick tables; random per-member draws could mint multi-boss packs or a boss riding a chicklet group.

- **Primary draw keeps today's exact shape and order**: the group's first pick is the existing weighted template draw. If the primary lands on a BOSS row ⇒ the group stays SINGLE-SPEC (today's boss-group behavior, byte-for-byte draw order — format-2 zones unaffected as ever).
- **Member pool excludes bosses**: non-primary members draw from eligible ∧ ¬boss.
- **The boss predicate lives ON CHAIN as a cap-gated dynamic field** on the world (`boss_mask`, positional over the mob table) — a struct field can't be added in an upgrade, but a DF can (the house extension-gate pattern). Written by the admin in the SAME PTB family that writes/reorders the table, so the mask and the table can never drift (the loose-artifact alternative rots on any reseed reorder). Absent mask = all-false (back-compat: worlds without the mask just never mix bosses in, because... they also can't draw them as members — fail-closed either way: absent mask ⇒ member pool excludes NOTHING extra but primary-boss ⇒ single-spec still holds; the seed writes the mask for all 20 worlds at the wave's ceremony).
- **Fixtures**: ① no group mixes a boss row with any other row ② a primary-boss group is single-spec at its authored band ③ mask-absent world degrades to primary-boss-single-spec only.
- Archis STAY in the member pool — mixed packs featuring archis are the feature.

## 3. Amendment 3 — the engine door protocol

_(verbatim, issue #1110)_

Ground truth from the execution lane: `MobTemplate` is a shared object and Move has no `&vector<SharedObject>` — a variable member roster cannot enter `fight::create` through any existing signature. RULING: the **hot-potato builder** is the seam:

- `open_group(ticket) → GroupBuild` (hot potato, no abilities) — the NEW ticket constructor carries the committed member template ids IN ORDER + `progress` + group provenance.
- `add_member(&mut GroupBuild, &MobTemplate) ×N` — each call asserts the template's id equals the NEXT committed member id (the commitment binds the roster; out-of-order or foreign templates abort — no swap exploit).
- `create_members(GroupBuild, …)` — consumes the potato, asserts count == committed size, builds the fight.
- Per-member kits move to indexed DFs on the Fight UID with ONE per-index accessor; the 9 kit call-sites in `turns.move`/`cast.move`/`settlement.move` read through it (mechanical once the accessor exists).
- Dungeon ⑤ lands ONLY in the same wave: roster-as-allowlist asserts against the room's authored set AND the create path takes the actual roster — this kills the weakest-template-×N exploit the execution lane correctly refused to ship.
- The search door starts writing format-3 commitments in the SAME commit that wires `derive_zone`'s format-3 branch (the lane's own coupling note) — never before.

PR #1149 (foundation half) lands first: formats 1/2 byte-identical, everything new inert until the door opens. The door lane's fence: engine/{fight,mob,turns,cast,settlement}.move · aresrpg ticket path + zones search door · dungeon.move · sdk/sim/frontend twins.

---

## 4. As built — the decisions the rulings left to the lane

Everything below implements the four rulings above; where a ruling was silent, the lane's choice
is recorded here with its reason. This section is normative for readers of the code.

### 4.1 The two tickets

`zones::GroupTicket` is frozen (a published struct's fields cannot change under a COMPATIBLE
upgrade), so format 3 gets its own hot potato, `zones::MemberGroupTicket`, carrying the format-2
facts plus `members: vector<ID>` (the committed roster, in draw order) and `progress` (0-1000).
Both tickets keep the same security shape: the only constructor sits behind the full claim
gauntlet.

**Format is the router, never a caller preference.** A zone's stored commitment byte decides which
claim doors accept it:

| stored format                 | claim doors                              | create path                                | placement      |
| ----------------------------- | ---------------------------------------- | ------------------------------------------ | -------------- |
| 1 (legacy, bare 32-byte root) | `claim_mob_group[_in_zone][_with_proof]` | `fight::create`                            | spaced sampler |
| 2 (`0x02‖digest`)             | same                                     | `fight::create`                            | lattice        |
| 3 (`0x03‖digest`)             | `claim_mob_group_members[_in_zone]`      | `open_group`→`add_member`→`create_members` | lattice        |

Crossing the table aborts (`EMemberZone` / `ENotMemberZone`) — fail-closed, never a silent
single-spec fallback, because a mono-spec fight over a mixed commitment is exactly the divergence
the commitment exists to prevent. Format-3 claims carry no Merkle proof: the whole-set commitment
means re-derivation IS the proof (identical to format 2).

### 4.2 Per-member content

`GroupContent {template, xp, loot, kit}` — one shared block on the Fight since the mob-kit dedup —
becomes an INDEXED dynamic field (`MemberContentKey { index }`) written once per member at
`create_members`. The one per-index accessor is `fight::member_content(fight, index)`; **absent ⇒
the fight's shared block**, so every fight created before this door (and every single-spec fight
after it) reads exactly what it read before, through the same door. That is what lets the 10 group
call-sites migrate with no branch:

`turns.move` 263, 264, 281 · `cast.move` 486, 494, 598, 1768, 1769 · `settlement.move` 134, 160.

(494 — the action envelope's caster template — is not in the ruling's list of 9 but is the same
class: a mixed pack's envelope must name the CASTER's species, not the primary's.)

### 4.3 XP and loot for a mixed pack

- **XP** is `Σ member_xp(j)` over the seated mobs. For a single-spec fight that is `group_xp ×
mob_count` exactly — one expression, no branch, byte-identical for every fight that predates this
  door.
- **Loot**: the outcome's `loot` vector is a ROLL CHECKLIST and its `mob_count` field is how many
  times the checklist repeats (`results::open`). A single-spec fight ships one table × N mobs; a
  mixed pack ships the members' tables concatenated × 1. Both mean the same law: **every dead mob
  rolls its own table exactly once.** The mono shape is kept for mono fights so a legacy outcome's
  stored bytes (and storage cost) do not grow.

### 4.4 The level draw

`mob::spawn_seeded_graded` (PR #1149) draws from `graded_band(min, max, progress)` — a quarter-band
window sliding up the template's AUTHORED band with distance — and always spends exactly one level
draw, including on a point band, so members of different species stay stream-aligned.

**Dungeons pass `progress = 1000`.** There is no `progress` that reproduces `uniform(min, max)`, and
authored rooms are the hard end of content, so a room's mobs draw from the top quarter of each
template's own authored band. Identical for a point band (`min == max`), which is what boss rows
are; a mild, bounded step up for banded rooms. Flagged here because it is the one balance-visible
side effect of routing dungeons through the graded door, and the corpus can re-author bands against
it.

### 4.5 The dungeon allowlist

`next_fight` (single template, `assert_homogeneous`) is untouched and keeps serving homogeneous
rooms forever. The new `open_room_fight` door commits the room's AUTHORED roster as the builder's
member list, so `add_member` validates every template against the room's own authoring, in order —
the allowlist and the create path are the same mechanism, which is what closes the
weakest-template-×N substitution the ruling names.
