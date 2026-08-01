# GUILD DOSSIER — the last big Move feature vs the no-republish wall

Decision document: what guild structure MUST exist in the mainnet publish of the AresRPG Move
packages, versus what arrives later via upgrade or fresh satellite publish. Grounded in the full
`packages/move/` tree (edge @ clone 2026-07-22), docs.sui.io upgrade semantics (fetched and
quoted), and the four live satellite-split precedents (kolizeum, forgemagie, gifting, dungeon).

Verdict up front: **the mainnet publish needs ZERO guild-specific Move code.** The anchors that
make guilds buildable later are already in the tree as general architecture — retained
UpgradeCaps, the Version single-path machinery, gate-parameters-on-every-door discipline, the
open-generic fight engine, and the brand-pin ceremony. The dossier proves each claim against a
Sui semantic or a file:line, designs the guild system to demonstrate the anchors suffice, and
walks the exploit classes.

---

## 0 · Verified Sui upgrade semantics (the rules everything below cites)

Fetched from https://docs.sui.io/develop/publish-upgrade-packages/upgrade and the std framework
reference on 2026-07-22. Quotes verbatim where load-bearing.

| #   | Semantic                                                                                                                                                                                                                                                                                                                                        | Status                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| S1  | Compatible policy CAN: "add new structs and functions", add new modules, "change function implementations", "change non-public function signatures, including friend and entry function signatures", "remove generic type constraints"                                                                                                          | VERIFIED (docs)                                                                                    |
| S2  | Compatible policy CANNOT: "Existing `public` function signatures must remain the same"; "Existing struct layouts, including struct abilities, must remain the same"                                                                                                                                                                             | VERIFIED (docs)                                                                                    |
| S3  | "Module initializers do not re-run with package upgrades … Any `init` functions you might include in subsequent versions of your package are ignored" — **including new modules added by the upgrade** (no OTW, no `init`-created objects for them, ever)                                                                                       | VERIFIED (docs)                                                                                    |
| S4  | Type identity binds to the **defining** package version: `type_name::with_defining_ids<T>` returns "the ID of the package in storage that first introduced the type". A struct introduced in v1 stays the same type at v6; objects created by old code are usable by new code. (`type_name::get` is a deprecated alias of `with_defining_ids`.) | VERIFIED (docs + framework ref)                                                                    |
| S5  | Static linkage: "If you have a package with a dependency, and that dependency is upgraded, your package does not automatically depend on the newer version. You must explicitly upgrade your own package to point to the new dependency."                                                                                                       | VERIFIED (docs)                                                                                    |
| S6  | Old package versions are never deleted and their public functions stay callable forever ("Nothing prevents other packages from accessing the methods and types defined in the old versions") — this is WHY the shared-`Version` single-path gate exists                                                                                         | VERIFIED (docs)                                                                                    |
| S7  | `make_immutable` / policy restrictions (`only_additive_upgrades` etc.) are one-way: once restricted or destroyed, never widened                                                                                                                                                                                                                 | VERIFIED (docs + skill ref)                                                                        |
| S8  | New PACKAGES can always be published on mainnet later; their `init` runs at their own publish. "No republish" constrains existing lineages, not new siblings — proven live by the kolizeum/forgemagie/gifting/dungeon splits (each has its own `Published.toml`, original-id ≠ core's)                                                          | VERIFIED (in-repo + basic Sui)                                                                     |
| S9  | A derived-object claim is PERMANENT — "`derived_object` exposes no `unclaim`" (a freed name can never be reclaimed; a revocable relation must NOT be modeled as a derived claim)                                                                                                                                                                | VERIFIED (in-repo: character.move:28-30; framework behavior)                                       |
| S10 | Display authority is package-level: an existing `Publisher` of a package can register `Display<T>` for a type T added to that package later                                                                                                                                                                                                     | UNVERIFIED — not load-bearing here (the guild satellite gets its own OTW/Publisher at publish, S8) |

**The sharpest derived rule (S2 + Sui's object-input model):** a public function's body may
change (S1), but a body can only reach objects already in its parameter list — Sui Move has no
global storage access. Therefore **a public door shipped without its gate parameters
(`&Version`, `&GameConfig`) can never be version-gated, kill-switched, or config-gated later.**
This — not any guild struct — is the real "anchor sufficiency" test of the mainnet publish.

---

## ① ANCHOR LIST — what MUST ship in the mainnet publish

### A. Hard anchors (required under every future — all ALREADY IN TREE, cost 0 new LoC)

**A1 · Retained, unrestricted UpgradeCaps for `aresrpg` (core), `aresrpg_fight` (engine),
`aresrpg_social`, in cold custody. Never `make_immutable`, never `only_additive_upgrades`.**

- Why an upgrade cannot fix its absence: S7 — restriction/destruction is irreversible. A frozen
  core could never gain the guild-perk brand doors, the `DOMAIN_GUILD` accessor, or a
  character-DF door (D319: `&mut UID` never crosses packages; extension.move:14 and
  character.move:277 keep `uid_mut` package-private, so cross-package writes exist only through
  core-side brand doors that must be ADDED by core upgrades).
- Cost now: zero code; an operational custody rule.
- If missing (core frozen at mainnet): guilds still shippable as a satellite (see B), but
  permanently locked out of: guild-perk hooks in core value paths, guild cosmetic item mints,
  on-character guild markers, a guild domain kill-switch bit. That is the D319 scenario the
  house law warns about — the entire conditional-anchor set of §C would then be mandatory day one.

**A2 · Every public door carries its gate params from day one (`&Version` and, on value paths,
`&GameConfig`).**

- Why not addable later: S2 (public signatures frozen) + no-global-storage — an ungated door is
  ungatable forever, and stale-version copies of it stay callable forever (S6).
- Status: house discipline already universal (every entry in party.move, kolizeum.move,
  creation.move, character_link.move opens with `version.assert_enabled()` /
  `assert_latest()` / `config.assert_domain(...)`). Pre-publish audit checklist item, not new code.

**A3 · The Version single-path machinery in every upgradeable package** (shared `Version` object

- in-source `PACKAGE_VERSION` + admin bump — aresrpg/sources/version.move:21,
  social/sources/version.move:23, engine/sources/version.move:21).

* Why not addable later: the OBJECT is addable later (a ceremony fn can share one — header.move
  precedent), but every already-shipped door that never took `&Version` could not be pointed at
  it (A2). Shipping the machinery + threading it through every door is a publish-time property.
* Status: in tree, live (core PACKAGE_VERSION=1, social=2 — social v2 IS the proof the
  bump-and-retire ceremony works on a live lineage).

**A4 · GameConfig kill-switch headroom**: `domain_enabled: u16` with 8 of 16 bits used
(config.move:53-61, "Append-only"). `DOMAIN_GUILD = 256` + `public fun domain_guild()` arrive by
core upgrade (S1: new constant + new function). Headroom is sufficient; nothing to do now.
Fields on `GameConfig` are frozen (S2) — a later guild pin CANNOT be a new named field like
`forge_brand`; it will be a dynamic field under the config/Version UID, which is exactly the
already-proven `PartyCharacterTypeKey` idiom (social/sources/version.move:39-41 — added in
social's v2 UPGRADE, layout untouched: "the pin lives as a Version dynamic field, so this
upgrade adds no field to the frozen Version layout", social/sources/admin.move:52-53).

### B. Proven non-anchors (things one might fear must ship now — with the semantic that frees them)

| Feared anchor                                             | Why it can wait                                                                                                                                                                                                                                                | Semantic / precedent                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Guild struct, registry, name table                        | New satellite package `aresrpg_guild`; its `init` runs at ITS publish                                                                                                                                                                                          | S8; kolizeum Published.toml (own lineage, v1) |
| Guild events                                              | New structs in the new package                                                                                                                                                                                                                                 | S1                                            |
| Guild ↔ Character reference                               | Satellite imports core types directly (`use aresrpg::character::Character`) — kolizeum.move:8 does exactly this; type identity stable across core upgrades                                                                                                     | S4                                            |
| Custody/authentication of the acting character            | Public core doors already exist: `character_link::level/flip_world` (kiosk+PersonalKioskCap idiom), `core_fight::combat_snapshot` (fight.move:274, public, used by kolizeum.move:277)                                                                          | in-repo                                       |
| Guild wars                                                | Engine `fight::create_pvp<W: drop>` / `join<W>` are OPEN-GENERIC over any witness (engine fight.move:112,224,298); brand-scoped latch isolates consumers (fight_registry.move:41); claims stay brand-gated core-side, so a foreign brand can't mint core value | in-repo; KolizeumBrand precedent              |
| Guild-perk hooks in core (xp share, guild-gated dungeons) | Core upgrade adds brand doors + DF-based `guild_brand` pin later (new fns + new DF key struct + body-only changes) — the forge/gifting/dungeon `*_brand` twins are the template (config.move:265-322, character_link.move:193,289,373)                         | S1 + brand-twin precedent                     |
| On-character guild marker / delete-guard                  | Core upgrade: brand-gated character-DF door + `character_extract::delete_character` BODY change (S1: implementations may change)                                                                                                                               | S1                                            |
| Registry for a module added by upgrade (no init)          | Cap-gated ceremony fn shares the object post-upgrade — the header.move re-add (header.move:13 "re-added as an upgrade-compatible new module") proves upgrade-added modules work; social v2's pin ceremony proves post-publish shared-state wiring              | S1/S3 + precedent                             |
| Display/TransferPolicy for guild types                    | Satellite's own OTW → Publisher at publish                                                                                                                                                                                                                     | S8 (S10 fallback not needed)                  |
| Fight-team size for wars                                  | `per_side` is a value, not layout; board geometry is upgradeable foundation/engine math (current HARD bound 6, config.move:85)                                                                                                                                 | S1                                            |

### C. Conditional anchors — ONLY if maintainers freeze core at mainnet (recommended: DO NOT)

If `make_immutable(core)` were on the table, ALL of the following would become day-one
mandatory, because no upgrade could ever add them (S7 kills S1): `guild_brand` pin +
`assert_guild_brand` on GameConfig; a brand-gated `character_uid_mut`-class DF door (D319);
`DOMAIN_GUILD` bit + accessor; guild-perk brand twins on every value path guilds might touch
(xp, mint, heal); a reserved `NS_CHARACTER_GUILD` namespace in extension.move. Estimated ~120
LoC of speculative, untestable-until-used surface — the exact "design the future blind" trap
D319 documents. The correct resolution is A1, not pre-building C.

### D. Cheap riders — optional, NOT required

`DOMAIN_GUILD` constant (~3 LoC) or a `guild_brand` DF pin could ride the mainnet publish for
tidiness. Recommendation: **don't.** They are upgrade-addable (S1), they'd ship dead code into
the permanent v1, and the guild core-upgrade that needs them will exist anyway. Zero guild LoC
in the mainnet publish is the clean answer.

---

## ② GUILD DESIGN SKETCH — `aresrpg_guild`, a post-mainnet satellite

Shape: the kolizeum idiom (imports core directly), the friends idiom (derived-object registry),
the party idiom (custody-proof membership), plus its OWN `version.move`/`admin.move` copied from
social — kolizeum gates only on core's Version, which means kolizeum cannot retire ITS OWN stale
code independently of a core bump; a money-bearing guild package must be able to (S6), so it
ships its own single-path gate. FP constitution throughout: no caps-as-objects for roles, pure
data, one home per fact, events past-tense, `snake_case`.

### Objects

```
GuildRegistry has key (shared, init-created at satellite publish)
  id: UID                      // parent for name-derived Guild UIDs (creation.move idiom)
  member_of: Table<ID, ID>     // character -> guild — THE one-guild-per-character latch
  guild_count: u64
  max_members: u64             // admin dial, clamped (e.g. 10..500)
  creation_price: u64          // admin dial, MIST -> @treasury (anti-name-squat economics)

Guild has key (shared, one per guild)
  id: UID                      // = derived_object::claim(registry.id, "<name>::guild")
  name: String                 // normalized: ASCII, lowercase, 4..19, no whitespace/control
                               // (byte-for-byte the creation.move:214-219 rules — reuse, don't re-derive)
  emblem: Emblem               // { shape: u16, bg: u32, fg: u32 } — validated constructor, party of
                               //   Customization's 24-bit color law (character.move:55)
  leader: ID                   // character id; always present in members
  members: Table<ID, Member>   // character -> Member (Table: O(1), per-entry DF objects — roster
                               //   scale never bloats the shared object; vector would gas-scale reads)
  member_count: u64            // Table has no cheap length invariant vs cap — counted explicitly
  pending: vector<Invite>      // capped (e.g. 64) — bounds object growth (party.move leaves this
                               //   unbounded; fixed here)
  leader_seen_ms: u64          // liveness stamp for succession (see below)
  created_at_ms: u64

Member has copy, drop, store { character: ID, owner: address, rights: u16, joined_at_ms: u64 }
Invite has copy, drop, store { character: ID, owner: address, invited_at_ms: u64 }
```

No `store` on Guild (shared, never wrapped/transferred). No officer cap OBJECTS ever — rights
are u16 bits in the roster row, authenticated per call by character custody (party.move:236-249
`current_owner`: PersonalKioskCap ↔ kiosk id ↔ item presence ↔ typed borrow ↔ sender). A
transferable/storable officer cap would be a leakable authority (exploit class: cap leakage via
`store`); roster-stored rights are revocable by construction and die with the membership row.

Rights bits (1.29-shaped, append-only): INVITE=1, KICK=2, EDIT_EMBLEM=4, MANAGE_RIGHTS=8;
treasury bits reserved (SPEND=16, SET_CAP=32) for the treasury upgrade. Leader implicitly holds
all bits; MANAGE_RIGHTS can only grant/revoke bits the granter holds (no privilege escalation),
and never targets the leader.

### Doors (every one: `version.assert_enabled()` line 1; custody proof line 2; then invariants)

- `create(registry, kiosk, pkcap, character_id, raw_name, emblem, payment, clock, version, ctx)`
  — price split to `@treasury`, change refunded (creation.move:184-190 verbatim idiom);
  normalize name; `derived_object::claim(registry.id, name_key)` → duplicate aborts in claim
  (TOCTOU-proof, creation.move:21-24); registry latch: `member_of.add(character, guild_id)`
  (aborts if present = already in a guild); founder = leader, full rights. Emits `GuildCreated`.
- `invite / cancel_invite` — rights INVITE; pending-cap, not-already-member, not-already-invited
  asserts (party.move:102-106 guard set); invite records the TARGET; spam costs the inviter's gas.
- `accept` — invited character's custody proof; registry latch add (the one-guild invariant
  enforced HERE, atomically with the roster add — same tx, both or neither); roster add; count++.
- `decline` — target custody proof, drop invite.
- `leave` — custody proof; leader may leave only if not last member AND after `transfer_leadership`
  (simpler than party's auto-elect: explicit succession, no surprise leaders); registry latch
  remove + roster remove + count--.
- `kick` — rights KICK; hierarchy: kicker's rights must strictly contain target's (officers
  can't kick officers; nobody kicks the leader); works on GHOST members (deleted characters —
  kick needs no target custody), so deleted-character rows are always sweepable.
- `transfer_leadership` — leader custody proof → new leader must be a member; stamps `leader_seen_ms`.
- `claim_leadership` — succession for the vanished-leader case (character deleted or player
  gone; core cannot block deletion on guild office without a core door — design assumes members
  vanish): any member holding MANAGE_RIGHTS (else oldest member) claims IF
  `clock.timestamp_ms() - leader_seen_ms > succession_window` (admin-dialed, e.g. 30d).
  `leader_seen_ms` refreshes on every leader-authenticated door. Without this, one deleted
  leader-character permanently bricks a guild (the party husk failure mode, unacceptable with
  a future treasury attached).
- `disband` — leader, solo-roster only (party.move:198-215 idiom); registry latch removed;
  shared Guild deleted by value (kolizeum::sweep precedent). NOTE the derived name stays claimed
  forever (S9) — disband does NOT free the name; the UI says so, exactly like character deletion
  (character.move:28-30).
- `set_emblem`, `set_rights` — rights-gated; admin dials (`set_max_members`,
  `set_creation_price`, `set_succession_window`) AdminCap+clamped on the registry
  (placement-by-responsibility: the gate owns its dials, creation.move:263+ idiom).

### One home per fact

"Which guild is character X in" lives ONCE: `registry.member_of` (the latch). The roster row
carries role metadata only. Both mutate in the same four doors (create/accept/leave-or-kick/
disband) — atomic per tx, no reconciliation path exists. Guild LEVEL/xp/fame: pure indexer
projection over events (the chain holds no guild progression until an on-chain consumer exists
— YAGNI; revisit only when a perk must gate on it on-chain, which then rides the same core
upgrade as the perk itself).

### Treasury — designed now, SHIPPED LATER as `aresrpg_guild` v2 (recommendation)

V1 ships NO standing treasury: a guild without pooled money cannot be drained, and no v1
mechanic needs one (war wagers are per-event escrow, below). When a real sink exists:

- `treasury: Balance<SUI>` — added how? Guild struct layout is frozen at the satellite's OWN
  publish too (S2 applies to it the day it publishes). So the treasury is a DYNAMIC FIELD under
  the Guild UID (`TreasuryKey {} -> Balance<SUI>`), added by v2 code on first deposit — the
  PartyCharacterTypeKey trick, applied to money. This is the ONE place the guild package must
  pre-commit at ITS publish: nothing, actually — DFs need no reservation; v2 defines the key type.
- `deposit(guild, coin)` — any member, event `TreasuryDeposited { guild, character, amount }`.
  Deposits are DONATIONS (irrevocable) — no per-member claims ledger, no bank-run door.
- `spend(guild, amount, to, ...)` — rights SPEND + **per-epoch cap**: store
  `SpendState { epoch: u64, spent: u64, cap: u64, pending_cap: Option<u64> }`; epoch rollover
  resets `spent`; `assert!(spent + amount <= cap)`; cap RAISES apply next epoch
  (`pending_cap` — a compromised officer/leader session drains at most one epoch of cap, and
  the raise itself is a visible on-chain event a day before it bites); cap lowers apply
  instantly. Balance split → `public_transfer` coin, event on every movement. ~40 LoC.
- No flash-loan surface (no borrow door), no `Coin` stored (Balance only), fee math via
  `mul_div` bps (kolizeum.move:63 idiom), remainder-to-first on splits (kolizeum.move:346).

### Guild wars — later, zero new engine surface

`GuildWarBrand has drop` in the guild package; per-war escrow object shaped exactly like
`Kolizeum` (status machine OPEN→STARTED→SETTLED/CANCELLED, `pot: Balance<SUI>`, exact-pledge
join, refund-on-cancel/draw, platform cut bps → `@treasury`, `sweep` after settle —
kolizeum.move:306-370); combatants via public `core_fight::combat_snapshot`; fights via
`engine::create_pvp<GuildWarBrand>`; membership gate = both sides' rosters checked at seat
time. 6v6 today (engine placement bound, config.move:85); bigger formats are engine upgrades,
not guild blockers. War outcomes settle war escrow ONLY — no core xp/loot claims (those stay
core-brand-gated; S4 type identity + the brand echo in `FightOutcome` close the confusion).

### Interactions with existing systems

- **Parties**: orthogonal — a party is a 6-cap transient fight group (character-keyed), a guild
  is a persistent institution. No shared state, no coupling; the fight engine's `party_id` slot
  is untouched by guilds.
- **Kiosks**: guilds never hold player items (kiosk-lock constitution — items live in personal
  kiosks, period). Guild cosmetics, if itemized later, are admin-authored templates through the
  existing loot/shop economy — no new mint door needed; a guild-branded mint door
  (`mint_and_lock_output_brand` twin gated on a future `guild_brand` pin) only if guild-EXCLUSIVE
  item flows are wanted (core upgrade, §①B).
- **Chat**: `CHAT_GUILD` channel already stubbed frontend-side
  (packages/frontend/src/game/core/modules/chat.js:24); membership projection feeds it from events.
- **Sponsorship**: guild doors are normal SDK PTBs; creation is paid (self-pay > 0.2 SUI per
  the sponsorship money law) — no gas-station exposure.

Estimated build: ~600-800 LoC Move (guild.move + version.move + admin.move + events) + tests +
SDK/indexer/frontend. Comfortably a post-launch lane; nothing about it improves by existing at
mainnet T0 with zero players in guilds.

---

## ③ VULNERABILITY PASS (against the D321 22-class corpus + design specifics)

| Class                                                                                        | Exposure                                                                                                                                                                                                                                          | Closing decision                                                                                    |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Cap identity not validated (Pawtato)                                                         | No framework caps accepted anywhere; the only cap is the package's own AdminCap (epoch-scoped temp pattern, social/admin.move) for dials only                                                                                                     | Roles are roster data, not caps — nothing to mint/forge                                             |
| Cap leakage via `store`                                                                      | No role-cap objects exist                                                                                                                                                                                                                         | By construction (design §②)                                                                         |
| `entry` visible to PTBs regardless of Move visibility                                        | All doors `public fun` with line-1 gates; no naked `entry`                                                                                                                                                                                        | House law (composable-functions: never `public entry`) + audit grep                                 |
| Shared-object races: double-join, join-vs-kick, create-vs-create on one name                 | All membership mutations serialize on the Guild object; cross-guild uniqueness serializes on the registry latch; name races abort in `derived_object::claim` (TOCTOU-proof, creation.move:21-24)                                                  | Latch + claim; duplicate asserts give clean errors first (EAlreadyMember/EAlreadyInvited party set) |
| Name front-running (mempool sniping a guild name)                                            | Same exposure as character names — accepted: first-tx-wins, and the creation PRICE makes mass-squatting an economics problem, not a grief. Commit-reveal rejected (UX cost >> a game-name's value)                                                | Price dial + permanent claims (S9)                                                                  |
| Treasury drain                                                                               | v1: no treasury exists. v2: rights bit + per-epoch spend cap + next-epoch cap raises + events on every movement; deposits are donations (no run-on-the-bank claims door); Balance-only custody                                                    | Design §② treasury block                                                                            |
| Type confusion across package versions                                                       | Satellite imports core types by defining id (S4); war brand asserted via `with_defining_ids` echo in FightOutcome (kolizeum.move:312 idiom); no generic character type — direct `aresrpg::character::Character` import, so no pin to misconfigure | S4 + direct import                                                                                  |
| Foreign-brand fight forgery (public `new_combatant`, engine fight.move participant.move:159) | A rogue package CAN fabricate stat-inflated fights under its own brand — but core claims are core-brand-gated and guild-war settle asserts `GuildWarBrand`; fake fights touch neither core value nor guild pots                                   | Brand = trust boundary (existing architecture; guild adds nothing to the surface)                   |
| Join spam / invite spam                                                                      | Invites only from rights-holders (spam costs THEIR gas); pending capped; accept requires target custody                                                                                                                                           | Rights + cap                                                                                        |
| Kick wars                                                                                    | Rights hierarchy (strict containment), leader unkickable, MANAGE_RIGHTS cannot self-escalate                                                                                                                                                      | Design §② rights                                                                                    |
| Griefing: ghost members (deleted characters)                                                 | Kick works without target custody; succession window un-bricks a dead leader; disband requires solo roster                                                                                                                                        | claim_leadership + kick-by-id                                                                       |
| Dynamic-field DoS / object bloat                                                             | Roster is a Table (per-entry objects) bounded by `max_members` dial; pending vector capped; registry Table bounded by real players × 1                                                                                                            | Caps everywhere a vector/table grows                                                                |
| Arithmetic (Cetus shift class)                                                               | No `<<`/`>>` anywhere in the design; fee math `mul_div` bps; counts u64; checked add via abort-on-overflow default                                                                                                                                | Grep gate at PR time (D321)                                                                         |
| Hot-potato misuse                                                                            | None needed (guild is not an item; no LockPledge analog)                                                                                                                                                                                          | N/A                                                                                                 |
| OTW forgery                                                                                  | Standard satellite OTW at publish                                                                                                                                                                                                                 | Framework                                                                                           |
| UpgradeCap governance                                                                        | The guild package's own UpgradeCap joins the cold-custody set (A1)                                                                                                                                                                                | Ops law                                                                                             |
| Old-version live doors (S6)                                                                  | Own Version object + PACKAGE_VERSION + bump ceremony — v1 doors die at v2 bump (unlike kolizeum, which cannot self-retire; see §② rationale)                                                                                                      | Own version.move                                                                                    |
| Emergency stop                                                                               | Own `version.enabled` (dark-ship + kill) + core upgrade later adds DOMAIN_GUILD bit for the config-level family switch                                                                                                                            | Ships dark, enabled at guild launch                                                                 |

Residual risks flagged honestly: (1) mempool name-sniping remains possible for a targeted name
— accepted by decision, mitigable later with commit-reveal WITHOUT anchors (new doors, S1).
(2) A compromised leader session spends one epoch-cap of treasury — bounded by design, not zero.
(3) `claim_leadership` window is a taste dial; too short = coup grief, too long = brick — owner call.

---

## ④ SHIP-TIMING VERDICT

**Options**: (a) full guild build pre-mainnet · (b) anchors-now, build-later · (c) fully-later.

(a) costs 2-3 weeks of testnet time (no revenue there) building + QA'ing ~800 LoC of Move plus
SDK/indexer/frontend for a feature with zero launch-day users, and welds v1 guild mistakes into
the permanent lineage under launch pressure — maximum risk, negative revenue. (b) dissolves on
inspection: §① shows the required anchor set is exactly the architecture already shipped —
retained caps, gated doors, Version machinery; the "guild-specific anchors" (domain bit, brand
pin, perk doors) are all S1-addable in the same core upgrade that will carry the perks they
gate. (c) is (b) with zero speculative LoC.

**Recommendation: ship mainnet with ZERO guild code (option c), under three operational locks:
(1) UpgradeCaps for core/engine/social — and every future satellite — stay unrestricted in cold
custody, `make_immutable` is off the table permanently (A1); (2) the pre-publish audit asserts
every public door carries `&Version` (+`&GameConfig` on value paths) — the one property that
can never be retrofitted (A2/S2); (3) guilds are committed to the roadmap as a post-launch
satellite (`aresrpg_guild` v1: identity + membership + roles, ~a week including QA), with
treasury and wars as its own v2/v3 upgrades once players exist to want them.** This converts
the guild feature from a mainnet-blocking risk into ordinary post-revenue iteration, which is
exactly what the satellite architecture was built to do — kolizeum, forge, gifting and dungeon
already walked this road on the live testnet lineage.

---

## ⑤ OPEN QUESTIONS — maintainer taste/economy calls (none block the mainnet publish)

1. **Guild creation price** — flat SUI to `@treasury` (character-parity 10 SUI? higher as a
   founding act — 50/100?). Sets the name-squat economics.
2. **Member cap** — dial default (donor-era feel ~50-240; engine wars are 6v6 regardless).
3. **One guild per character** (assumed YES — donor-era rule) vs per WALLET (alts in different
   guilds allowed? character-keyed design says yes, alts may split).
4. **Rename policy** — v1 none (names permanent, S9 makes freed names unrecoverable anyway).
   Ever want a paid rename (new claim, old name burned forever)?
5. **Treasury: v1 or v2?** Dossier says v2 (YAGNI). If v1: per-epoch cap default, and who holds
   SPEND at creation (leader only?).
6. **Succession window** — 14/30/60 days of leader silence before `claim_leadership` opens.
7. **War wager economics** — platform cut bps on guild-war pots (kolizeum parity?), min/max
   pledge, who fronts (fighters vs treasury — treasury-fronted wars are the drain-surface
   multiplier; recommend fighter-fronted first).
8. **Guild perks roadmap** — xp share / guild-gated content are ECONOMY design (SPEC §12
   territory) and each needs a core-upgrade brand door; sequence them only when guild adoption
   is real.
9. **Emblem space** — shape/color ranges, moderation stance (emblems are u16/u32 data, no
   free-text beyond the name).

---

## Appendix — micro-findings encountered (scope-fenced: noted, not fixed)

- `config.move` uses deprecated `type_name::get` for brand pins (party/version.move already
  uses `with_defining_ids`; same defining-id semantics per std docs — no behavior bug; migrate
  on next core-upgrade touch).
- `party.move` `pending` invite vector is unbounded (self-grief object growth only; guild
  design caps its own).
- Core `Move.toml` social-dependency comment says "core reads FriendList (kolizeum allowlist)" —
  stale since the kolizeum split (kolizeum imports social directly now).
- Kolizeum has no package-own Version gate — its stale versions can only be retired by a CORE
  bump; fine for kolizeum today, but the pattern must NOT be copied into a treasury-bearing
  guild package (dossier §② adopts social's own-Version pattern instead).

Sources: [Upgrading Packages — docs.sui.io](https://docs.sui.io/develop/publish-upgrade-packages/upgrade) ·
[std::type_name — docs.sui.io](https://docs.sui.io/references/framework/sui_std/type_name) ·
[Custom Upgrade Policies — docs.sui.io](https://docs.sui.io/concepts/sui-move-concepts/packages/custom-policies) ·
in-repo citations by file:line throughout (clone: edge @ 2026-07-22).
