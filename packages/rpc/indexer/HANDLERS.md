# AresRPG handler map (chain events → Redis read-model → `/v1/*` views)

The `ares` event-projection pipeline. `src/handlers/ares/project.rs::map` is a **pure**
function: BCS-decode one event body, return idempotent Redis writes (`JSON.SET` / `SADD` /
`SREM` / `JSON.DEL`, plus two documented `NUMINCRBY` relative counters), **never read Redis**.
That is what makes it unit-testable offline (`tests.rs`) and the whole store a re-derivable
cache of public chain truth (replaying the same checkpoints yields the same state).

**Two more pipelines share this store, each with its own watermark** (the framework's
"add a projection later" seam): `checkpoints` (liveness → `/v1/status`) and **`ares_snapshot`**
(`snapshot.rs`) — the S-15c slice that OBJECT-SNAPSHOTS Character cosmetics and EVENT-projects
the forgemagie taux economy. It is separate precisely so it backfills from `FIRST_CHECKPOINT`
independently of `ares` (whose watermark is already at the tip). See "Object snapshots + taux"
below. **Allowlist note:** `ares_snapshot` matches by `(module, name)` + the same `ARES_PACKAGES`
allowlist, which MUST include upgrade-latest addresses — `character::Character` keeps the original
package address but `forgemagie` (added in an upgrade) resolves to the upgraded one; omit it and
taux is silently dropped.

The key shapes below are the **cross-language CONTRACT**: the Rust key builders
(`project.rs`) and the Bun views (`api/views.js` `K`) mirror each other by hand — there is no
shared constant across the two runtimes, so this file is the single source of truth for the
schema. **Money (MIST) is stored as strings** (survive JSON's 2⁵³); counts, coordinates,
levels, seats and rooms are JSON numbers. IDs/addresses are canonical `0x…` hex
(`to_canonical_string(true)` / `to_string()`).

## Modules → domains

| Move source | Module(s) | Domain / view |
| --- | --- | --- |
| `aresrpg_pools::pool` | `pool` | `/v1/pools` |
| `aresrpg_items::shop` | `shop` | `/v1/shop` |
| `aresrpg_items::creation` | `creation` | character mint + `/v1/config` creation block |
| `aresrpg_items::character` | `character` | `/v1/characters` (mint + anchor) |
| `aresrpg_items::item` | `item` | `/v1/encyclopedia` templates + listing-enrichment item docs |
| `aresrpg_items::extract` | `extract` | `/v1/characters` equipment |
| `aresrpg_items::scribe` | `scribe` | item level (listing filter join) |
| `aresrpg_game::world` / `zones` / `config` | `world`,`zones`,`config` | `/v1/zones`, `/v1/encyclopedia`, `/v1/config` |
| `aresrpg::dungeon_events` | `dungeon_events` | `/v1/dungeon-runs` |
| `aresrpg_kolizeum::kolizeum_events` | `kolizeum_events` | `/v1/kolizeum` |
| `aresrpg_fight::fight_events` | `fight_events` | `/v1/fights`, `/v1/fight-results` (mint) |
| `aresrpg::results` | `results` | `/v1/fight-results` (open/burn — the core claim door) |
| `0x2::kiosk` (native) | `kiosk` | `/v1/listings` (items **and** characters) |
| `aresrpg::character` **object** | `character` | `/v1/characters` colours/male/level/experience (`ares_snapshot`) |
| `0x2::dynamic_field::Field` **object** (kiosk DOF wrapper) | `dynamic_field` | `/v1/characters` `kiosk_id` — generic kiosk discovery (`ares_snapshot`; allowlist-exempt) |
| `aresrpg_fight::settlement::FightOutcome` **object** | `settlement` | `/v1/pending-outcomes` (`ares_snapshot`; object create/delete) |
| `aresrpg_game::zones::Zone` **DF object** (World UID) | `dynamic_field::Field<zones::ZoneKey>` | `/v1/zones?world=&zone=` live spawn roster (`ares_snapshot`; allowlist-exempt DF hop) |
| `aresrpg_game::zones::ZoneGroupCommitment` **DF object** (World UID) | `dynamic_field::Field<zones::ZoneGroupRootKey>` | `/v1/zones?world=&zone=` `group_root`/`group_count` — the fight-create diet's claim-witness ingredient (`ares_snapshot`) |
| `aresrpg::loot_box::PetBoxClaim` **object** | `loot_box` | `/v1/pet-claims` (`ares_snapshot`; object create/delete) |
| `aresrpg::forgemagie` events | `forgemagie` | `/v1/taux` (`ares_snapshot`) |

**Module-name note.** The single-package merge renamed the old per-package `events` modules to
per-domain ones — `dungeon_events` (core), `kolizeum_events` (split into the `aresrpg_kolizeum`
package 2026-07-11) and `fight_events` (engine); the
result claim events (`ResultOpened`/`ResultBurned`) are emitted by core's `results` module. Every
arm is keyed by the exact `(module, name)` pair (keying a dead module name silently drops the
event — the 2026-07-10 P0). The game/items domains use per-feature module names (`pool`, `shop`,
`zones`, …).

---

## Characters — `/v1/characters?id=|ids=|owner=`

Doc `rpc:character:{id}`, owner index `rpc:idx:char_owner:{owner}`. Every character-touching
event NX-inits the skeleton `{ id, equipment:{} }` so merges are order-independent.

```jsonc
{ "id":"0x…", "owner":"0x…",        // owner = creator/minter (tx sender) until kiosk-transfer indexing
  "name":"Aiden", "class":"sram",   // creation::CharacterCreated / character::CharacterMinted (+ snapshot)
  "male":true,                      // OBJECT SNAPSHOT (Display slug {class}_{male})
  "colors": { "color_1":16777215, "color_2":13935180, "color_3":9136404 }, // OBJECT SNAPSHOT (Customization)
  "experience":0, "level":1,        // OBJECT SNAPSHOT (base experience → level via the frozen curve)
  "current_hp":137, "hp_updated_ms":0, // DF SNAPSHOT (character_link::Progression — RAW hp + lazy-regen stamp; client owns §5.4)
  "gear_vitality":0,                // DF SNAPSHOT (equipment::EquipmentMap.gear.vitality — NET GEAR cache; alloc `vitality` is separate)
  "kiosk_id":"0x…",                 // OBJECT SNAPSHOT — the kiosk holding this (kiosk-locked §11) character
  "world":"0x…",                    // zones::WorldJoined
  "position": { "x":10, "z":20, "zone":"spawn", "at_ms":0 }, // character::PositionAnchored / WorldJoined
  "equipment": { "0x…item": { "template":"0x…", "amount":1 } } } // extract::ItemEquipped
```

| Event | Fields | Redis writes |
| --- | --- | --- |
| `creation::CharacterCreated` | character, name, class, price | char_init; `SET $.name/$.class/$.owner`(=sender); `SADD char_owner:{sender}` |
| `character::CharacterMinted` | character, class | char_init; `SET $.class/$.owner`; `SADD char_owner:{sender}` |
| `character::PositionAnchored` | character, pos_x, pos_z, zone, anchored_at_ms | char_init; `SET $.position` |
| `zones::WorldJoined` | world, character, x, z, first_join | char_init; `SET $.world`; `SET $.position {x,z}` |
| `extract::ItemEquipped` | character, item, template, amount | char_init; `SET $.equipment["{item}"] {template,amount}` |
| `extract::ItemUnequipped` | character, item, template, amount | `DEL $.equipment["{item}"]` |

**`male` / `colors` / `experience` / `level` come from the OBJECT SNAPSHOT** (`ares_snapshot`,
below), not events — the cosmetics (`male` + Customization colours) and base `experience` live
ONLY in the Character object's contents (no event carries them), which is why world-presence
rendering of OTHER players needs the snapshot (else they draw as default dolls). `level` is
derived from `experience` via the frozen 200-level curve (`xp_curve.rs`, a mechanical mirror of
`aresrpg_foundation::character_xp`) so the doc serves it directly (SPEC §14: a stored Display
field). They are `null` only until the snapshot pipeline has reached the character.

**`kiosk_id` comes from GENERIC kiosk discovery** (`ares_snapshot`, "Object snapshots" below), not
events. A kiosk-locked object's checkpoint owner is `ObjectOwner(<dynamic-object-field wrapper>)`,
and that wrapper's OWN owner is `ObjectOwner(<kiosk>)` — so the projection resolves the kiosk in a
single two-hop against a per-checkpoint `wrapper → kiosk` map (the wrapper and the child are both
output objects at mint/place/trade). It is `null` until the snapshot pipeline has reached a
checkpoint that placed/traded the character. The SAME mechanism serves any of our kiosk-locked
object types (items later) — see the object-snapshot note.

**Bulk-by-ids:** `?ids=0x…,0x…` (or single `?id=`) is the presence-rendering form — one
`JSON.MGET` over the doc keys. `?owner=` resolves the per-owner index first.

---

## Object snapshots + taux — the `ares_snapshot` pipeline (`snapshot.rs`, S-15c)

A separate sequential pipeline (own watermark) over each checkpoint's OUTPUT OBJECTS + a
narrow set of events. Two pure, offline-tested projections (`snapshot_tests.rs`):

**Character object snapshot** (`map_character_object`). For every `aresrpg::character::Character`
output object, BCS-decode `MoveObject::contents()` and merge the on-chain-ratified base fields into
`rpc:character:{id}` (latest-wins by checkpoint order, idempotent `JSON.SET`). The struct mirrors
the on-chain layout byte-for-byte (a Move `UID` = a bare 32-byte ObjectID; verified against a live
94-byte testnet object): `id, name, class, male, customization{color_1,2,3}, experience,
created_at_ms, anchor{…}`. Only the object-authoritative fields are written — `$.name`, `$.class`,
`$.male`, `$.colors`, `$.experience`, `$.level` (derived) — plus the NX skeleton so a snapshot
before the mint event still has a doc. `owner`/`world`/`position`/`equipment` stay event-sourced
(not in the object, or richer via events).

**Character DYNAMIC-FIELD snapshots** (Phase-1 `dynamic_field::Field` loop, `map_job_xp_field` /
`map_progression_field` / `map_gear_vitality`). Some live character state lives ONLY in first-party
DFs attached DIRECTLY to the Character UID (via `extension::add_character_field` → `df::add`), so each
Field's checkpoint owner IS the character. `process()` reads them off the SAME per-checkpoint
`dynamic_field::Field` output objects it builds the kiosk map from, discriminated by the Field's KEY
TYPE parameter (never the byte-identical bodies) and merged latest-wins onto `rpc:character:{id}`:
- **job-xp** (`Field<NsKey<character_link::JobXpKey>, u64>`, `is_job_xp_key`) → `$.jobs["<job u8>"]`,
  the ABSOLUTE running total (see Characters above).
- **progression** (`Field<NsKey<character_link::ProgressionKey>, Progression>`, `is_progression_key`) →
  `$.current_hp` + `$.hp_updated_ms`. Full `bcs::from_bytes` of `{id, namespace, xp, level, hp,
  hp_updated_ms}` (59 bytes, `Progression` terminates the Field). The RAW stored hp + the lazy-regen
  last-touch stamp are served VERBATIM — the client owns the §5.4 natural-regen projection; the indexer
  NEVER recomputes regen (`xp`/`level` are decoded but not projected — they ride the base-object
  `experience` snapshot).
- **equipment vitality** (`Field<NsKey<equipment::EquipmentKey>, EquipmentMap>`, `is_equipment_key`) →
  `$.gear_vitality`, the NET GEAR cache. CURSOR-parsed past the variable `singles`/`relic_templates`
  prefix to the 22nd (last) `spell::Stats` u64 (`equipment_gear_vitality`), robust to the LIVE
  `Stats`/`EquipmentMap` growing. This is the equipped-gear vitality sum the client ADDS to the
  ALLOCATED `vitality` to derive `character_max_hp` via `progression_math::max_hp_from_base` (base_hp[class]
  + (level−1)×HP_PER_LEVEL + (alloc + gear) vitality — added 1:1); it is NOT the sibling equipped-ITEM DFs
  (same namespace, keyed by item id). All three are `null` until the snapshot pipeline reaches the character's
  DF (a full `ares_snapshot` re-index backfills from `FIRST_CHECKPOINT`).

The SAME Phase-1 loop also snapshots the **zone spawn roster** (`map_zone_field`) — a first-party DF whose
parent is the **WORLD**, not a character (`Field<zones::ZoneKey, Zone>`, `is_zone_key` — a PLAIN struct key,
NOT `NsKey`-wrapped, so the Field's checkpoint owner IS the World). It carries the live mob-group/resource-node
roster and re-emits on every search/claim/gather that mutates the zone — projected onto `rpc:zone:{world}:{zx}:{zy}`
(see "Zones" below). Its sibling **zone group commitment** (`map_group_root_field`,
`Field<zones::ZoneGroupRootKey, ZoneGroupCommitment>`, `is_group_root_key` — same module, same World parent)
merges the fight-create diet's search-committed Blake2b mob-group root + count onto that SAME zone doc.

**Encyclopedia template snapshots** (`map_item_template_object` / `map_mob_template_object`). The
§14 encyclopedia needs each minted blueprint's display fields, but the mint EVENTS carry only ids
(`item::TemplateCreated {template, item_type}`, and mobs have no event arm) — name/level and the
mob's level-range/hp/element live ONLY in the object contents, exactly like the Character cosmetics.
So both are OBJECT-snapshotted here:
- **`aresrpg::item::ItemTemplate`** → its encyclopedia doc `rpc:template:{id}` (the SAME doc/index
  the `TemplateCreated` event arm writes; they converge idempotently). Full `bcs::from_bytes` decode
  of `{id, name, item_type, category, level}` (all scalars — no trailing bytes). Per-item STAT lines
  are `item_stats` **dynamic fields**, NOT the template's own contents, so they are not snapshotted
  (no DF-indexing) — the encyclopedia serves identity + level only.
- **`aresrpg::mob_template::MobTemplate`** → `rpc:mob_template:{id}` (+ `idx:mob_templates`). The
  SCALAR PREFIX (`name, min_level, max_level, base_hp, element`) is HAND-PARSED (not
  `bcs::from_bytes`), then the walk SKIPS the trailing `stats` (22-u64 Stats) + `spells`
  (vector<SpellLevel>) and DECODES `loot` (vector<MobLootEntry> → `drops: [{template_id, chance_bp,
  min_qty, max_qty}]`; a short/foreign tail collapses to `drops: null` — honest-unknown — without
  regressing the prefix). `element` is the raw `spell` discriminant (0=fire,1=water,2=earth,3=air,
  255=none); the client maps it to a name. Mob resistances / spell kit are deliberately NOT
  projected (the honest §14 gap); the `/v1/encyclopedia` view joins each drop row's item name +
  derives the exact chance% from `chance_bp`.
- **`aresrpg::crafting::Recipe`** → `rpc:recipe:{id}` (+ `idx:recipes`). Full `bcs::from_bytes`
  decode of `{id, inputs: [{template, quantity}], output_template, output_quantity, required_job,
  required_level, craft_xp}` — the §14 crafting truth (the `RecipeCreated` EVENT carries only
  counts; the shared object is immutable after `create_recipe`, so create-only, no delete arm).
  Served by `/v1/encyclopedia?kind=recipes` with raw template ids (the client joins names off the
  same view's items list — never a server-fabricated display value).

**Generic kiosk discovery** (`resolve_kiosk` + the Phase-1 wrapper map). The design goal: *"the
indexer should discover a kiosk at character/item creation so we always know them — ONE generic
mechanism."* Every AresRPG character (and item, §11) is kiosk-locked, and a kiosk item is a native
`0x2::kiosk` dynamic-OBJECT-field of the kiosk. So a kiosk-locked object's checkpoint owner is
`ObjectOwner(<0x2::dynamic_field::Field wrapper>)`, and that wrapper's OWN owner is
`ObjectOwner(<kiosk>)` (empirically verified on testnet: character `0x5972…fae75` → wrapper
`0xbb0b…0afa` → kiosk `0x6b1f…eb62`). `process()` therefore builds a per-checkpoint `wrapper → kiosk`
map from every `dynamic_field::Field` OUTPUT object (this `0x2` framework type is EXEMPT from the
`ARES_PACKAGES` allowlist, like the event pipeline admits native kiosk), then `resolve_kiosk` does
the two-hop for each of OUR objects. The wrapper and its child are both output objects exactly at
mint / place / trade (the only moments the binding is set or changes), so the edge is latest-wins and
self-maintaining across trades; between those it stays valid. Written as `$.kiosk_id` on the character
doc. The mechanism is TYPE-GENERIC — items reuse `resolve_kiosk` in a future kiosk-inventory slice
(their `rpc:item:{id}` docs already exist); no item projection is built here (nothing consumes it yet).

**Pending FightOutcomes** (`map_fight_outcome_object` + `remove_pending_outcome`). The engine's
soulbound `aresrpg_fight::settlement::FightOutcome` is minted (address-owned) at `settle_and_destroy`
and DELETED by `results::open` — and NO event links the outcome id to the later core FightResult id
(the deliberate gap the fight-results view documents). So the still-openable set is projected from
CHECKPOINT OBJECT create/delete, keyed by the seat's owner: on the object's create (an output object,
`AddressOwner`) ADD, on its delete (`effects.deleted()` ∩ the tx's input objects — the owning address rides
the pre-delete input state) REMOVE. Self-cleaning by construction (the delete is exact — no monotonic
wart). Full BCS decode of the outcome (pinned byte-for-byte against a live 265-byte object) reaches
`pvp` past the variable `loot` vector. Doc `rpc:pending_outcome:{id}`, per-owner sorted set
`rpc:idx:pending_outcomes:{owner}` (score = checkpoint ts, capped to the newest 100 defensively).
NEVER a `NUMINCRBY` (replay double-count). See "Pending FightOutcomes" below.

**Taux (forgemagie) events.** The CrushBoard's taux/pressure rows are `Table` dynamic fields
(NOT in the object's own contents), and the module was designed so "coefficients must be derivable
from events alone" — so taux is EVENT-projected, not object-snapshotted. Doc `rpc:taux:{template}`,
index `rpc:idx:taux`, bracket pressure `rpc:taux:bracket:{bracket}`, board meta `rpc:taux_meta`.

| Event | Fields | Redis writes |
| --- | --- | --- |
| `forgemagie::BoardCreated` | board, neutral_milli, bracket_size | `SET rpc:taux_meta {neutral_milli,bracket_size}` |
| `forgemagie::Crushed` | receipt, template, items, total_weight, **coeff_after**, **bracket**, **pressure_after** | NX `rpc:taux:{template}`; `SET $.coeff_milli/$.bracket/$.snapshot`; `SADD idx:taux`; `SET rpc:taux:bracket:{bracket} {pressure_after}` |
| `forgemagie::RecipelessSet` | gear_template, recipe_less | NX `rpc:taux:{template}`; `SET $.recipe_less`; `SADD idx:taux` |

`RuneRegistered` and every other forgemagie event are deferred (not a taux view).

### Taux — `/v1/taux?template=|ids=`

Per-item-template crushing coefficients (milli-percent: 100% = 100000). `/v1/taux` lists every
TOUCHED template + board meta; `?template=<id>` / `?ids=<a,b>` resolve specific templates,
DEFAULTING to `neutral_milli` (100%) for any template never crushed (the R3 "every template starts
neutral" model). The view folds **bracket drift** at read time — crushing OTHER templates in a
level bracket inflates its peers, so `effective = stored_coeff + (bracket_pressure_now −
template_snapshot) × 3/5`, clamped to `[floor_milli, cap_milli]` = `[1000, 4_000_000]`, with the
recipe-less 50% cap. The sub-5-milli carry the on-chain `settle_pressure` keeps is omitted (a
<0.005% approximation; the constants mirror `aresrpg_foundation::taux`). Each row:
`{ template_id, coeff_milli, coeff_percent, recipe_less, source:"crushed"|"neutral" }`.

## Listings (marketplace) — `/v1/listings`

Native Sui kiosk feed. The phantom `T` in `0x2::kiosk::ItemListed<T>` is not in the BCS body,
so the arm decodes **any** kiosk list — items AND characters are both kiosk-locked (§11) and
flow through the same index. Category/level/name are joined at **read time** by the view:
an item listing resolves against `rpc:item:{id}` (category = `item_type`), a character listing
has no item doc so it resolves against `rpc:character:{id}` (category `"character"`, `name`,
and `level` once object-snapshot indexing lands). Seller = tx sender.

Doc `rpc:listing:{item}`, index `rpc:idx:listings`.

| Event | Fields | Redis writes |
| --- | --- | --- |
| `kiosk::ItemListed` | kiosk, id, price | `SET rpc:listing:{id} {item_id,kiosk,price_mist,seller=sender}`; `SADD idx:listings {id}`; `SADD idx:seller_kiosks:{sender} {kiosk}` |
| `kiosk::ItemPurchased` | kiosk, id, price | `DEL rpc:listing:{id}`; `SREM idx:listings {id}`; **+ discriminated sales-history writes (below)** |
| `kiosk::ItemDelisted` | kiosk, id | `DEL rpc:listing:{id}`; `SREM idx:listings {id}` |
| `item::ItemMinted` | item, template, item_type, amount | NX `rpc:item:{item} {id,level:null}`; `SET $.template/$.item_type`; **+ supply arm (below)** |
| `item::TemplateBurned`→`extract::ItemBurned` | item, template, amount | `DEL rpc:item:{item}`, `DEL rpc:listing:{item}`, `SREM idx:listings`; **+ supply arm (below)** |
| `scribe::Scribed` | item, level | NX `rpc:item:{item}`; `SET $.level` (feeds the level filter) |

---

## Item supply — `/v1/encyclopedia` items[].supply

Live on-chain supply per template — the SUM of `amount` (item.move's fungible-units field: always 1
for a unique-NFT category, N for a stackable) across every still-alive `Item`. `item.move` deliberately
holds no supply ledger of its own ("NO supply ledger... a supply cap is the sale gate's concern" — and
there is no package-wide cap either, since a future mob-loot/gather mint has no gate at all), so this
counter is the read-model's own derived truth, exact under the two events that change it:
`item::ItemMinted` (+amount — the ONLY mint door; `mint`/`mint_stack` both emit it) and
`extract::ItemBurned` (-amount — the ONLY burn door; pool sell, forgemagie crush, dungeon key consume,
and crafting ingredient consume all route through `extract::burn`, which always destroys the WHOLE item
object in one shot and reports its full `amount`). `ItemMerged`/`ItemSplit` (stack fold/split) are
supply-**neutral** by construction — units move between two objects, total conserved — so they stay
deliberately untracked, same "document the gap" stance as the deferred events below.

Doc `rpc:supply:{template}` = `{ template, amount }`, NX-seeded at the first mint or burn of that
template and bumped with `JSON.NUMINCRBY $.amount`. Like shop `minted`, this is a **relative** counter
(not idempotent on a replayed checkpoint) — the same accepted approximation class this module's header
documents; a fresh re-index (new `FIRST_CHECKPOINT`) re-derives it exactly. `/v1/encyclopedia`'s
`handle_encyclopedia` joins it onto each item row as `supply` (defaulting to `0` for a template never
minted — an honest zero, not the null "snapshot hasn't arrived yet" gap `name`/`level`/`category` use).

| Event | Fields | Redis writes |
| --- | --- | --- |
| `item::ItemMinted` | item, template, item_type, amount | NX `rpc:supply:{template} {template,amount:0}`; `NUMINCRBY $.amount +amount` |
| `extract::ItemBurned` | item, template, amount | NX `rpc:supply:{template} {template,amount:0}`; `NUMINCRBY $.amount -amount` |

---

## Last sale (marketcap) — `/v1/encyclopedia` items[].last_sale_mist

The template's newest realised PER-UNIT sale price, from every SUI-denominated sale venue —
marketcap = `supply × last_sale` (the CLIENT computes and formats it; the view serves the raw
string). Projected in the **`ares_snapshot`** pipeline (NOT the event pipeline): all three venues
land on ONE key from ONE sequential pipeline so checkpoint order is exact — split across the two
pipelines (each with its own watermark), a backfilling pipeline could overwrite a newer sale the
other already wrote.

- **shop** (primary market): `shop::SaleBought.price` is already per-unit (shop.move charges
  `price × quantity` and echoes `sale.price`).
- **pools** (AMM): `PoolBuy.sui_in / quantity` and `PoolSell.gross / quantity` (gross = pre-royalty
  market value), floored.
- **kiosk marketplace**: `0x2::kiosk::ItemPurchased { kiosk, id, price }` carries NO template — the
  purchased `Item` is ALWAYS an output object of the SAME tx (ownership changed), so `process()`
  resolves `template` + stack `amount` from a per-tx Item-output map (the `resolve_kiosk` idiom) and
  stores `price / amount`. **price == 0 is SKIPPED**: the extract seam runs a zero-price
  list+purchase for every equip / burn / crush / merge (extract.move `extract_locked`) — stamping it
  would zero every touched template's price constantly. A purchased CHARACTER has no Item output →
  absent from the map → correctly skipped. The arm is allowlist-exempt but address-PINNED to `0x2`.

Doc `rpc:lastsale:{template}` = `{ template, price_mist: "<string>", ts }` — a latest-wins `SET`
(idempotent on replay; MIST as string per the 2^53 money law). `/v1/encyclopedia` joins it as
`last_sale_mist` (string | **null** until the template's first sale ever — the client renders
"marketcap unknown", owner-specified).

| Event | Source | Redis writes |
| --- | --- | --- |
| `shop::SaleBought` | price (per-unit) | `SET rpc:lastsale:{template} {template,price_mist,ts}` |
| `pool::PoolBuy` / `PoolSell` | sui_in ∕ quantity, gross ∕ quantity | same latest-wins `SET` |
| `kiosk::ItemPurchased` (0x2, price>0) | price ∕ amount via same-tx Item output | same latest-wins `SET` |

---

## Sales history (marketplace, seller-side) — `/v1/sales-history?seller=`

A seller's REALISED sales — *"what we sold, when, at what price, to whom"* + 30d revenue. Same
native kiosk feed, but keyed by the SELLER instead of the item. **Event truth:** the native
`0x2::kiosk::ItemPurchased { kiosk, id, price }` carries the item, price and seller kiosk — but
the AresRPG extraction seam also emits it: `extract_locked` performs a same-transaction
`ItemListed(0)` → `ItemPurchased(0)` to equip/burn/reshape an owned item. Therefore the event alone
is not sale proof. The checkpoint handler correlates kiosk+item within the transaction:

- same-tx zero-price list+purchase with an item-id-matched `ItemEquipped`/`ItemBurned` terminal, or
  with no `royalty_rule::pay` call = internal exit; do **not** append history, and issue an exact
  `ZREM` for replay-healing legacy phantom rows;
- a positive-price purchase, a standalone zero-price `ItemPurchased`, or an atomic zero-price pair
  with the royalty receipt-producing `pay` call = realised sale. (`royalty_rule::pay` mutates the
  TransferRequest/policy but emits no event, so the successful Move call is the observable proof.)

For realised sales:

- **buyer** = the purchase event `sender` (self-pay marketplace buys — the buyer signs). For an
  extraction event this is likewise the wallet/signer, not a character or extension object.
- **when** = the enclosing checkpoint's `timestamp_ms` (no event carries its own time; threaded
  into `map` as `ts_ms`).
- **seller** = the kiosk owner. The purchase event lacks it, so the seller→kiosk edge is bound at
  **listing** time (`ItemListed.sender` = the lister = the seller; a personal kiosk is 1:1 with
  its owner) into `idx:seller_kiosks:{seller}`, which SURVIVES the purchase (the listing doc does
  not). The view resolves `?seller=` → kiosk(s) → the per-kiosk log.
- **item name/category/level** are joined at read time from `rpc:item:{id}` (like `/v1/listings`);
  a since-burned item resolves to `null` category.

Each realised sale is appended to the per-kiosk sorted set `rpc:sales_log:{kiosk}` (score = sale
`ts`, member = `{item, price_mist, buyer, ts}`). The member is **unique per item** (an item sells
once), so `ZADD` on a crash-replay is a no-op — the log is **idempotent** and needs no relative
`NUMINCRBY` on the money path (unlike shop `minted`), staying crash-replay safe like every other
write here (`store.rs`).

**Retention contract (storage-light law).** Two bounds, applied on every sale:

- **Cap** — `ZREMRANGEBYRANK` keeps only the newest **500** rows per kiosk (`SALES_CAP`). A whale/
  grief hard bound; 500 fully contains a 30d window for any realistic seller (>500 sales/30d =
  16+/day). Beyond that the oldest rows fall off and `revenue_30d` slightly under-counts — bump the
  cap (or add a daily rollup) if real whales appear.
- **Idle TTL** — `EXPIRE … 90d` (`SALES_TTL_SECS`), refreshed on every sale. A kiosk that stops
  selling for 90d self-evicts its WHOLE log; an active log persists. Matches the 30d revenue
  horizon with margin.

So a per-kiosk log is bounded (`≤500` rows) AND only exists for recently-active sellers — storage
tracks real activity, nothing is hoarded. `revenue_30d` is summed (BigInt) over the trailing 30d
from the SAME rows (an indexed sorted-set read of a capped set — not a scan) and returned as a
string; there is one home for the number (the rows), no rollup/row drift.

> **Design note (deviation from the briefed daily-rollup, declared).** The brief proposed a separate
> per-seller `{day: sum}` NUMINCRBY revenue rollup. That was dropped: a NUMINCRBY money counter is
> **not idempotent** (a crash-replay double-counts, `store.rs`'s invariant) and can't hold MIST as a
> string — permanent, un-reconcilable revenue drift, strictly worse than the tolerated `minted`/
> `mob_groups` counts (which an object-snapshot backstops; revenue has none). Since the detail feed
> already keeps bounded rows, deriving `revenue_30d` from them adds **zero** storage, is idempotent,
> and is a single source of truth — the rollup's premise (row scans are expensive) does not hold for
> an indexed range over a capped set. Net: lighter AND safer, which is the rider's actual goal.

Doc `rpc:sales_log:{kiosk}` (sorted set), index `rpc:idx:seller_kiosks:{seller}` (set).

| Event | Fields | Redis writes |
| --- | --- | --- |
| `kiosk::ItemListed` | kiosk, id, price | (listing writes above) + `SADD idx:seller_kiosks:{sender} {kiosk}` |
| genuine `kiosk::ItemPurchased` | kiosk, id, price | `ZADD sales_log:{kiosk} {ts} {item,price_mist,buyer=sender,ts}`; `ZREMRANGEBYRANK … 0 -(CAP+1)`; `EXPIRE … 90d` |
| transient extract `ItemPurchased(0)` | kiosk, id, price | exact `ZREM sales_log:{kiosk} {item,price_mist:"0",buyer=sender,ts}` (legacy-row replay heal) |

The `/v1/sales-history` view: `?seller=` (required) → each row `{ item_id, template_id, category,
level, price_mist, buyer, sold_at_ms }`, newest-first, `?limit=`/`?cursor=` paginated, plus
`revenue_30d_mist` (stable across pages — a window sum, not a page sum) and `total`.

**First-party SHOP sales** (`shop::SaleBought`, seller = `@treasury`) are a SEPARATE concept —
protocol primary-market revenue, not a player's marketplace sales — and are not folded into this
seller-keyed view (the shop's own `/v1/shop` serves it). They could feed a protocol-revenue view if
ever wanted.

---

## Pools / Shop / Encyclopedia / Config

Unchanged from the base slice — see the arms in `project.rs`:

- **`pool::{PoolCreated,PoolBuy,PoolSell,PoolPaused}`** → `rpc:pool:{id}` (+ `pool_by_template`,
  `idx:pools`). Buy/Sell carry **post-trade absolute** reserves → idempotent `SET`. The view
  computes `sui_reserve` and the marginal `spot_price`.
- **`shop::{SaleCreated,SaleBought,PriceChanged,WindowChanged,SalePaused}`** → `rpc:sale:{id}`
  (+ `idx:sales`). `SaleBought.amount` is the one **RELATIVE** `NUMINCRBY $.minted` (a delta),
  exact under object-snapshot of `Sale.minted`.
- **`item::{TemplateCreated,TemplateRenamed,TemplateBurned}`** → `rpc:template:{id}` (+
  `idx:templates`) for encyclopedia liveness. Create carries `template` + `item_type`; rename
  updates `$.name` in place on that same canonical document/index member. **description / category /
  level are added by the `ItemTemplate` OBJECT SNAPSHOT** — they live in the object contents, not
  the rename event (see "Object snapshots" below). **Mob templates** land via the `MobTemplate` object
  snapshot (`rpc:mob_template:{id}` + `idx:mob_templates`), NOT an event arm. **Spells are NOT
  indexed**: the client resolves minted SpellTemplates directly from the seed manifest
  (`fight-spells.json`), so §14 keys no spell-liveness view.
- **`config::{ConfigEnabledSet,DialChanged,ClassRowSet}`** → `rpc:config`.
- **`creation::{PriceChanged,PausedSet,ClassAdded,ClassRemoved,StarterSet,SponsorSet,FreeEnabledSet}`**
  → `rpc:creation`. **`SponsorSet`/`FreeEnabledSet`** surface `$.sponsor` (address or null,
  from `Option<address>`) and `$.free` (bool) so a create-character UI knows if creation is
  free and the publish ceremony can assert the sponsor over the RPC.

---

## Zones — `/v1/zones?world=` (+ `&zone=zx:zy` for derivation state)

`world::WorldCreated` → `rpc:world:{id}` (seed, biome; + `idx:worlds`). The per-zone doc
`rpc:zone:{world}:{zx}:{zy}` (+ `idx:zones:{world}`) is projected by BOTH the `zones::ZoneSearched`
EVENT arm (discovery + search-time counts) AND the **Zone-DF OBJECT SNAPSHOT** (`ares_snapshot`,
`map_zone_field`) — converging on the SAME doc via the NX-skeleton + per-field pattern (like the
ItemTemplate doc): the event NEVER `$`-replaces (it would wipe snapshot state), and the snapshot
adds `$.seed` + `$.mob_bitmap`/`$.res_bitmap`. The API subtracts consumed-bitmap popcounts from
the event totals for live counts. Only discovered zones exist as data (§17.18).

Two view forms:
- `?world=` → the discovered-zone LIST (counts only) — the compass / discovery overview.
- `?world=&zone=zx:zy` → ONE zone WITH its raw derivation state (`seed`, `mob_bitmap`,
  `res_bitmap`) plus the fight-create diet's **group commitment** (`group_root`, `group_count`).
  The frontend's `zone_rows` composer derives the exact live spawn rows from this state and the
  World tables; the SDK's `compose_mob_group_proof` composes the ≤6-level claim WITNESS from the
  FULL (empty-bitmap) stream + the commitment, failing shut to the original claim door on any
  mismatch. An undiscovered zone → empty `zones` array (the honest "unsearched" signal).

```jsonc
{ "world":"0x…", "zx":7, "zy":9, "discovered":true, "discovered_at_ms":170…,
  "mob_groups":1, "resource_nodes":1,
  "seed":"18446744073709551615", "mob_bitmap":[5], "res_bitmap":[1],
  "group_root":[238, /* …32 bytes… */], "group_count":3 }
```

| Event / object | Fields | Redis writes |
| --- | --- | --- |
| `zones::ZoneSearched` | world, zx, zy, at_ms, mob_groups, resource_nodes | NX skeleton `{world,zx,zy,discovered:true}`; `SET $.discovered_at_ms/$.mob_groups/$.resource_nodes`; `SADD idx:zones:{world}` |
| `zones::Zone` **DF object** | id, zx, zy, discovered_at_ms, seed, mob_bitmap, res_bitmap | NX skeleton; `SET $.discovered_at_ms/$.seed/$.mob_bitmap/$.res_bitmap`; `SADD idx:zones:{world}` |
| `zones::ZoneGroupCommitment` **DF object** (`Field<zones::ZoneGroupRootKey,…>`, World UID — `map_group_root_field`) | id, zx, zy, root, count | NX skeleton; `SET $.group_root/$.group_count`; `SADD idx:zones:{world}` |

`seed` is served as a STRING (a full random u64 > 2⁵³). `discovered_at_ms` is served RAW
(lazy-accrual law — the client owns the §17.1 TTL math; the indexer never pre-computes it).
`group_root` is the 32-byte Blake2b-256 duplicate-last Merkle root `zones::search_zone` commits over
the FULL derived mob-group stream (fight-create compute diet: claims verify a witness against it via
`claim_mob_group_*_with_proof` instead of re-deriving — 577.8M → 7.32M MIST computation at G=64);
`group_count` is that stream's size, INDEPENDENT of consumption. Search (re)upserts the commitment in
the SAME tx that rolls the zone state, so both snapshot arms re-emit together and the doc stays
intra-coherent; a pre-diet zone never gets the fields → the view serves nulls → clients keep the old
door (the composer's fail-shut covers every partial/lagged shape).

`MobGroupClaimed`, `gathering::ResourceGathered`/`ProtectorTriggered` stay **deferred as EVENT arms**:
a claim/gather carries world coords `(x,z)` + `spawn_id` but **not** the zone grid `(zx,zy)`, so the
EVENT cannot target a zone doc. Live depletion comes from the mutated Zone DF's consumed bitmaps,
which re-emit on every search/claim/gather.

---

## Dungeon runs — `/v1/dungeon-runs?owner=|pass=`

The bound `RunPass` timeline (`aresrpg::dungeon_events`). Serves a player's **ACTIVE** runs
(the resume set, §9). Doc `rpc:run:{pass}`, owner index `rpc:idx:runs:{owner}`.

```jsonc
{ "pass":"0x…", "world":"0x…", "player":"0x…",
  "status":"active", "room":<u16, 1-based>, "fight":"0x…"|null }
```

| Event | Fields | Redis writes |
| --- | --- | --- |
| `RunActivated` | pass, world, player | `SET rpc:run:{pass}` (`status:"active"`, `room:1`, `fight:null`); `SADD idx:runs:{player}` |
| `PassEnteredFight` | pass, fight, world, player, room | NX skeleton; `SET $.fight {fight}`; `SET $.room {room}` |
| `RunAdvanced` | pass, world, player, room | NX skeleton; `SET $.room {room}`; `SET $.fight null` (the room's fight settled) |
| `RunEnded` | pass, world, player, reason, return_x, return_z | `DEL rpc:run:{pass}`; `SREM idx:runs:{player}` |

The pass is **consumed** (on-chain object DELETED) on any end — abandon / defeat / completion
(`run::consume`). Because `RunEnded` carries `player`, the per-owner index is cleaned **exactly**:
no dangling ids, unlike the fight/result terminals below. A returned run is therefore always
live. `PassEnteredFight` links the run to its room's `aresrpg_fight::Fight` (the edge the RPC
groups a dungeon's live fights through, §9); `RunAdvanced` clears it (the fight is done).

---

## Kolizeum — `/v1/kolizeum?id=|status=`

Lobby lifecycle (`aresrpg_kolizeum::kolizeum_events`). Doc `rpc:kolizeum:{id}`, index `rpc:idx:kolizeums`.

| Event | Fields | Redis writes |
| --- | --- | --- |
| `KolizeumCreated` | kolizeum, creator, format_slots, pledge_amount, is_public | `SET rpc:kolizeum:{id}` (`status:"open"`, `pledge_mist`); `SADD idx:kolizeums` |
| `KolizeumStarted` | kolizeum, side_a, side_b | `SET $.status "started"/$.side_a/$.side_b` |
| `KolizeumSettled` | kolizeum, winning_side, pot, winners | `SET $.status "settled"/$.winning_side/$.pot_mist/$.winners` |
| `KolizeumCancelled` | kolizeum, refunded_total | `SET $.status "cancelled"/$.refunded_mist` |
| `KolizeumDrawn` | kolizeum, refunded_total | `SET $.status "drawn"/$.refunded_mist` (mutual-wipe draw §17.9 — a distinct terminal) |
| `KolizeumSwept` | kolizeum | `DEL rpc:kolizeum:{id}`; `SREM idx:kolizeums` |

`KolizeumJoined`/`KolizeumExited` are **deferred**: partial-fill roster / live join counts are
object state (an exit carries no side, so a fold cannot stay consistent) — the view serves the
lifecycle status instead.

---

## Fights — `/v1/fights?id=|character=|world=`

The shared `Fight` object (`aresrpg_fight::fight_events`). The durable, event-faithful slice a client
can't scan for: existence, lifecycle status, roster (who holds which seat), the turn cursor,
and the board anchor `(world, anchor)` from which the client re-derives the board. The LIVE
per-combatant board (cells, HP/AP/MP, mob identities, the turn queue) is object/DF state
assembled at seat time and never emitted — it rides the presence layer + the client's own sim
replay (**§14 THE LAW**: presence carries live motion, the chain referees). This slice serves
the resync **primitive**, not a live board mirror.

Doc `rpc:fight:{fight}`, char→fight pointer `rpc:char_fight:{character}`, world index
`rpc:idx:fights:{world}`.

```jsonc
{ "fight":"0x…", "world":"0x…", "spawn_id":"77",           // FightCreated (spawn_id: u64 → string)
  "anchor_x":100, "anchor_z":200, "public_fight":true, "aged_bp":500, "mob_count":3,
  "status":"placement"|"active"|"victory"|"defeat",
  "participants": { "0x…char": <seat u64>, … },            // FightJoined (idempotent map)
  "current_turn": { "is_mob":false, "idx":0, "deadline_ms":0 } | null } // TurnStarted
```

| Event | Fields | Redis writes |
| --- | --- | --- |
| `FightCreated` | fight, world, spawn_id, anchor_x, anchor_z, public_fight, aged_bp, mob_count | `SET rpc:fight:{fight}` (`status:"placement"`, empty roster); `SADD idx:fights:{world}` |
| `FightJoined` | fight, character, seat | NX skeleton; `SET $.participants["{character}"] {seat}`; `SET rpc:char_fight:{character} "{fight}"` |
| `TurnStarted` | fight, is_mob, idx, deadline_ms | `SET $.status "active"`; `SET $.current_turn` |
| `Victory` | fight, aged_bp | `SET $.status "victory"` |
| `Defeat` | fight | `SET $.status "defeat"` |
| `Settled` / `Swept` | fight | `DEL rpc:fight:{fight}` — the shared object is destroyed |

## FightResult (soulbound) — `/v1/fight-results?owner=`

Doc `rpc:result:{result}`, owner index `rpc:idx:results:{owner}`.

| Event | Fields | Redis writes |
| --- | --- | --- |
| `ResultMinted` | result, fight, character, owner, outcome, xp_share, final_hp | `SET rpc:result:{result}` (`outcome` u8 2/3→`"victory"`/`"defeat"`, `opened:false`, `loot_units:0`); `SADD idx:results:{owner}` |
| `ResultOpened` | result, character, xp_share, loot_units | `SET rpc:result:{result}` (**CREATE**, not a patch: `results::open` consumes the engine FightOutcome and mints a NEW core FightResult — disjoint id families; owner = tx sender, `opened:true`, fight/outcome/final_hp `null`); `SADD idx:results:{owner=sender}` |
| `ResultBurned` | result | `DEL rpc:result:{result}` — emptied husk deleted for the rebate |

## Pending FightOutcomes — `/v1/pending-outcomes?owner=`

A wallet's PENDING (unopened) soulbound `aresrpg_fight::settlement::FightOutcome`s — the engine
outcomes minted at settle, awaiting `results::open` (which consumes them). Distinct from
`/v1/fight-results` (which also serves the OPENED core tickets); this is exactly the still-openable
set. Projected in the **`ares_snapshot`** pipeline from checkpoint object CREATE/DELETE (no event links
outcome → FightResult ids — the documented gap), keyed by the seat's `AddressOwner`.

Doc `rpc:pending_outcome:{id}`, per-owner **sorted set** `rpc:idx:pending_outcomes:{owner}`
(score = checkpoint ts, member = outcome id, capped to the newest `PENDING_CAP` = 100).

| Object edge | Source | Redis writes |
| --- | --- | --- |
| **create** (`FightOutcome` output object, `AddressOwner`) | `map_fight_outcome_object` | `ZADD idx:pending_outcomes:{owner} {ts} {id}`; `ZREMRANGEBYRANK … keep-newest-100`; `SET rpc:pending_outcome:{id} {outcome_id,character_id,fight_id,world_id,pvp,outcome,aged_bp}` |
| **delete** (`effects.deleted()` ∩ input `FightOutcome`) | `remove_pending_outcome` | `ZREM idx:pending_outcomes:{owner} {id}`; `DEL rpc:pending_outcome:{id}` |

The delete is EXACT (the owning address rides the deleted input object), so the index self-cleans with no
monotonic wart — but the doc `DEL` is unconditional, so even a capped-out id's doc is reclaimed when
its outcome is finally opened. NEVER a `NUMINCRBY` on this path (a money-shaped counter would
replay-double-count — `store.rs`); the sorted set is idempotent (re-ZADD of the same member is a no-op).

The view (`?owner=` required) returns a **bare JSON array** (FROZEN contract — a frontend lane builds
against it verbatim) of `[{ outcome_id, character_id, fight_id, world_id, pvp, outcome, aged_bp }]`,
newest-first, dropping any capped-out / just-consumed id whose doc is missing.

## Pending PetBoxClaims — `/v1/pet-claims?owner=`

A wallet's UNCLAIMED soulbound `aresrpg::loot_box::PetBoxClaim`s — `open_box` mints one recording
which pet template the roll picked; `claim_pet` consumes (deletes) it. This was the LAST sanctioned
chain-direct read in the app (`docs/V1_SWEEP_PLAN.md` §3 item 9 — no kiosk join is possible for a
soulbound object, so it could not ride `/v1/owner-items`). Projected in the **`ares_snapshot`**
pipeline from checkpoint object CREATE/DELETE, keyed by the claim's `AddressOwner`.

Doc `rpc:petclaims:{owner}` = `{ owner, claims: { "<claim_id>": "<rolled_template>" } }` — ONE doc
per owner, a map keyed by the claim's own id (not a stored array: no `RedisWrite` primitive removes
an element from a literal array, so a keyed sub-object gives idempotent create/delete via plain
`JSON.SET`/`JSON.DEL`, mirroring the `$.jobs`/`$.equipment` map idiom). No defensive cap (unlike
`pending_outcome`): a claim costs the opener real SUI to mint, so there is no free-griefing vector.

| Object edge | Source | Redis writes |
| --- | --- | --- |
| **create** (`PetBoxClaim` output object, `AddressOwner`) | `map_pet_box_claim_object` | `SET rpc:petclaims:{owner} $ {owner,claims:{}} NX`; `SET rpc:petclaims:{owner} $.claims["{id}"] "{rolled_template}"` |
| **delete** (`effects.deleted()` ∩ input `PetBoxClaim`) | `remove_pet_box_claim` | `DEL rpc:petclaims:{owner} $.claims["{id}"]` |

The delete is EXACT (the owning address rides the deleted input object), so the map self-cleans with no
monotonic wart. The view (`?owner=` required) returns a **bare JSON array** (mirrors
`/v1/pending-outcomes`) of `[{ claim_id, rolled_template }]`; `[]` for a wallet with nothing pending.

## Pet feeding — `/v1/characters` equipment + `/v1/owner-items`

Pet cadence is event-derived and absolute. `PetPowerAdvanced` writes
`rpc:pet_feed:{pet}` = `{ pet, feed_count, next_feed_at_ms }`; replay replaces the same document.
No document means authoritative never-fed state, so pet rows serve `feed_count: 0` and
`next_feed_at_ms: 0`. `extract::ItemBurned` deletes this new per-pet document with the item.

Allowed food templates live in the Redis set `rpc:idx:pet_feed_foods`; every `FoodPowerSet`
idempotently `SADD`s its `food_template`. `/v1/owner-items` serves `pet_feed_allowed` on resource
rows by exact set membership. `PetFed` remains analytics-only and is not projected. This cadence
slice does not decode or duplicate the item's `item_stats::StatsKey` dynamic field.

---

## Deferred — recognised but **not** projected (`_ => None`)

Projecting any of these would re-implement object/DF state (or the sim reducer) in the read
cache — the anti-pattern the "cache, not authority" rule forbids. Where a durable value results,
it lands with **object-snapshot indexing**; the events are named here so the gap is explicit.

- **CRAFT / PET ANALYTICS / RUNES / GATHER verbs** — `crafting::{Crafted,RecipeCreated}`,
  `pet::PetFed`, `runes::{GearCrushed,GearScribed,CrushOutputSet}`,
  `gathering::{ResourceGathered,ProtectorTriggered}`. Activity events whose durable result is
  object/DF state: the minted output item (already indexed via `item::ItemMinted`), accrued
  job-xp / rune inventory (items), and the scribed item level (already indexed
  via `scribe::Scribed`). The same object-snapshot class as character level/progression. **§14
  defines no activity-feed view and no consumer keys one** — per "document the gap, never
  invent," they stay deferred. (A future recent-activity feed, if a consumer materialises, is an
  additive slice keyed by actor address — not a state projection.)
- **Fight granular board/turn** — `Placed`,`Ready`,`Moved`,`Cast`,`Hit`,`TurnEnded`,`LootMinted`
  (live board = presence + client sim replay; the client reads `results::rolled_qty` on-chain to
  build its per-template mint txs).
- **Kolizeum** `Joined`/`Exited`/`OutcomeOpened` (the seat `FightOutcome` DELETE rides the
  `ares_snapshot` pipeline → `/v1/pending-outcomes`; the event carries no `outcome_id`/`owner` to
  key that view, and clearing `char_fight` would race a late `open`); **zone** `MobGroupClaimed`;
  **world** `WorldUpdated`; **item**
  `ItemMerged`/`ItemSplit`; the various `*PolicyCreated`; `catalog::Category*`; `scribe::BandSet`.

## Documented staleness tradeoffs (monotonic index growth, correct via read-time drop-missing)

Terminal events that **omit** the membership key force read-time cleanup:

- `rpc:idx:fights:{world}` retains ids after a fight goes terminal/deleted (Settled/Swept omit
  `world`) → `/v1/fights?world=` **drops missing docs and status-filters** at read time.
- `rpc:idx:results:{owner}` retains ids after `ResultBurned` (omits `owner`) → `/v1/fight-results`
  **drops missing docs** at read time.
- the `ResultMinted` outcome doc stays `opened:false` after `results::open` consumes the on-chain
  FightOutcome — no event links the outcome id to the new FightResult id, so it CANNOT be dropped
  or flipped from events alone (the opened truth lands on the NEW ticket doc). A client must treat
  a stale `opened:false` row whose object no longer exists as consumed (pre-flight refuses it).
- `rpc:char_fight:{character}` is never cleared (terminal events omit the roster); a dangling
  pointer resolves to a **missing** fight doc → "no active fight" (a refight overwrites it).

**`rpc:idx:runs:{owner}` is NOT in this class** — `RunEnded` carries `player`, so its `SREM` is
exact; dungeon runs have no index wart. Likewise `rpc:idx:kolizeums` is cleaned by `KolizeumSwept`.

All read-time drop-missing is via the shared `read_index` (`api/views.js`) filtering falsy
docs, and a fresh re-index (new `FIRST_CHECKPOINT`) is always clean.

## Implementation status

The arms are mechanical clones of the decode→`set`/`sadd`/`srem`/`del` pattern, unit-tested in
`tests.rs` (synthetic BCS in → exact write batch out) and mirrored one-for-one by the Bun views
(`api/views.js`) and their fixture tests (`api/views.test.js`, real Redis). The only judgment —
the schema, the status-derivation across events, and the drop-missing strategy — is captured
above. Runtime BCS-vs-Move layout is confirmed once the packages publish to testnet.
