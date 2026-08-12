# PENDING DECISIONS — seed corpus

Owner decisions the migration parked. One line each. Rows marked RED are the validator's failing
checks: `bun seed/validate.mjs` exits non-zero until they are answered, and each red names its row
here. Rows marked WARN report but never fail the gate. Nothing below is a bug to fix by guessing —
each is a call only the owner makes.

## RED — the gate fails on these

- **PD-1 · dungeon room difficulty (review H6).** 136 dungeon room seats across 20 worlds carry
  `level_scalar: 0`. The legacy corpus authored bare slug arrays; `world::RoomMob` needs a 0..100
  scalar per seat. ~136 fresh balance numbers, owner work. Validator rule `H6-SCALAR`.
- **PD-2 · the recall potion does not exist (review H3).** Zero legacy rows carry
  `TELEPORT_TO_CENTER`, so sealed consumable kind 3 has no template — `consumable.move` implements
  a live door with nothing that can create its item, and the ROOTED law reasons about a recall
  potion that cannot be minted. Author at least one, or cut the kind. Validator rule
  `H3-CONSUMABLE`.
- **PD-3 · pets are unfeedable (review H4).** 71 `pet` templates ship and zero `pet_food` ones do;
  `pet::feed_kiosk_pet` asserts the burned stack's category is `pet_food`. Author at least one food
  template. Separately, the pets' only legacy obtention door was the gacha box, whose kind did not
  survive the sealed four — pets need a shop sale or a loot row too. Validator rule `H4-PETFOOD`.
- **PD-4 · RESOLVED (owner 2026-08-12).** `iyashi` IS the class — the chain said `tsuba` by
  mistake and was corrected (`character.move`, `weapon.move`). `yogen → yogan` was a corpus typo.
  All 12 classes ship 20 spells.

## WARN — reported, not blocking

- **PD-5 · mob damage was never re-baked (review H5).** Old mob damage scaled off `str`/`int`/
  `chance`, which are now dead — `MobTemplate` has no such fields, and a mob's damage IS its
  authored base. The migration carries every mob spell effect value VERBATIM, which silently nerfs
  every mob by whatever its characteristic multiplier was. The owner must echo the re-bake formula
  before the seeding. Proposed: `value × (100 + old_stat) / 100` per element line.
- **PD-6 · mob `wisdom` has no source.** `MobTemplate.wisdom` is the required dodge stat
  (owner 2026-08-10); the legacy corpus has no such key on any of the 383 mobs. All ship 0 — a
  0-wisdom mob dodges nothing. Validator rule `H5-WISDOM`.
- **PD-7 · RESOLVED (owner 2026-08-12).** Negative effects exist: `weaken_stat` (25) and
  `weaken_resist` (26) landed and every legacy debuff row is restored. A collapse of the
  add/remove/steal kind family into three channelled kinds is proposed and awaits the owner's go.
- **PD-8 · 33 loot-bag consumables have no kind (review H3).** `RANDOM_ITEMS` bags survive as
  templates with NO authored effect — `item::consumable_of` aborts if one is ever used, and 33 mob
  loot rows drop them. Drop them, convert them to plain resource stacks, or author a new kind.
  Validator rule `H3-EFFECTLESS` (36 rows, the 33 bags plus the 3 gacha boxes).
- **PD-9 · bosses still roam (review H6).** 115 dungeon room seats also appear in their world's
  spawn weights, against `world.move:58` ("bosses never roam"). Removing them from the spawn tables
  is content surgery, so `role` is kept on every mob row purely so this rule stays checkable.
  Validator rule `H6-ROAM`.
- **PD-10 · the golden-gather jackpot draws nothing (review M7).** All 46 resource rows carry an
  empty `rare_item_type`: the legacy corpus lists rare slugs globally but never paired them to a
  resource, and the migration invents nothing. Validator rule `M7-RARE`.
- **PD-11 · 43 milling recipes gate on a GATHERING job.** The legacy corpus authors `farmer`,
  `herbalist` and `miner` as the craft job of the flour/powder recipes; `crafting.move:78` says the
  authored job is one of the TWELVE craft slugs. Those recipes are quarantined. Either the job set
  widens to the 15-job law (the 3 tool slugs are real job slugs — `gathering.move:132` banks xp
  under them) or the recipes move to ALCHEMIST/BAKER.
- **PD-12 · the crit quotation is a proposed reading.** `remap.json` reads the legacy `crit_rate`
  (class) and `crit` (mob) as PERCENTS and converts to `crit_1_in = max(2, round(100 / pct))`, 0
  staying 0. If either number was already a quotation, every crit rate in the game inverts. The
  floor of 2 exists because `spell_effect.move:124` forbids 1, so a legacy 90% rate cannot be
  quoted faithfully.
- **PD-13 · 4 legacy rune slugs are not in the catalog.** `rune_ba_mon`, `rune_ba_pod`,
  `rune_ba_soi`, `rune_ba_sta` have no `(stat, tier)` in `rune_catalog`, so `rune_of` would abort on
  them. They are quarantined rather than shipped un-scribable.
- **PD-14 · airdrops and giftcards have shapes and no rows.** The legacy `airdrop.json` carries a
  pending pool with no whitelist and no giftcard was ever authored, so both arrays ship empty. A
  giftcard also needs a custody address per card — the seeding must route the minted object
  somewhere (`seed::new_giftcard` RETURNS it).

- **PD-15 · RESOLVED (owner 2026-08-12).** The reaction kind landed (the true Sacrier feel,
  owner-picked): a stance row — each real hit taken pushes an add row of its channel. The 4
  Tolls are authored on it; zero dead spells remain.
- **PD-16 · RESOLVED (owner 2026-08-12).** Channels landed: 8 power (never "percent" — a flat
  addition to all four primaries), 9 raw_damage, 10 critical (one name everywhere). All buff rows
  restored; power spells hold 1.29 parity values; vitality buffs re-authored as reduce_damage;
  mp_dodge rows became agility.
