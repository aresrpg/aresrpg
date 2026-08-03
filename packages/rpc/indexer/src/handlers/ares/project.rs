// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! The handler mapping: `(module, name, contents) -> Redis writes`.
//!
//! [`map`] is a **pure** function — it BCS-decodes one event body and returns the
//! Redis mutations it projects into, with no I/O. That is what makes it unit-
//! testable offline (feed a synthetic event, assert the writes) and what keeps
//! the read-model a re-derivable cache: replaying the same checkpoints yields the
//! same state. [`execute`] is the only I/O, replaying a batch of [`RedisWrite`]s
//! against Redis in order.
//!
//! ## Idempotency
//! Every write is a `JSON.SET` upsert / `SADD` / `DEL` (idempotent on replay)
//! EXCEPT the two relative counters the event shapes force — shop `minted`
//! (`SaleBought.amount` is a delta) and zone `mob_groups` (a claim is `-1`).
//! Both are cache approximations that become exact under object-snapshot indexing
//! (reading `Sale.minted` / the live `Zone`); they are marked `RELATIVE` below.
//! Money amounts (MIST) are stored as **strings** to survive JSON's 2^53 (the API
//! contract — see the stub shapes), while counts/coords/levels stay numbers.

use anyhow::{Context, Result};
use redis::aio::{ConnectionLike, MultiplexedConnection};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use super::{decode::decode_bcs, model::*, party};

/// One Redis mutation. `PartialEq` so tests assert the exact projection.
#[derive(Debug, Clone, PartialEq)]
pub enum RedisWrite {
    /// `JSON.SET key path json [NX]` — idempotent upsert (NX = create-if-absent doc init).
    Set {
        key: String,
        path: String,
        json: String,
        nx: bool,
    },
    /// `JSON.DEL key path` — remove a doc (`$`) or a sub-path.
    Del { key: String, path: String },
    /// `JSON.NUMINCRBY key path by` — RELATIVE, see the module note.
    NumIncrBy { key: String, path: String, by: i64 },
    /// `SADD key member` — membership index (idempotent).
    SetAdd { key: String, member: String },
    /// `SREM key member`.
    SetDel { key: String, member: String },
    /// `ZADD key score member` — append/refresh a scored row (idempotent when the
    /// member is unique per event, e.g. a per-item sale row: re-adding is a no-op).
    ZAdd {
        key: String,
        score: i64,
        member: String,
    },
    /// `ZREM key member` — drop a scored row by member (idempotent: removing an
    /// absent member is a no-op, so a delete replays safely).
    ZRem { key: String, member: String },
    /// `ZREMRANGEBYRANK key start stop` — cap a sorted set (idempotent; drops the
    /// out-of-cap tail, a no-op once already trimmed).
    ZRemRangeByRank { key: String, start: i64, stop: i64 },
    /// `ZREMRANGEBYSCORE key min max` — trim time-series rows outside their
    /// retention window (idempotent; old rows stay gone on replay).
    ZRemRangeByScore { key: String, min: i64, max: i64 },
    /// `EXPIRE key seconds` — refresh a key's idle TTL (idempotent; re-setting the
    /// same TTL is a no-op). Lets an inactive per-kiosk sales log self-evict.
    Expire { key: String, seconds: i64 },
    /// Atomic Party reducers. The three-field events do not carry the resulting
    /// order/new leader, so Redis derives them from the prior projected document.
    PartyCreate {
        party: String,
        character: String,
        owner: String,
    },
    PartyJoin {
        party: String,
        character: String,
        owner: String,
    },
    PartyLeave {
        party: String,
        character: String,
        owner: String,
    },
    /// Atomic reconcile of one party's whole PENDING-invite vector against the previous
    /// projection (`party::invite` emits no event — see `party.rs`). Latest-wins, so an
    /// empty vector is the deletion.
    PartyPending {
        party: String,
        invites: Vec<party::PendingInvite>,
    },
}

// ── write constructors (terse match arms) ────────────────────────────────────

// `pub(super)` on the constructors + key/skeleton helpers the sibling `snapshot`
// module (object snapshots + taux) reuses — one home for the write shapes.
pub(super) fn set(key: String, path: &str, json: Value) -> RedisWrite {
    RedisWrite::Set {
        key,
        path: path.to_string(),
        json: json.to_string(),
        nx: false,
    }
}
pub(super) fn set_nx(key: String, path: &str, json: Value) -> RedisWrite {
    RedisWrite::Set {
        key,
        path: path.to_string(),
        json: json.to_string(),
        nx: true,
    }
}
pub(super) fn del(key: String, path: &str) -> RedisWrite {
    RedisWrite::Del {
        key,
        path: path.to_string(),
    }
}
fn incr(key: String, path: &str, by: i64) -> RedisWrite {
    RedisWrite::NumIncrBy {
        key,
        path: path.to_string(),
        by,
    }
}
pub(super) fn sadd(key: String, member: String) -> RedisWrite {
    RedisWrite::SetAdd { key, member }
}
pub(super) fn srem(key: String, member: String) -> RedisWrite {
    RedisWrite::SetDel { key, member }
}
pub(super) fn zadd(key: String, score: i64, member: String) -> RedisWrite {
    RedisWrite::ZAdd { key, score, member }
}
pub(super) fn zrem(key: String, member: String) -> RedisWrite {
    RedisWrite::ZRem { key, member }
}
/// Trim a sorted set to its newest `cap` members (highest scores). The set is
/// ascending by score, so the oldest live at ranks `0..len-cap`.
pub(super) fn zrem_rank_keep_newest(key: String, cap: i64) -> RedisWrite {
    RedisWrite::ZRemRangeByRank {
        key,
        start: 0,
        stop: -(cap + 1),
    }
}
fn zrem_score_through(key: String, max: i64) -> RedisWrite {
    RedisWrite::ZRemRangeByScore { key, min: 0, max }
}
pub(super) fn expire(key: String, seconds: i64) -> RedisWrite {
    RedisWrite::Expire { key, seconds }
}

// ── key builders (the CONTRACT the JS views mirror — keep in sync) ────────────

pub(super) fn k_character(id: &str) -> String {
    format!("rpc:character:{id}")
}
fn k_char_owner(addr: &str) -> String {
    format!("rpc:idx:char_owner:{addr}")
}
fn k_char_name(name: &str) -> String {
    format!("rpc:idx:char_name:{}", name.to_ascii_lowercase())
}
// `pub(super)` so the sibling `snapshot` module's Item object-snapshot writes to the SAME
// item doc the `item::ItemMinted` event arm projects (one home for the item key shape — the
// event sets template/item_type, the snapshot adds name/category/amount/kiosk_id, converging
// idempotently like the ItemTemplate doc).
pub(super) fn k_item(id: &str) -> String {
    format!("rpc:item:{id}")
}
fn k_pet_feed(id: &str) -> String {
    format!("rpc:pet_feed:{id}")
}
const K_PET_FEED_FOODS: &str = "rpc:idx:pet_feed_foods";
fn k_listing(item: &str) -> String {
    format!("rpc:listing:{item}")
}
const K_LISTINGS: &str = "rpc:idx:listings";
// Marketplace sales-history (seller-side) — storage-light by construction. A
// realised sale is a native `0x2::kiosk::ItemPurchased` after transaction-level
// discrimination excludes the extract seam's transient zero-price list+purchase.
// The event carries {kiosk, item, price} but NOT the seller (the seller is the kiosk
// owner). Each sale is appended to a per-KIOSK sorted set, and the seller→kiosk edge
// is recorded at listing time. The API resolves `?seller=` → kiosk(s) → the log.
// Retention (documented contract, HANDLERS.md): newest `SALES_CAP` rows per
// kiosk (whale/grief bound) + a `SALES_TTL_SECS` idle TTL (a kiosk that stops selling
// self-evicts its whole log). The sorted set is IDEMPOTENT (a per-item row is unique,
// so ZADD-on-replay is a no-op) — it needs no `NUMINCRBY` on the money path and stays
// crash-replay safe like every other write here (store.rs).
fn k_sales(kiosk: &str) -> String {
    format!("rpc:sales_log:{kiosk}")
}
fn k_seller_kiosks(seller: &str) -> String {
    format!("rpc:idx:seller_kiosks:{seller}")
}
/// Keep the newest N sales per kiosk. 500 fully contains a 30d revenue window for any
/// realistic seller (>500 sales/30d = 16+/day); beyond that the oldest rows fall off
/// and `revenue_30d` slightly under-counts — bump the cap (or add a daily rollup) if
/// real whales appear. YAGNI until then.
const SALES_CAP: i64 = 500;
/// 90d idle TTL: a kiosk with no sale for 90d frees its whole log. Refreshed on every
/// sale, so an active log persists; matches the API's 30d revenue horizon with margin.
const SALES_TTL_SECS: i64 = 90 * 24 * 60 * 60;
fn k_pool(id: &str) -> String {
    format!("rpc:pool:{id}")
}
fn k_sale(id: &str) -> String {
    format!("rpc:sale:{id}")
}
const K_SALES: &str = "rpc:idx:sales";
// Exact first-party shop receipts for `/v1/sales-over-time`. `SaleBought.item`
// is unique per purchase, so each JSON member is stable under checkpoint replay;
// daily count/volume are derived at read time instead of using drift-prone
// NUMINCRBY money counters. Keep a one-day cushion beyond the API's 365-day cap
// so the oldest UTC calendar day remains complete regardless of event time.
const K_SALES_OVER_TIME: &str = "rpc:sales_over_time";
const SALES_OVER_TIME_RETENTION_MS: u64 = 366 * 24 * 60 * 60 * 1_000;
pub(super) fn k_world(id: &str) -> String {
    format!("rpc:world:{id}")
}
pub(super) const K_WORLDS: &str = "rpc:idx:worlds";
// `pub(super)` so the sibling `snapshot` module's Zone-DF object snapshot writes to the SAME
// zone doc/index the `zones::ZoneSearched` event arm projects (one home for the zone key shapes —
// the event sets discovery + derived counts, while the snapshot adds the seed + consumed bitmaps
// from which the client derives the live rows, converging idempotently).
pub(super) fn k_zone(world: &str, zx: u32, zy: u32) -> String {
    format!("rpc:zone:{world}:{zx}:{zy}")
}
pub(super) fn k_zones(world: &str) -> String {
    format!("rpc:idx:zones:{world}")
}
// §6 golden-gather link table: one doc per (world, base template) holding the rare
// variant id, plus a per-world index set for enumeration (mirrors the zone shape).
fn k_rare_link(world: &str, template: &str) -> String {
    format!("rpc:rare_link:{world}:{template}")
}
fn k_rare_links(world: &str) -> String {
    format!("rpc:idx:rare_links:{world}")
}
// `pub(super)` so the sibling `snapshot` module's ItemTemplate object-snapshot
// enrichment writes to the SAME encyclopedia doc/index the `TemplateCreated` event
// arm below projects (one home for the item-template key shapes).
pub(super) fn k_template(id: &str) -> String {
    format!("rpc:template:{id}")
}
pub(super) const K_TEMPLATES: &str = "rpc:idx:templates";
// Live on-chain supply per template — SUM of `amount` (item.move's fungible-units field: always 1
// for a unique NFT, N for a stackable) across every still-alive `Item`. `item.move` deliberately
// holds no supply ledger ("the sale gate's concern"), and there IS no sale-gate-wide cap (a
// mob-loot/gather mint has no gate at all) — so this is the read-model's own derived counter, exact
// under the two chain-truth events that change it: `item::ItemMinted` (+amount, the ONLY mint door —
// `mint`/`mint_stack` both emit it) and `extract::ItemBurned` (-amount, the ONLY burn door — pool
// sell / forgemagie crush / dungeon key consume / crafting ingredient consume all route through
// `extract::burn`, which always destroys the WHOLE item object and reports its full `amount`).
// `ItemMerged`/`ItemSplit` (stack fold/split) are supply-NEUTRAL by construction (units conserved
// across the two objects) and deliberately untracked here, same "document the gap" stance as
// HANDLERS.md's other deferred events. `NUMINCRBY` is RELATIVE like shop `minted` (not idempotent on
// a replayed checkpoint) — the accepted approximation class this module's header documents; a fresh
// re-index (new FIRST_CHECKPOINT) re-derives it exactly.
pub(super) fn k_supply(template: &str) -> String {
    format!("rpc:supply:{template}")
}
// Last realised PER-UNIT sale price per template (marketcap = supply × this, client-side) —
// `{ template, price_mist: "<string>", ts }`, latest-wins SET. Written EXCLUSIVELY by the
// `ares_snapshot` pipeline (snapshot.rs `map_last_sale`): all three sale venues (shop primary,
// pool AMM, kiosk marketplace) land on ONE key from ONE sequential pipeline, so checkpoint order
// is exact — splitting venues across the two pipelines (each with its own watermark) would let a
// backfilling pipeline overwrite a newer sale the other already wrote. `pub(super)` = one home
// for the key shape, mirrored by the JS view (`K.lastsale`).
pub(super) fn k_lastsale(template: &str) -> String {
    format!("rpc:lastsale:{template}")
}
// `pub(super)` so the sibling `snapshot` module's GameConfig object arm writes the class rows to
// the SAME doc `ClassRowSet` projects into (one home for the key — #1886).
pub(super) const K_CONFIG: &str = "rpc:config";
// `pub(super)` so the sibling `snapshot` module's Creation object arm writes the birth-state dials
// to the SAME doc the administrative creation events project into (#2123).
pub(super) const K_CREATION: &str = "rpc:creation";
fn k_kolizeum(id: &str) -> String {
    format!("rpc:kolizeum:{id}")
}
const K_KOLIZEUMS: &str = "rpc:idx:kolizeums";
fn k_run(pass: &str) -> String {
    format!("rpc:run:{pass}")
}
fn k_runs(owner: &str) -> String {
    format!("rpc:idx:runs:{owner}")
}
fn k_fight(id: &str) -> String {
    format!("rpc:fight:{id}")
}
fn k_char_fight(c: &str) -> String {
    format!("rpc:char_fight:{c}")
}
fn k_fights(world: &str) -> String {
    format!("rpc:idx:fights:{world}")
}
// A world-fight mob-group's homogeneous `MobTemplate` id, keyed by (world, spawn_id) — the pair the
// Fight doc also stores (`world` + `spawn_id`). `zones::MobGroupClaimed` fires in the SAME PTB as the
// fight it opens and carries the identical id the GroupTicket hands `fight::create`, so this doc IS the
// fight's `group.template`, addressed independently of the fight's derived object id. The /v1/fights
// view joins it at read time (like /v1/listings joins the item template) to NAME a fight's mobs. Bare
// string value; latest-wins + stable (a spawn's group is seed-derived).
fn k_group_template(world: &str, spawn_id: u64) -> String {
    format!("rpc:group_template:{world}:{spawn_id}")
}
pub(super) fn k_result(id: &str) -> String {
    format!("rpc:result:{id}")
}
pub(super) fn k_results(owner: &str) -> String {
    format!("rpc:idx:results:{owner}")
}
// §17.22 resource-protector ambush signal — the gatherer's LATEST protector trigger,
// keyed by gatherer address (latest-wins). The ambush Fight itself rides the fight
// handlers (FightCreated/FightJoined — the gatherer is auto-seated); this is the
// address-keyed "your gather spawned an ambush" signal + its spawn_id/where context.
fn k_protector(gatherer: &str) -> String {
    format!("rpc:protector_trigger:{gatherer}")
}
// aresrpg::commission (v2) — a CraftRequest doc + its two directory indexes (the artisan
// it's offered TO, the customer who opened it). execute/cancel DELETE the doc (the
// on-chain CraftRequest is consumed either way) and — both carrying customer AND artisan
// — un-index EXACTLY under both parties.
fn k_commission(id: &str) -> String {
    format!("rpc:commission:{id}")
}
fn k_commissions_by_artisan(artisan: &str) -> String {
    format!("rpc:idx:commissions_by_artisan:{artisan}")
}
fn k_commissions_by_customer(customer: &str) -> String {
    format!("rpc:idx:commissions_by_customer:{customer}")
}

/// `FightResult.outcome` u8 → the string the view passes through. 2 = victory,
/// 3 = defeat (aresrpg_fight::fight STATUS_VICTORY / STATUS_DEFEAT).
fn outcome_str(outcome: u8) -> &'static str {
    if outcome == 2 {
        "victory"
    } else {
        "defeat"
    }
}

/// JSONPath to a map entry keyed by an arbitrary (hex) string: `$.equipment["0x…"]`.
/// `pub(super)` so the sibling `snapshot` module's job-xp DF arm addresses `$.jobs["<u8>"]`
/// through the SAME builder the stats block uses (one home for the map-entry path shape).
pub(super) fn mpath(base: &str, key: &str) -> String {
    format!("{base}[\"{key}\"]")
}

/// BCS-decode this arm's event body. The `(module, name)` that selected the arm is passed
/// straight through so a mismatch between the Rust mirror and its Move struct is REPORTED
/// (loudly, to Sentry) instead of vanishing — see [`super::decode`]. `None` = decode failed
/// and the arm projects nothing; it never means "quietly skipped".
fn decode<T: DeserializeOwned>(module: &str, name: &str, contents: &[u8]) -> Option<T> {
    decode_bcs(module, name, contents)
}

/// Canonical character doc skeleton every character-touching event inits (NX), so
/// merges are order-independent regardless of which event lands first.
pub(super) fn char_init(key: &str, id: &str) -> RedisWrite {
    set_nx(key.to_string(), "$", json!({ "id": id, "equipment": {} }))
}

/// Transaction evidence used only by the native kiosk-purchase arm. A successful
/// standalone `ItemPurchased` is a genuine purchase receipt even at price zero.
/// The extraction seam instead emits a same-transaction zero-price
/// `ItemListed` + `ItemPurchased` pair without resolving the royalty rule.
#[derive(Debug, Clone, Copy, Default)]
pub(super) struct KioskPurchaseContext {
    pub transient_zero_listing: bool,
    pub has_royalty_receipt: bool,
    pub confirmed_extract_exit: bool,
}

/// Project one decoded event into its Redis writes. Direct callers have no
/// evidence of an extraction pair, so a successful kiosk purchase is treated as
/// genuine. The checkpoint handler calls [`map_with_context`] after inspecting
/// the other events and Move calls in the same transaction.
pub fn map(
    module: &str,
    name: &str,
    pkg: &str,
    sender: &str,
    ts_ms: u64,
    contents: &[u8],
) -> Option<Vec<RedisWrite>> {
    map_with_context(
        module,
        name,
        pkg,
        sender,
        ts_ms,
        contents,
        KioskPurchaseContext::default(),
    )
}

/// Context-aware event projection. `ts_ms` is the enclosing checkpoint's
/// timestamp (the sale "when" — no event carries its own time); most arms ignore
/// it. `None` means the event is foreign or recognised-but-deferred.
pub(super) fn map_with_context(
    module: &str,
    name: &str,
    _pkg: &str,
    sender: &str,
    ts_ms: u64,
    contents: &[u8],
    purchase: KioskPurchaseContext,
) -> Option<Vec<RedisWrite>> {
    Some(match (module, name) {
        // ── Party (character-keyed groups) ──────────────────────────────────
        ("party", _) => vec![party::map(name, contents)?],

        // ── pools ────────────────────────────────────────────────────────────
        ("pool", "PoolBuy") => {
            let e: PoolBuy = decode(module, name, contents)?;
            let pool = e.pool.to_canonical_string(true);
            vec![
                set(k_pool(&pool), "$.item_reserve", json!(e.item_reserve)),
                set(
                    k_pool(&pool),
                    "$.real_sui_mist",
                    json!(e.real_sui.to_string()),
                ),
            ]
        }
        ("pool", "PoolSell") => {
            let e: PoolSell = decode(module, name, contents)?;
            let pool = e.pool.to_canonical_string(true);
            vec![
                set(k_pool(&pool), "$.item_reserve", json!(e.item_reserve)),
                set(
                    k_pool(&pool),
                    "$.real_sui_mist",
                    json!(e.real_sui.to_string()),
                ),
            ]
        }
        // ── shop ─────────────────────────────────────────────────────────────
        ("shop", "SaleCreated") => {
            let e: SaleCreated = decode(module, name, contents)?;
            let sale = e.sale.to_canonical_string(true);
            vec![
                set(
                    k_sale(&sale),
                    "$",
                    json!({
                        "sale": sale, "template": e.template.to_canonical_string(true),
                        "price_mist": e.price.to_string(),
                        "supply": e.supply, "minted": 0, "paused": false,
                        "start_ms": Value::Null, "end_ms": Value::Null,
                    }),
                ),
                sadd(K_SALES.into(), sale),
            ]
        }
        ("shop", "SaleBurned") => {
            let e: SaleBurned = decode(module, name, contents)?;
            let sale = e.sale.to_canonical_string(true);
            vec![del(k_sale(&sale), "$"), srem(K_SALES.into(), sale)]
        }
        ("shop", "SaleBought") => {
            let e: SaleBought = decode(module, name, contents)?;
            let receipt = json!({
                "sale": e.sale.to_canonical_string(true),
                "item": e.item.to_canonical_string(true),
                "price_mist": e.price.to_string(),
                "amount": e.amount,
                "ts": ts_ms,
            })
            .to_string();
            let retention_cutoff = ts_ms.saturating_sub(SALES_OVER_TIME_RETENTION_MS) as i64;
            // RELATIVE: exact under object-snapshot of `Sale.minted`.
            vec![
                incr(
                    k_sale(&e.sale.to_canonical_string(true)),
                    "$.minted",
                    e.amount as i64,
                ),
                zadd(K_SALES_OVER_TIME.into(), ts_ms as i64, receipt),
                zrem_score_through(K_SALES_OVER_TIME.into(), retention_cutoff),
            ]
        }
        ("shop", "PriceChanged") => {
            let e: ShopPriceChanged = decode(module, name, contents)?;
            vec![set(
                k_sale(&e.sale.to_canonical_string(true)),
                "$.price_mist",
                json!(e.price.to_string()),
            )]
        }
        ("shop", "WindowChanged") => {
            let e: WindowChanged = decode(module, name, contents)?;
            let sale = e.sale.to_canonical_string(true);
            vec![
                set(k_sale(&sale), "$.start_ms", json!(e.start_ms)),
                set(k_sale(&sale), "$.end_ms", json!(e.end_ms)),
            ]
        }
        ("shop", "SalePaused") => {
            let e: SalePaused = decode(module, name, contents)?;
            vec![set(
                k_sale(&e.sale.to_canonical_string(true)),
                "$.paused",
                json!(e.paused),
            )]
        }

        // ── character creation (config + the character doc) ───────────────────
        ("creation", "CharacterCreated") => {
            let e: CharacterCreated = decode(module, name, contents)?;
            let ch = e.character.to_canonical_string(true);
            let key = k_character(&ch);
            let name_index = k_char_name(&e.name);
            vec![
                char_init(&key, &ch),
                set(key.clone(), "$.name", json!(e.name)),
                set(key.clone(), "$.class", json!(e.class)),
                set(key, "$.owner", json!(sender)),
                sadd(k_char_owner(sender), ch.clone()),
                sadd(name_index, ch),
            ]
        }
        ("creation", "PriceChanged") => {
            let e: CreationPriceChanged = decode(module, name, contents)?;
            vec![
                set_nx(
                    K_CREATION.into(),
                    "$",
                    json!({ "classes": {}, "starters": {} }),
                ),
                set(
                    K_CREATION.into(),
                    "$.price_mist",
                    json!(e.price.to_string()),
                ),
            ]
        }
        ("creation", "PausedSet") => {
            let e: PausedSet = decode(module, name, contents)?;
            vec![
                set_nx(
                    K_CREATION.into(),
                    "$",
                    json!({ "classes": {}, "starters": {} }),
                ),
                set(K_CREATION.into(), "$.paused", json!(e.paused)),
            ]
        }
        ("creation", "ClassAdded") => {
            let e: ClassName = decode(module, name, contents)?;
            vec![
                set_nx(
                    K_CREATION.into(),
                    "$",
                    json!({ "classes": {}, "starters": {} }),
                ),
                set(
                    K_CREATION.into(),
                    &mpath("$.classes", &e.class),
                    json!(true),
                ),
            ]
        }
        ("creation", "ClassRemoved") => {
            let e: ClassName = decode(module, name, contents)?;
            vec![del(K_CREATION.into(), &mpath("$.classes", &e.class))]
        }
        // Free-creation state (sponsor pays) — surfaced so a create-character UI and
        // the publish ceremony's RPC assertion can read whether creation is free/who
        // sponsors it.
        ("creation", "SponsorSet") => {
            let e: SponsorSet = decode(module, name, contents)?;
            vec![
                set_nx(
                    K_CREATION.into(),
                    "$",
                    json!({ "classes": {}, "starters": {} }),
                ),
                set(
                    K_CREATION.into(),
                    "$.sponsor",
                    json!(e.sponsor.map(|a| a.to_string())),
                ),
            ]
        }
        ("creation", "FreeEnabledSet") => {
            let e: FreeEnabledSet = decode(module, name, contents)?;
            vec![
                set_nx(
                    K_CREATION.into(),
                    "$",
                    json!({ "classes": {}, "starters": {} }),
                ),
                set(K_CREATION.into(), "$.free", json!(e.enabled)),
            ]
        }

        // ── character (low-level mint + position) ─────────────────────────────
        ("character", "CharacterMinted") => {
            let e: CharacterMinted = decode(module, name, contents)?;
            let ch = e.character.to_canonical_string(true);
            let key = k_character(&ch);
            vec![
                char_init(&key, &ch),
                set(key.clone(), "$.class", json!(e.class)),
                set(key, "$.owner", json!(sender)),
                sadd(k_char_owner(sender), ch),
            ]
        }
        ("character", "PositionAnchored") => {
            let e: PositionAnchored = decode(module, name, contents)?;
            let ch = e.character.to_canonical_string(true);
            let key = k_character(&ch);
            vec![
                char_init(&key, &ch),
                set(
                    key,
                    "$.position",
                    json!({
                        "x": e.pos_x, "z": e.pos_z, "zone": e.zone, "at_ms": e.anchored_at_ms,
                    }),
                ),
            ]
        }

        // ── stat allocation: the player-spent per-stat block on the character doc ──
        // Absolute upsert of the raised stat's NEW total (`stat_total`) — idempotent
        // and replay-safe, no relative counter. The `available_points` the view serves
        // is DERIVED at read time from `level` (object snapshot) minus Σ allocations
        // (the flat 1:1 cost makes Σ allocations == points spent). `$.stats` is NX-init'd
        // here (not in char_init) so the arm is self-contained.
        //
        // TWO emitting modules, one projection: the #1289 module merge folded
        // `stat_allocation` into `character_link` (same event name, same field order, same
        // meaning). Both are matched because BOTH exist in the indexed history — the old
        // module's events stay in every checkpoint before the republish, and re-indexing
        // from an earlier watermark must still project them.
        ("stat_allocation" | "character_link", "StatRaised") => {
            let e: StatRaised = decode(module, name, contents)?;
            let ch = e.character.to_canonical_string(true);
            let key = k_character(&ch);
            vec![
                char_init(&key, &ch),
                set_nx(key.clone(), "$.stats", json!({})),
                set(
                    key,
                    &mpath("$.stats", &e.stat.to_string()),
                    json!(e.stat_total),
                ),
            ]
        }

        // ── items: encyclopedia templates + listing-enrichment item docs ──────
        ("item", "TemplateCreated") => {
            let e: Template = decode(module, name, contents)?;
            let t = e.template.to_canonical_string(true);
            vec![
                // NX-init + per-field set (NEVER a full `$` replace) so the ItemTemplate object
                // snapshot (`snapshot.rs`) can enrich the SAME doc with name/category/level in the
                // OTHER pipeline without either write wiping the other, whatever order they land.
                set_nx(k_template(&t), "$", json!({ "template": t, "live": true })),
                set(k_template(&t), "$.item_type", json!(e.item_type)),
                sadd(K_TEMPLATES.into(), t),
            ]
        }
        ("item", "TemplateRenamed") => {
            let e: TemplateRenamed = decode(module, name, contents)?;
            let t = e.template.to_canonical_string(true);
            let key = k_template(&t);
            vec![
                // The admin rename mutates ONE shared object. Keep the event on the exact
                // document/index SSOT used by creation and object snapshots; NX/SADD make
                // this self-healing if the event pipeline temporarily leads the snapshot.
                set_nx(key.clone(), "$", json!({ "template": t, "live": true })),
                set(key, "$.name", json!(e.name)),
                sadd(K_TEMPLATES.into(), t),
            ]
        }
        ("item", "TemplateBurned") => {
            let e: Template = decode(module, name, contents)?;
            let t = e.template.to_canonical_string(true);
            vec![del(k_template(&t), "$"), srem(K_TEMPLATES.into(), t)]
        }
        ("item", "ItemMinted") => {
            let e: ItemMinted = decode(module, name, contents)?;
            let item = e.item.to_canonical_string(true);
            let key = k_item(&item);
            let template = e.template.to_canonical_string(true);
            let supply_key = k_supply(&template);
            vec![
                // NX init lets the event and object-snapshot pipelines converge without clobbering.
                set_nx(
                    key.clone(),
                    "$",
                    json!({ "id": item, "level": Value::Null }),
                ),
                set(key.clone(), "$.template", json!(template)),
                set(key, "$.item_type", json!(e.item_type)),
                // Supply arm: NX-seed the per-template counter doc, then bump it by the
                // minted units (1 for a unique NFT, N for a stackable — see k_supply).
                set_nx(
                    supply_key.clone(),
                    "$",
                    json!({ "template": template, "amount": 0 }),
                ),
                incr(supply_key, "$.amount", e.amount as i64),
            ]
        }

        // -- pet feeding: absolute cadence + food-template membership --------
        ("pet", "PetPowerAdvanced") => {
            let e: PetPowerAdvanced = decode(module, name, contents)?;
            let pet = e.pet.to_canonical_string(true);
            vec![set(
                k_pet_feed(&pet),
                "$",
                json!({
                    "pet": pet,
                    "feed_count": e.feed_count,
                    "next_feed_at_ms": e.next_feed_ms,
                }),
            )]
        }
        ("pet", "FoodPowerSet") => {
            let e: FoodPowerSet = decode(module, name, contents)?;
            vec![sadd(
                K_PET_FEED_FOODS.into(),
                e.food_template.to_canonical_string(true),
            )]
        }

        // -- extract: equipment on the character doc -------------------------
        ("extract", "ItemEquipped") => {
            let e: ItemEquip = decode(module, name, contents)?;
            let ch = e.character.to_canonical_string(true);
            let item = e.item.to_canonical_string(true);
            let key = k_character(&ch);
            vec![
                char_init(&key, &ch),
                set(
                    key,
                    &mpath("$.equipment", &item),
                    json!({
                        "template": e.template.to_canonical_string(true), "amount": e.amount,
                    }),
                ),
            ]
        }
        ("extract", "ItemUnequipped") => {
            let e: ItemEquip = decode(module, name, contents)?;
            let ch = e.character.to_canonical_string(true);
            let item = e.item.to_canonical_string(true);
            vec![del(k_character(&ch), &mpath("$.equipment", &item))]
        }
        ("extract", "ItemBurned") => {
            let e: ItemBurned = decode(module, name, contents)?;
            let item = e.item.to_canonical_string(true);
            let template = e.template.to_canonical_string(true);
            let supply_key = k_supply(&template);
            vec![
                del(k_item(&item), "$"),
                del(k_pet_feed(&item), "$"),
                del(k_listing(&item), "$"),
                srem(K_LISTINGS.into(), item),
                // Supply arm: the whole item (its full `amount`) just ceased to exist.
                set_nx(
                    supply_key.clone(),
                    "$",
                    json!({ "template": template, "amount": 0 }),
                ),
                incr(supply_key, "$.amount", -(e.amount as i64)),
            ]
        }

        // ── worlds + zones/discovery ──────────────────────────────────────────
        ("world", "WorldCreated") => {
            let e: WorldCreated = decode(module, name, contents)?;
            let world = e.world.to_canonical_string(true);
            vec![
                // NX: the snapshot pipeline (its own watermark — snapshot.rs `map_world_object`) owns the
                // FULL doc incl. `required_level`; a replayed/lagging create event must seed the skeleton
                // when absent but never clobber the richer object truth back to the 3 event fields.
                set_nx(
                    k_world(&world),
                    "$",
                    json!({ "world": world, "seed": e.seed.to_string(), "biome": e.biome }),
                ),
                sadd(K_WORLDS.into(), world),
            ]
        }
        // §6 golden-gather link table (absolute upsert/remove). SET the rare variant id at the
        // per-(world,template) doc root + index the base template; RareLinkCleared removes both.
        ("world", "RareLinkSet") => {
            let e: RareLinkSet = decode(module, name, contents)?;
            let world = e.world.to_canonical_string(true);
            let template = e.template.to_canonical_string(true);
            vec![
                set(
                    k_rare_link(&world, &template),
                    "$",
                    json!(e.rare_template.to_canonical_string(true)),
                ),
                sadd(k_rare_links(&world), template),
            ]
        }
        ("world", "RareLinkCleared") => {
            let e: RareLinkCleared = decode(module, name, contents)?;
            let world = e.world.to_canonical_string(true);
            let template = e.template.to_canonical_string(true);
            vec![
                del(k_rare_link(&world, &template), "$"),
                srem(k_rare_links(&world), template),
            ]
        }
        ("zones", "WorldJoined") => {
            let e: WorldJoined = decode(module, name, contents)?;
            let ch = e.character.to_canonical_string(true);
            let key = k_character(&ch);
            vec![
                char_init(&key, &ch),
                set(
                    key.clone(),
                    "$.world",
                    json!(e.world.to_canonical_string(true)),
                ),
                set(key, "$.position", json!({ "x": e.x, "z": e.z })),
            ]
        }
        ("zones", "ZoneSearched") => {
            let e: ZoneSearched = decode(module, name, contents)?;
            let world = e.world.to_canonical_string(true);
            let key = k_zone(&world, e.zx, e.zy);
            vec![
                // NX skeleton + per-field sets (NEVER a full `$` replace) so the Zone-DF object
                // snapshot (snapshot.rs `map_zone_field`) can enrich the SAME doc with `$.seed` /
                // `$.mob_bitmap` / `$.res_bitmap` in the OTHER pipeline without either write
                // wiping the other — the SAME convergence pattern as the ItemTemplate doc. These
                // are the search-time totals; the API subtracts consumed-bitmap popcounts for the
                // live counts.
                set_nx(
                    key.clone(),
                    "$",
                    json!({ "world": world, "zx": e.zx, "zy": e.zy, "discovered": true }),
                ),
                set(key.clone(), "$.discovered_at_ms", json!(e.at_ms)),
                set(key.clone(), "$.mob_groups", json!(e.mob_groups)),
                set(key, "$.resource_nodes", json!(e.resource_nodes)),
                sadd(k_zones(&world), format!("{}:{}", e.zx, e.zy)),
            ]
        }
        // MobGroupClaimed carries (x,z)+spawn_id but NOT the zone grid (zx,zy), so it STILL cannot
        // target a zone doc — live depletion stays the mutated Zone DF snapshot's job (snapshot.rs
        // `map_zone_field`). What it DOES project is the one fact it uniquely carries at the world-fight
        // door: the mob-group's homogeneous `MobTemplate` id. It fires in the SAME PTB as the fight it
        // opens (claim + fight::create), and `template` IS the id the GroupTicket provenance hands
        // `fight::create` as `content_template` → `fight.group.template` (zones.move emits event + ticket
        // with the SAME `template_id`). Keyed by (world, spawn_id) — the pair the fight doc also stores —
        // so the /v1/fights view joins it at read time (like /v1/listings joins the item template) to NAME
        // a fight's mobs. Latest-wins + stable (a spawn's group is seed-deterministic → a re-claim rewrites
        // the identical id), so a bare-string SET is sufficient. Ambush/PvP fights use a
        // ticketless door (no MobGroupClaimed) → no doc → the view's null → the honest "Enemies #N" stays.
        ("zones", "MobGroupClaimed") => {
            let e: MobGroupClaimed = decode(module, name, contents)?;
            let world = e.world.to_canonical_string(true);
            vec![set(
                k_group_template(&world, e.spawn_id),
                "$",
                json!(e.template.to_canonical_string(true)),
            )]
        }

        // ── gathering: the resource-protector ambush signal (§17.22) ──────────
        // The ambush Fight itself rides the fight handlers (the gatherer is auto-
        // seated, so `/v1/fights?character=` already resolves it); this projects
        // the per-gatherer SIGNAL (latest-wins) so the gatherer's client can react
        // to the spawn + read its where/what context. `spawn_id == 0` = SKIPPED.
        ("gathering", "ProtectorTriggered") => {
            let e: ProtectorTriggered = decode(module, name, contents)?;
            let gatherer = e.gatherer.to_string();
            vec![set(
                k_protector(&gatherer),
                "$",
                json!({
                    "gatherer": gatherer,
                    "world": e.world.to_canonical_string(true),
                    "template": e.template.to_canonical_string(true),
                    "x": e.x, "z": e.z,
                    "spawn_id": e.spawn_id.to_string(),
                    "at_ms": ts_ms,
                }),
            )]
        }

        // ── game config (dials + class rows) ──────────────────────────────────
        ("config", "ConfigEnabledSet") => {
            let e: ConfigEnabledSet = decode(module, name, contents)?;
            vec![
                set_nx(K_CONFIG.into(), "$", json!({ "dials": {}, "classes": {} })),
                set(K_CONFIG.into(), "$.enabled", json!(e.enabled)),
            ]
        }
        ("config", "DialChanged") => {
            let e: DialChanged = decode(module, name, contents)?;
            vec![
                set_nx(K_CONFIG.into(), "$", json!({ "dials": {}, "classes": {} })),
                set(K_CONFIG.into(), &mpath("$.dials", &e.dial), json!(e.value)),
            ]
        }
        ("config", "ClassRowSet") => {
            let e: ClassRowSet = decode(module, name, contents)?;
            vec![
                set_nx(K_CONFIG.into(), "$", json!({ "dials": {}, "classes": {} })),
                set(
                    K_CONFIG.into(),
                    &mpath("$.classes", &e.class_id.to_string()),
                    json!({
                        "base_hp": e.base_hp, "base_ap": e.base_ap, "base_mp": e.base_mp,
                    }),
                ),
            ]
        }

        // ── dungeon runs (the bound RunPass timeline, keyed by owner) ──────────
        // Serves `/v1/dungeon-runs?owner=` — a player's ACTIVE runs (the resume
        // set). The pass is consumed (object DELETED) on end, so RunEnded drops the
        // doc + owner-index entry; since RunEnded carries `player`, the SREM is
        // exact — no monotonic index wart (unlike the fight/result terminals).
        ("dungeon_events", "RunActivated") => {
            let e: RunActivated = decode(module, name, contents)?;
            let pass = e.pass.to_canonical_string(true);
            let player = e.player.to_string();
            vec![
                set(
                    k_run(&pass),
                    "$",
                    json!({
                        "pass": pass, "world": e.world.to_canonical_string(true),
                        "player": player, "character": e.character.to_canonical_string(true),
                        "status": "active", "room": 1, "fight": Value::Null,
                    }),
                ),
                sadd(k_runs(&player), pass),
            ]
        }
        ("dungeon_events", "PassEnteredFight") => {
            let e: PassEnteredFight = decode(module, name, contents)?;
            let pass = e.pass.to_canonical_string(true);
            let key = k_run(&pass);
            vec![
                // The explicit character write also backfills a doc whose activation
                // predates the indexer's retained checkpoint window.
                set_nx(
                    key.clone(),
                    "$",
                    json!({
                        "pass": pass, "world": e.world.to_canonical_string(true),
                        "player": e.player.to_string(), "status": "active",
                    }),
                ),
                set(
                    key.clone(),
                    "$.character",
                    json!(e.character.to_canonical_string(true)),
                ),
                set(
                    key.clone(),
                    "$.fight",
                    json!(e.fight.to_canonical_string(true)),
                ),
                set(key, "$.room", json!(e.room)),
            ]
        }
        ("dungeon_events", "RunAdvanced") => {
            let e: RunAdvanced = decode(module, name, contents)?;
            let pass = e.pass.to_canonical_string(true);
            let key = k_run(&pass);
            vec![
                set_nx(
                    key.clone(),
                    "$",
                    json!({
                        "pass": pass, "world": e.world.to_canonical_string(true),
                        "player": e.player.to_string(), "status": "active",
                    }),
                ),
                set(
                    key.clone(),
                    "$.character",
                    json!(e.character.to_canonical_string(true)),
                ),
                set(key.clone(), "$.room", json!(e.room)),
                set(key, "$.fight", Value::Null),
            ]
        }
        ("dungeon_events", "RunEnded") => {
            let e: RunEnded = decode(module, name, contents)?;
            let pass = e.pass.to_canonical_string(true);
            vec![
                del(k_run(&pass), "$"),
                srem(k_runs(&e.player.to_string()), pass),
            ]
        }

        // ── kolizeum lobby status (aresrpg_kolizeum::kolizeum_events) ─────────────────────────────────
        ("kolizeum_events", "KolizeumCreated") => {
            let e: KolizeumCreated = decode(module, name, contents)?;
            let kz = e.kolizeum.to_canonical_string(true);
            vec![
                set(
                    k_kolizeum(&kz),
                    "$",
                    json!({
                        "kolizeum": kz, "creator": e.creator.to_string(),
                        "format_slots": e.format_slots, "pledge_mist": e.pledge_amount.to_string(),
                        "is_public": e.is_public, "status": "open",
                    }),
                ),
                sadd(K_KOLIZEUMS.into(), kz),
            ]
        }
        ("kolizeum_events", "KolizeumStarted") => {
            let e: KolizeumStarted = decode(module, name, contents)?;
            let kz = k_kolizeum(&e.kolizeum.to_canonical_string(true));
            vec![
                set(kz.clone(), "$.status", json!("started")),
                set(kz.clone(), "$.side_a", json!(e.side_a)),
                set(kz, "$.side_b", json!(e.side_b)),
            ]
        }
        ("kolizeum_events", "KolizeumSettled") => {
            let e: KolizeumSettled = decode(module, name, contents)?;
            let kz = k_kolizeum(&e.kolizeum.to_canonical_string(true));
            vec![
                set(kz.clone(), "$.status", json!("settled")),
                set(kz.clone(), "$.winning_side", json!(e.winning_side)),
                set(kz.clone(), "$.pot_mist", json!(e.pot.to_string())),
                set(kz, "$.winners", json!(e.winners)),
            ]
        }
        ("kolizeum_events", "KolizeumCancelled") => {
            let e: KolizeumCancelled = decode(module, name, contents)?;
            let kz = k_kolizeum(&e.kolizeum.to_canonical_string(true));
            vec![
                set(kz.clone(), "$.status", json!("cancelled")),
                set(kz, "$.refunded_mist", json!(e.refunded_total.to_string())),
            ]
        }
        ("kolizeum_events", "KolizeumDrawn") => {
            let e: KolizeumDrawn = decode(module, name, contents)?;
            let kz = k_kolizeum(&e.kolizeum.to_canonical_string(true));
            vec![
                set(kz.clone(), "$.status", json!("drawn")),
                set(kz, "$.refunded_mist", json!(e.refunded_total.to_string())),
            ]
        }
        ("kolizeum_events", "KolizeumSwept") => {
            let e: KolizeumSwept = decode(module, name, contents)?;
            let id = e.kolizeum.to_canonical_string(true);
            vec![del(k_kolizeum(&id), "$"), srem(K_KOLIZEUMS.into(), id)]
        }

        // ── fights: the shared Fight object (aresrpg_fight::fight_events) ──────
        // Existence · lifecycle status · roster · turn cursor · board anchor — the
        // resync PRIMITIVE. The live per-combatant board is object/DF state (never
        // emitted); it rides the presence layer + client sim replay. See
        // HANDLERS.md for the full map + the deferred events.
        ("fight_events", "FightCreated") => {
            let e: FightCreated = decode(module, name, contents)?;
            let fight = e.fight.to_canonical_string(true);
            let world = e.world.to_canonical_string(true);
            vec![
                set(
                    k_fight(&fight),
                    "$",
                    json!({
                        "fight": fight, "world": world, "spawn_id": e.spawn_id.to_string(),
                        "anchor_x": e.anchor_x, "anchor_z": e.anchor_z,
                        "public_fight": e.public_fight, "aged_bp": e.aged_bp, "mob_count": e.mob_count,
                        "status": "placement", "participants": {}, "current_turn": Value::Null,
                    }),
                ),
                sadd(k_fights(&world), fight),
            ]
        }
        ("fight_events", "FightJoined") => {
            let e: FightJoined = decode(module, name, contents)?;
            let fight = e.fight.to_canonical_string(true);
            let character = e.character.to_canonical_string(true);
            let key = k_fight(&fight);
            vec![
                // NX skeleton so a (pathological) out-of-order join still has a map.
                set_nx(
                    key.clone(),
                    "$",
                    json!({ "fight": fight.clone(), "participants": {} }),
                ),
                set(
                    key,
                    &mpath("$.participants", &character),
                    json!({ "seat": e.seat, "state": "active" }),
                ),
                set(k_char_fight(&character), "$", json!(fight)),
            ]
        }
        ("fight_events", "TurnStarted") => {
            let e: TurnStarted = decode(module, name, contents)?;
            let key = k_fight(&e.fight.to_canonical_string(true));
            vec![
                set(key.clone(), "$.status", json!("active")),
                set(
                    key,
                    "$.current_turn",
                    json!({
                        "is_mob": e.is_mob, "idx": e.idx, "deadline_ms": e.deadline_ms,
                    }),
                ),
            ]
        }
        // A MOB repositioned — store its LATEST cell on the fight doc (`$.mob_positions[idx]`).
        // Unlike the player `Moved` (deferred — presence carries it), a mob has no p2p
        // broadcaster, so this chain event is the ONLY source; projected onto the resync
        // primitive (not a new stream). `$.mob_positions` is NX-init'd here (absent from the
        // FightCreated skeleton) so the arm is self-contained on a pre-created OR fresh doc.
        ("fight_events", "MobMoved") => {
            let e: MobMoved = decode(module, name, contents)?;
            let f = e.fight.to_canonical_string(true);
            let key = k_fight(&f);
            vec![
                set_nx(key.clone(), "$", json!({ "fight": f, "mob_positions": {} })),
                set_nx(key.clone(), "$.mob_positions", json!({})),
                set(
                    key,
                    &mpath("$.mob_positions", &e.idx.to_string()),
                    json!(e.to_cell),
                ),
            ]
        }
        // Preserve the historical seat while making its liveness honest. The
        // char→fight pointer remains a locator; the API derives membership from
        // this participant state instead of maintaining a second liveness flag.
        ("fight_events", "Abandoned") => {
            let e: Abandoned = decode(module, name, contents)?;
            let fight = e.fight.to_canonical_string(true);
            let character = e.character.to_canonical_string(true);
            vec![set(
                k_fight(&fight),
                &mpath("$.participants", &character),
                json!({ "seat": e.seat, "state": "left" }),
            )]
        }
        ("fight_events", "Victory") => {
            let e: FightVictory = decode(module, name, contents)?;
            vec![set(
                k_fight(&e.fight.to_canonical_string(true)),
                "$.status",
                json!("victory"),
            )]
        }
        ("fight_events", "Defeat") => {
            let e: FightDefeat = decode(module, name, contents)?;
            vec![set(
                k_fight(&e.fight.to_canonical_string(true)),
                "$.status",
                json!("defeat"),
            )]
        }
        // Settled + Swept both DESTROY the shared Fight on-chain — mirror the delete.
        ("fight_events", "Settled") => {
            let e: FightSettled = decode(module, name, contents)?;
            vec![del(k_fight(&e.fight.to_canonical_string(true)), "$")]
        }
        ("fight_events", "Swept") => {
            let e: FightSwept = decode(module, name, contents)?;
            vec![del(k_fight(&e.fight.to_canonical_string(true)), "$")]
        }

        // ── fight results: soulbound settled outcomes, keyed by owner ──────────
        ("fight_events", "ResultMinted") => {
            let e: ResultMinted = decode(module, name, contents)?;
            let result = e.result.to_canonical_string(true);
            let owner = e.owner.to_string();
            vec![
                set(
                    k_result(&result),
                    "$",
                    json!({
                        "result": result.clone(), "fight": e.fight.to_canonical_string(true),
                        "character": e.character.to_canonical_string(true), "owner": owner.clone(),
                        "outcome": outcome_str(e.outcome), "xp_share": e.xp_share,
                        "final_hp": e.final_hp, "opened": false, "loot_units": 0,
                    }),
                ),
                sadd(k_results(&owner), result),
            ]
        }
        // CREATE arm, not a patch: `results::open` CONSUMES the engine FightOutcome
        // (the id `ResultMinted` carried) and mints a NEW core FightResult — THIS id.
        // The two id families never overlap (proven on-chain 2026-07-10), so patching
        // `$.opened` on this id would target a root that never exists (it wedged the
        // sequential committer). `open` is possession-gated, so the tx sender IS the
        // owner. Known gap: no event links outcome→ticket ids, so the outcome doc
        // stays `opened:false` behind — the view's drop-missing strategy does not
        // cover it (documented in HANDLERS.md).
        ("results", "ResultOpened") => {
            let e: ResultOpened = decode(module, name, contents)?;
            let result = e.result.to_canonical_string(true);
            vec![
                set(
                    k_result(&result),
                    "$",
                    json!({
                        "result": result.clone(), "fight": Value::Null,
                        "character": e.character.to_canonical_string(true), "owner": sender,
                        "outcome": Value::Null, "xp_share": e.xp_share, "final_hp": Value::Null,
                        "opened": true, "loot_units": e.loot_units,
                    }),
                ),
                sadd(k_results(sender), result),
            ]
        }
        ("results", "ResultBurned") => {
            let e: ResultBurned = decode(module, name, contents)?;
            vec![del(k_result(&e.result.to_canonical_string(true)), "$")]
        }

        // ── commission: artisan-commission v2 lifecycle (aresrpg::commission) ──
        // `request` seeds the shared CraftRequest doc + indexes it under BOTH parties (the
        // artisan sees requests offered TO them, the customer their own asks). `accept`
        // marks it accepted + records the artisan's proven level/character. `execute` and
        // `cancel` both DELETE the doc and — since BOTH now carry customer AND artisan —
        // un-index EXACTLY under both parties (the v1 cancel's artisan-index wart is gone).
        // `CraftXpRedeemed` (the artisan banks their XP voucher) is craft-activity → object/
        // DF state (job xp) and stays DEFERRED, like Crafted/RecipeCreated (see below).
        ("commission", "CraftRequested") => {
            let e: CraftRequested = decode(module, name, contents)?;
            let id = e.request.to_canonical_string(true);
            let customer = e.customer.to_string();
            let artisan = e.artisan.to_string();
            vec![
                set(
                    k_commission(&id),
                    "$",
                    json!({
                        "commission": id, "customer": customer, "artisan": artisan,
                        "recipe": e.recipe.to_canonical_string(true),
                        "amount_mist": e.amount.to_string(), "accepted": false, "requested_at_ms": ts_ms,
                    }),
                ),
                sadd(k_commissions_by_artisan(&artisan), id.clone()),
                sadd(k_commissions_by_customer(&customer), id),
            ]
        }
        ("commission", "CraftAccepted") => {
            let e: CraftAccepted = decode(module, name, contents)?;
            let key = k_commission(&e.request.to_canonical_string(true));
            vec![
                set(key.clone(), "$.accepted", json!(true)),
                set(key.clone(), "$.artisan_level", json!(e.artisan_level)),
                set(
                    key,
                    "$.artisan_character",
                    json!(e.artisan_character.to_canonical_string(true)),
                ),
            ]
        }
        ("commission", "CraftExecuted") => {
            let e: CraftExecuted = decode(module, name, contents)?;
            let id = e.request.to_canonical_string(true);
            vec![
                del(k_commission(&id), "$"),
                srem(k_commissions_by_artisan(&e.artisan.to_string()), id.clone()),
                srem(k_commissions_by_customer(&e.customer.to_string()), id),
            ]
        }
        ("commission", "CraftCancelled") => {
            let e: CraftCancelled = decode(module, name, contents)?;
            let id = e.request.to_canonical_string(true);
            vec![
                del(k_commission(&id), "$"),
                srem(k_commissions_by_artisan(&e.artisan.to_string()), id.clone()),
                srem(k_commissions_by_customer(&e.customer.to_string()), id),
            ]
        }

        // ── native Sui kiosk → marketplace listings ───────────────────────────
        // Category/level are joined at READ time by the /v1/listings view from the
        // item doc (map is pure — it cannot read Redis). Seller = tx sender.
        ("kiosk", "ItemListed") => {
            let e: KioskItemListed = decode(module, name, contents)?;
            let item = e.id.to_canonical_string(true);
            let kiosk = e.kiosk.to_canonical_string(true);
            vec![
                set(
                    k_listing(&item),
                    "$",
                    json!({
                        "item_id": &item, "kiosk": &kiosk,
                        "price_mist": e.price.to_string(), "seller": sender,
                    }),
                ),
                sadd(K_LISTINGS.into(), item),
                // Durable seller→kiosk directory: the purchase event carries the kiosk
                // but not the seller, and it DELETES the listing — so bind the edge here
                // (lister = seller) so sales-history can resolve `?seller=` → kiosk(s).
                sadd(k_seller_kiosks(sender), kiosk),
            ]
        }
        // A realised sale: drop the consumed listing (unchanged) AND append the row to
        // the seller's per-kiosk sales log. The extraction seam also emits this native
        // event as a same-tx ItemListed(0) → ItemPurchased(0) pair without a royalty
        // receipt. That internal exit gets an exact ZREM so replay deletes legacy
        // phantoms. Standalone zero-price and receipted zero-price purchases stay sales.
        // An `ItemEquipped`/`ItemBurned` for the SAME item id in this tx is the AUTHORITATIVE
        // "left the kiosk to be worn/destroyed, not bought" proof — it excludes the sale on its
        // own, even when the paired transient ItemListed(0) is absent (avoids phantom
        // "SOLD FOR 0 SUI" rows on equip). A genuine buy→equip keeps `price > 0` so it still sells.
        ("kiosk", "ItemPurchased") => {
            let e: KioskItemListed = decode(module, name, contents)?;
            let item = e.id.to_canonical_string(true);
            let sales_key = k_sales(&e.kiosk.to_canonical_string(true));
            let row = json!({
                "item": &item, "price_mist": e.price.to_string(),
                "buyer": sender, "ts": ts_ms,
            })
            .to_string();
            let mut writes = vec![del(k_listing(&item), "$"), srem(K_LISTINGS.into(), item)];
            let realised_sale = e.price > 0
                || (!purchase.confirmed_extract_exit
                    && (!purchase.transient_zero_listing || purchase.has_royalty_receipt));
            if realised_sale {
                writes.extend([
                    zadd(sales_key.clone(), ts_ms as i64, row),
                    zrem_rank_keep_newest(sales_key.clone(), SALES_CAP),
                    expire(sales_key, SALES_TTL_SECS),
                ]);
            } else {
                // Replay self-heal: byte-identical to the member the old arm added.
                writes.push(zrem(sales_key, row));
            }
            writes
        }
        ("kiosk", "ItemDelisted") => {
            let e: KioskItemDelisted = decode(module, name, contents)?;
            let item = e.id.to_canonical_string(true);
            vec![del(k_listing(&item), "$"), srem(K_LISTINGS.into(), item)]
        }

        // Recognised-but-deferred (object/DF state) or foreign — NOT indexed.
        // The CRAFT/PET-ANALYTICS/RUNES/GATHER verbs (aresrpg_game::{crafting::{Crafted,
        // RecipeCreated}, pet::PetFed, runes::{GearCrushed,
        // GearScribed,CrushOutputSet}, gathering::{ResourceGathered,
        // RareGathered}} + commission::CraftXpRedeemed) are ACTIVITY events whose durable
        // result is object/DF state — the minted output item (already indexed via
        // items::item::ItemMinted; the §6 jackpot's rare unit mints through the SAME
        // door, so RareGathered mirrors ResourceGathered's deferral), accrued
        // job-xp / rune inventory.
        // That state is the same object-snapshot class as character level /
        // progression (no event carries it); §14 defines no activity-feed view and
        // no consumer keys one, so per "document the gap, never invent" they stay
        // deferred (see HANDLERS.md). Also deferred: WorldUpdated, ItemMerged/Split,
        // *PolicyCreated, catalog, BandSet, Kolizeum Joined/Exited/OutcomeOpened,
        // and the version liveness pair (EnabledSet/VersionBumped): its rpc:package:*
        // projection had ZERO /v1 consumers, so it was deleted (janitor law, 2026-07-13).
        // NB the fight granular board/turn events (Placed/Ready/Moved/Cast/Hit/TurnEnded/…)
        // are not projected to the fight DOC here, but they ARE captured — `mod.rs::process`
        // appends each to its per-fight ordered JOURNAL (`journal.rs`), the observer-replay
        // transport (#216). `ActionStarted`/`ActionEffect`/`ActionResolved` + `LootMinted`
        // stay deferred from the journal too (see `journal::decode_journal_event`).
        _ => return None,
    })
}

/// Replay a batch of writes against Redis, in order (the handler's only I/O).
///
/// The whole batch rides ONE non-transactional pipeline — a single round trip
/// instead of N (the win is re-index/backfill, where every projected write paid
/// its own RTT) — while keeping the sequential committer's per-write semantics:
/// replies are inspected per command, so a sub-path JSON.SET onto a missing
/// root still SKIDS (warn + drop), a NUMINCRBY onto an absent path is still a
/// tolerated no-op, and every other error reply still fails the batch
/// (retryable class; writes are idempotent upserts, so the retry re-running
/// already-applied commands converges — same as the old mid-batch abort).
pub async fn execute(writes: &[RedisWrite], conn: &mut MultiplexedConnection) -> Result<()> {
    if writes.is_empty() {
        return Ok(());
    }
    let mut pipe = redis::pipe();
    for w in writes {
        match w {
            RedisWrite::Set {
                key,
                path,
                json,
                nx,
            } => {
                pipe.cmd("JSON.SET").arg(key).arg(path).arg(json);
                if *nx {
                    pipe.arg("NX");
                }
            }
            RedisWrite::Del { key, path } => {
                pipe.cmd("JSON.DEL").arg(key).arg(path);
            }
            RedisWrite::NumIncrBy { key, path, by } => {
                pipe.cmd("JSON.NUMINCRBY").arg(key).arg(path).arg(*by);
            }
            RedisWrite::SetAdd { key, member } => {
                pipe.cmd("SADD").arg(key).arg(member);
            }
            RedisWrite::SetDel { key, member } => {
                pipe.cmd("SREM").arg(key).arg(member);
            }
            RedisWrite::ZAdd { key, score, member } => {
                pipe.cmd("ZADD").arg(key).arg(*score).arg(member);
            }
            RedisWrite::ZRem { key, member } => {
                pipe.cmd("ZREM").arg(key).arg(member);
            }
            RedisWrite::ZRemRangeByRank { key, start, stop } => {
                pipe.cmd("ZREMRANGEBYRANK").arg(key).arg(*start).arg(*stop);
            }
            RedisWrite::ZRemRangeByScore { key, min, max } => {
                pipe.cmd("ZREMRANGEBYSCORE").arg(key).arg(*min).arg(*max);
            }
            RedisWrite::Expire { key, seconds } => {
                pipe.cmd("EXPIRE").arg(key).arg(*seconds);
            }
            RedisWrite::PartyCreate {
                party: party_id,
                character,
                owner,
            } => {
                pipe.cmd("EVAL")
                    .arg(party::LUA_REDUCE)
                    .arg(2)
                    .arg(party::party_key(party_id))
                    .arg(party::character_party_key(character))
                    .arg("create")
                    .arg(party_id)
                    .arg(character)
                    .arg(owner);
            }
            RedisWrite::PartyJoin {
                party: party_id,
                character,
                owner,
            } => {
                pipe.cmd("EVAL")
                    .arg(party::LUA_REDUCE)
                    .arg(2)
                    .arg(party::party_key(party_id))
                    .arg(party::character_party_key(character))
                    .arg("join")
                    .arg(party_id)
                    .arg(character)
                    .arg(owner);
            }
            RedisWrite::PartyLeave {
                party: party_id,
                character,
                owner,
            } => {
                pipe.cmd("EVAL")
                    .arg(party::LUA_REDUCE)
                    .arg(2)
                    .arg(party::party_key(party_id))
                    .arg(party::character_party_key(character))
                    .arg("leave")
                    .arg(party_id)
                    .arg(character)
                    .arg(owner);
            }
            RedisWrite::PartyPending {
                party: party_id,
                invites,
            } => {
                pipe.cmd("EVAL")
                    .arg(party::LUA_PENDING)
                    .arg(1)
                    .arg(party::party_invites_key(party_id))
                    .arg(party_id)
                    .arg(serde_json::to_string(invites).unwrap_or_else(|_| "[]".to_string()));
            }
        }
    }
    // RAW per-command replies, NOT `Pipeline::query_async` — that path runs
    // `extract_error` over the reply vec and aborts the whole result on the
    // FIRST error reply, which would turn every skid back into a wedge. The
    // trait method hands back each command's `Value` untouched (error replies
    // arrive as `Value::ServerError`); connection-level failures (I/O) still
    // error here and fail the batch, exactly like the sequential version.
    let replies = conn
        .req_packed_commands(&pipe, 0, writes.len())
        .await
        .context("redis pipeline")?;
    for (w, reply) in writes.iter().zip(replies) {
        let redis::Value::ServerError(server_err) = reply else {
            continue;
        };
        let err = redis::RedisError::from(server_err);
        match w {
            RedisWrite::Set { key, path, .. } => {
                // A sub-path SET whose root doc is missing is a SEMANTIC miss
                // (RedisJSON: "new objects must be created at the root") that no
                // retry can fix — and the committer retries the batch forever, so
                // propagating it WEDGES the whole pipeline (measured 2026-07-10
                // on a rpc:result `$.opened` patch). SKID instead: warn + drop
                // the one write. Root-doc SETs and I/O errors still fail the
                // batch (that class is retryable).
                if path.as_str() != "$" && err.kind() == redis::ErrorKind::ResponseError {
                    tracing::warn!(%key, %path, error = %err, "JSON.SET sub-path onto missing root — write dropped (skid, not wedge)");
                } else {
                    return Err(err).with_context(|| format!("JSON.SET {key} {path}"));
                }
            }
            // NUMINCRBY errors if the path is absent (e.g. a claim before the
            // zone was ever searched by this indexer) — tolerate that as a
            // no-op rather than failing the whole batch.
            RedisWrite::NumIncrBy { .. } => {}
            RedisWrite::Del { key, path } => {
                return Err(err).with_context(|| format!("JSON.DEL {key} {path}"));
            }
            RedisWrite::SetAdd { key, .. } => {
                return Err(err).with_context(|| format!("SADD {key}"));
            }
            RedisWrite::SetDel { key, .. } => {
                return Err(err).with_context(|| format!("SREM {key}"));
            }
            RedisWrite::ZAdd { key, .. } => {
                return Err(err).with_context(|| format!("ZADD {key}"));
            }
            RedisWrite::ZRem { key, .. } => {
                return Err(err).with_context(|| format!("ZREM {key}"));
            }
            RedisWrite::ZRemRangeByRank { key, .. } => {
                return Err(err).with_context(|| format!("ZREMRANGEBYRANK {key}"));
            }
            RedisWrite::ZRemRangeByScore { key, .. } => {
                return Err(err).with_context(|| format!("ZREMRANGEBYSCORE {key}"));
            }
            RedisWrite::Expire { key, .. } => {
                return Err(err).with_context(|| format!("EXPIRE {key}"));
            }
            RedisWrite::PartyCreate { party, .. }
            | RedisWrite::PartyJoin { party, .. }
            | RedisWrite::PartyLeave { party, .. }
            | RedisWrite::PartyPending { party, .. } => {
                return Err(err).with_context(|| format!("Party reducer {party}"));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
