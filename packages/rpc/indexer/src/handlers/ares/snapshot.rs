// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! AresRPG object-snapshot + taux projection — the S-15c read-model slice.
//!
//! A SEPARATE sequential pipeline (`ares_snapshot`, its own watermark) from the
//! main `ares` event pipeline. Two data sources, both needing a fresh backfill
//! from `FIRST_CHECKPOINT` (the main pipeline's watermark is already at the tip, so
//! adding these there would only capture NEW checkpoints — the framework's per-
//! pipeline watermark is the intended "add a projection later" seam):
//!
//!  1. **Character state snapshots** — the chain-ratified cosmetics (`male` +
//!     colours) and initial `experience`/`level` come from the Character object;
//!     the live progression dynamic field supersedes those progression values after
//!     fights. NO event carries this state, so world-presence rendering of OTHER
//!     players needs the objects (else they draw as default dolls or stale levels).
//!     Latest-wins by checkpoint order (idempotent `JSON.SET`, same as the event projections).
//!  2. **Taux (forgemagie) events** — the CrushBoard's per-template inflation
//!     coefficients. The rows are `Table` dynamic fields (invisible in the object's
//!     own BCS contents), and `Crushed`/`BoardCreated` are designed so the
//!     coefficients are derivable from events alone — so taux is EVENT-projected
//!     here (not object-snapshotted, not lazy-read).
//!
//! Pure decode/project (`map_character_object` / `map_taux_event` are unit-tested
//! offline), thin I/O (reuses `project::execute`).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use serde::Serialize;
use serde_json::json;
use sui_indexer_alt_framework::pipeline::{sequential::Handler, Processor};
use sui_indexer_alt_framework::store::Store;
use sui_indexer_alt_framework::types::base_types::{ObjectID, SuiAddress};
use sui_indexer_alt_framework::types::effects::TransactionEffectsAPI;
use sui_indexer_alt_framework::types::TypeTag;
use sui_indexer_alt_framework::types::full_checkpoint_content::Checkpoint;
use sui_indexer_alt_framework::types::object::Owner;
use tracing::debug;

use super::model::{
    BoardCreated, CharacterObject, Crushed, EquippedItemField, FightOutcomeObject, ItemObject, ItemTemplateObject,
    JobXpField, KioskItemListed, PersonalKioskCapObject, PetBoxClaimObject, PoolBuy, PoolSell, ProgressionField,
    RecipeObject, RecipelessSet, SaleBought, ZoneField, ZoneGroupRootField,
};
use super::project::{
    self, char_init, del, k_character, k_item, k_lastsale, k_template, k_world, k_zone, k_zones, mpath, sadd,
    set, set_nx, zadd, zrem, zrem_rank_keep_newest, RedisWrite, K_TEMPLATES, K_WORLDS,
};
use super::xp_curve::level_from_xp;
use crate::store::RedisStore;

/// The Move module that owns the character object type + the taux events.
const CHARACTER_MODULE: &str = "character";
const CHARACTER_TYPE: &str = "Character";
const FORGEMAGIE_MODULE: &str = "forgemagie";
/// `aresrpg::item::ItemTemplate` + `aresrpg::mob_template::MobTemplate` — the §14
/// encyclopedia authoring blueprints whose name/level (and mob element/hp) live ONLY
/// in the object, not the mint event. Snapshotted here for the same reason as the
/// Character cosmetics (no event carries them).
const ITEM_MODULE: &str = "item";
const ITEM_TYPE: &str = "Item";
const ITEM_TEMPLATE_TYPE: &str = "ItemTemplate";
/// `kiosk::personal_kiosk::PersonalKioskCap` — the mysten non-transferable kiosk-owner cap.
/// Like `0x2::dynamic_field::Field` below, it is framework-adjacent (NOT an AresRPG package),
/// so it is matched by `(module, name)` and EXEMPTED from the AresRPG package allowlist — it
/// carries the wallet↔kiosk edge an owner-items read joins through.
const PERSONAL_KIOSK_MODULE: &str = "personal_kiosk";
const PERSONAL_KIOSK_CAP_TYPE: &str = "PersonalKioskCap";
const MOB_TEMPLATE_MODULE: &str = "mob_template";
const MOB_TEMPLATE_TYPE: &str = "MobTemplate";
/// `aresrpg::crafting::Recipe` — the §14 encyclopedia crafting blueprint. The shared object
/// carries the FULL recipe truth (ingredient list + output + job/level/xp); the `RecipeCreated`
/// EVENT carries only counts, so the encyclopedia's recipe view snapshots the object, exactly
/// like ItemTemplate/MobTemplate above. Create-only: crafting.move has no update/burn door.
const CRAFTING_MODULE: &str = "crafting";
const RECIPE_TYPE: &str = "Recipe";
/// The engine's soulbound settled outcome (`aresrpg_fight::settlement::FightOutcome`) —
/// created (address-owned) at settle, DELETED at `results::open`. The pending-outcomes
/// projection mirrors both edges from checkpoint object create/delete.
const SETTLEMENT_MODULE: &str = "settlement";
const FIGHT_OUTCOME_TYPE: &str = "FightOutcome";
/// Native Sui dynamic-OBJECT-field wrapper (`0x2::dynamic_field::Field`). A kiosk-locked
/// object's checkpoint owner is `ObjectOwner(<this wrapper>)`, and the wrapper's OWN
/// owner is `ObjectOwner(<kiosk>)` — the two-hop the generic kiosk discovery resolves.
const DYNAMIC_FIELD_MODULE: &str = "dynamic_field";
const DYNAMIC_FIELD_TYPE: &str = "Field";
/// The AresRPG namespaced DF-key envelope (`aresrpg::extension::NsKey<K>`) + the per-job xp key
/// (`aresrpg::character_link::JobXpKey`) it wraps — the type parameters that identify a job-xp
/// dynamic field among the (byte-identical) NS_CHARACTER_WORLD `{u8} -> u64` fields. See
/// [`is_job_xp_key`].
const EXTENSION_MODULE: &str = "extension";
const NS_KEY_TYPE: &str = "NsKey";
const CHARACTER_LINK_MODULE: &str = "character_link";
const JOB_XP_KEY_TYPE: &str = "JobXpKey";
/// The live-progression DF key (`aresrpg::character_link::ProgressionKey`) — the block that carries
/// the RAW current HP + regen stamp T76 party-frame HP bars project (`is_progression_key`).
const PROGRESSION_KEY_TYPE: &str = "ProgressionKey";
/// The equipment-map DF key (`aresrpg::equipment::EquipmentKey`) — the single map whose `gear` fold
/// caches the NET GEAR vitality `character_max_hp` needs (`is_equipment_key`).
const EQUIPMENT_MODULE: &str = "equipment";
const EQUIPMENT_KEY_TYPE: &str = "EquipmentKey";
const OBJECT_MODULE: &str = "object";
const OBJECT_ID_TYPE: &str = "ID";
const NS_CHARACTER_EQUIPMENT: u8 = 1;
/// `aresrpg_game::world::World` — the shared world template whose `required_level` join gate
/// lives ONLY in the object (`set_required_level` fires a payload-less `WorldUpdated`; the
/// create event carries seed/biome only). Snapshotted so `/v1/encyclopedia` worlds serve the
/// LIVE gate instead of the `?? 1` fallback (the production "Lv 1+ on every world" 07-17 bug).
const WORLD_MODULE: &str = "world";
const WORLD_TYPE: &str = "World";
/// The per-zone derivation-state DF key (`aresrpg::zones::ZoneKey`) — a PLAIN struct key (NOT wrapped
/// in `NsKey`), attached to the WORLD's UID, carrying the seed + consumed bitmaps (`is_zone_key`).
const ZONES_MODULE: &str = "zones";
const ZONE_KEY_TYPE: &str = "ZoneKey";
/// The per-zone mob-group COMMITMENT DF key (`aresrpg::zones::ZoneGroupRootKey`) — the fight-create
/// compute diet's search-committed Blake2b group root + count (`is_group_root_key`), a sibling plain
/// struct key on the SAME World UID.
const ZONE_GROUP_ROOT_KEY_TYPE: &str = "ZoneGroupRootKey";
/// `aresrpg::loot_box` — the soulbound `PetBoxClaim` an `open_box` roll mints and `claim_pet`
/// consumes+deletes. Same package allowlist as `character`/`item` (core `aresrpg`), so no new
/// allowlist entry: matched by (module, name) like every other arm here.
const LOOT_BOX_MODULE: &str = "loot_box";
const PET_BOX_CLAIM_TYPE: &str = "PetBoxClaim";
/// The three SALE venues feeding the per-template last-sale price (marketcap): the primary shop
/// (`shop::SaleBought` — per-unit `price` direct), the AMM pools (`pool::PoolBuy`/`PoolSell` —
/// per-unit = total / quantity), and the native kiosk marketplace (`0x2::kiosk::ItemPurchased` —
/// whole-item price; template + stack units resolved from the SAME TX's Item output object, and
/// price==0 SKIPPED: the extract seam runs a zero-price list+purchase for every equip / burn /
/// merge, which would otherwise stamp every touched template's last sale to 0 constantly).
/// All three land on ONE key from THIS one sequential pipeline — see project.rs `k_lastsale`.
const SHOP_MODULE: &str = "shop";
const POOL_MODULE: &str = "pool";
const KIOSK_MODULE: &str = "kiosk";
/// The Sui framework package (`0x2`) in canonical form — the ONLY package whose
/// `kiosk::ItemPurchased` is admitted (allowlist-exempt but address-PINNED, unlike the
/// match-by-name-only arms: a look-alike foreign "kiosk" module must never stamp prices).
const SUI_FRAMEWORK_PKG: &str = "0x0000000000000000000000000000000000000000000000000000000000000002";

// ── taux key builders (the CONTRACT the JS `/v1/taux` view mirrors) ───────────
fn k_taux(template: &str) -> String { format!("rpc:taux:{template}") }
const K_TAUX_IDX: &str = "rpc:idx:taux";
fn k_taux_bracket(bracket: u64) -> String { format!("rpc:taux:bracket:{bracket}") }
const K_TAUX_META: &str = "rpc:taux_meta";

// ── mob-template key builders (the CONTRACT the JS `/v1/encyclopedia` view mirrors) ─
fn k_mob_template(id: &str) -> String { format!("rpc:mob_template:{id}") }
const K_MOB_TEMPLATES: &str = "rpc:idx:mob_templates";

// ── recipe key builders (the CONTRACT the JS `/v1/encyclopedia` view mirrors) ────────
fn k_recipe(id: &str) -> String { format!("rpc:recipe:{id}") }
const K_RECIPES: &str = "rpc:idx:recipes";

// ── owner-items key builders (the CONTRACT the JS `/v1/owner-items` view mirrors) ────
// The bag is a two-hop join: `owner_kiosks` (a wallet's personal kiosks, from PersonalKioskCap
// ownership) × `kiosk_items` (each kiosk's item ids, SADD'd as Items resolve into it). The
// per-kiosk doc carries the cap id (the client threads `kiosk_cap_id` onto every row). The
// `kiosk_items` sets are MONOTONIC (an item that moves/burns lingers in its old set); the read
// reconciles each row against the item doc's LIVE `kiosk_id`, so stale membership is harmless.
fn k_owner_kiosks(owner: &str) -> String { format!("rpc:idx:owner_kiosks:{owner}") }
fn k_kiosk(kiosk: &str) -> String { format!("rpc:kiosk:{kiosk}") }
fn k_kiosk_items(kiosk: &str) -> String { format!("rpc:idx:kiosk_items:{kiosk}") }

// ── pending-outcome key builders (the CONTRACT the JS `/v1/pending-outcomes` view mirrors) ─
// Per-owner index is a SORTED set (score = checkpoint ts, member = outcome id) so it caps
// by recency; the per-outcome doc carries the view's frozen fields. Both created on outcome
// create, both dropped on outcome delete (exact self-clean — the owning address rides the object).
fn k_pending_outcome(id: &str) -> String { format!("rpc:pending_outcome:{id}") }
fn k_pending_outcomes(owner: &str) -> String { format!("rpc:idx:pending_outcomes:{owner}") }
/// Defensive per-owner cap: a griefer can mint many owned outcomes, but each costs them
/// on-chain storage and is normally opened (→ deleted → self-cleaned). 100 bounds the
/// index; an outcome that ages past the cap still self-cleans its doc on delete (the delete
/// DELs by id regardless of index membership), so no doc orphans in normal operation.
const PENDING_CAP: i64 = 100;

// ── pet-claim key builder (the CONTRACT the JS `/v1/pet-claims` view mirrors) ─
// ONE doc per owner — `$.claims["<claim_id>"] = "<rolled_template>"` — mirrors the `$.jobs`/
// `$.equipment` map-keyed idiom (`map_job_xp_field`/project.rs `ItemEquipped`): an id-keyed
// sub-object, not a literal JSON array. No existing `RedisWrite` primitive removes-by-value
// from a stored array, so a map keyed by the claim's OWN id gives O(1) idempotent create
// (`JSON.SET` a sub-path) / delete (`JSON.DEL` that same sub-path) with no read-modify-write;
// unlike `pending_outcome`'s sorted-set-plus-cap, no defensive cap is needed here (a claim
// costs the opener real SUI to mint — no free-griefing vector). The `/v1/pet-claims` view
// still SERVES it as a bare array (`Object.entries` at read time).
fn k_pet_claims(owner: &str) -> String { format!("rpc:petclaims:{owner}") }

/// Snapshot one `aresrpg::character::Character` object's owner-ratified fields into
/// its character doc. `None` = the bytes did not decode as a Character (defensive —
/// never fails the batch). Sets the object-authoritative fields only; `owner`,
/// `world`, `position` and `equipment` stay event-sourced (they are not in the
/// object, or richer via events). `level` is derived from `experience` via the
/// frozen on-chain curve so the doc serves it directly. `kiosk_id` (the resolved
/// kiosk that holds this kiosk-locked character — see [`resolve_kiosk`]) is written
/// when known; `None` leaves the field absent (the view renders `null`).
pub fn map_character_object(id: &str, contents: &[u8], kiosk_id: Option<&str>) -> Option<Vec<RedisWrite>> {
    let c: CharacterObject = bcs::from_bytes(contents).ok()?;
    let key = k_character(id);
    let mut writes = vec![
        // NX skeleton so a snapshot arriving before any mint event still has a doc.
        char_init(&key, id),
        set(key.clone(), "$.name", json!(c.name)),
        set(key.clone(), "$.class", json!(c.class)),
        set(key.clone(), "$.male", json!(c.male)),
        set(
            key.clone(),
            "$.colors",
            json!({
                "color_1": c.customization.color_1,
                "color_2": c.customization.color_2,
                "color_3": c.customization.color_3,
            }),
        ),
        // GENESIS SEED ONLY (NX — P1 xp-reset-on-refresh, 2026-07-17): the base Character's
        // `experience` is frozen at mint; live XP/level are owned by the Progression-DF projection
        // (`map_progression_field`). Any `&mut Character` tx (equip, stat raise, world move…)
        // re-emits this object WITHOUT a Progression change, so a plain set here regressed
        // `$.experience`/`$.level` to genesis in every such checkpoint.
        set_nx(key.clone(), "$.experience", json!(c.experience)),
        set_nx(key.clone(), "$.level", json!(level_from_xp(c.experience))),
    ];
    // Kiosk edge (latest-wins): established at mint/place and refreshed on every trade,
    // exactly the checkpoints where the kiosk wrapper is an output object. Between them
    // the stored id stays valid.
    if let Some(kiosk) = kiosk_id {
        writes.push(set(key, "$.kiosk_id", json!(kiosk)));
    }
    Some(writes)
}

/// Is a `0x2::dynamic_field::Field`'s KEY type parameter the per-job xp key —
/// `extension::NsKey<character_link::JobXpKey>`? This (NOT the field bytes) is what discriminates
/// a job-xp field from the BYTE-IDENTICAL `StatAllocKey` field: both are `{u8} -> u64` under the
/// same NS_CHARACTER_WORLD namespace, so only the inner struct NAME differs. Matched by (module,
/// name) — stable across package upgrades (a type's defining module never moves) and the SAME
/// (module, name) trust the sibling object arms run under while the package allowlist is unset. A
/// forged look-alike cannot poison a real character: attaching a `JobXpKey` DF to a Character's UID
/// needs `&mut UID` (package-gated), so only our own package writes these. Residual hardening (like
/// the personal-kiosk cap): pin the inner `character_link` package address here when the
/// `ARES_PACKAGES` allowlist is activated for production.
fn is_job_xp_key(key_tag: &TypeTag) -> bool {
    let TypeTag::Struct(ns) = key_tag else { return false };
    if ns.module.as_str() != EXTENSION_MODULE || ns.name.as_str() != NS_KEY_TYPE {
        return false;
    }
    matches!(ns.type_params.first(), Some(TypeTag::Struct(inner))
        if inner.module.as_str() == CHARACTER_LINK_MODULE && inner.name.as_str() == JOB_XP_KEY_TYPE)
}

/// Is a `0x2::dynamic_field::Field`'s KEY type parameter the live-progression key —
/// `extension::NsKey<character_link::ProgressionKey>`? Mirrors [`is_job_xp_key`] (matched by (module,
/// name), stable across upgrades, the same match-by-name trust the sibling arms run under). Selects
/// the ONE `Progression` block from every other Character DF (job-xp / stat-alloc / world / equipment).
fn is_progression_key(key_tag: &TypeTag) -> bool {
    let TypeTag::Struct(ns) = key_tag else { return false };
    if ns.module.as_str() != EXTENSION_MODULE || ns.name.as_str() != NS_KEY_TYPE {
        return false;
    }
    matches!(ns.type_params.first(), Some(TypeTag::Struct(inner))
        if inner.module.as_str() == CHARACTER_LINK_MODULE && inner.name.as_str() == PROGRESSION_KEY_TYPE)
}

/// Is a `0x2::dynamic_field::Field`'s KEY type parameter the equipment-map key —
/// `extension::NsKey<equipment::EquipmentKey>`? Mirrors [`is_job_xp_key`]. Selects the SINGLE
/// `EquipmentMap` DF from the sibling equipped-ITEM DFs (keyed by `NsKey<0x2::object::ID>` under the
/// SAME NS_CHARACTER_EQUIPMENT namespace) — only the inner struct NAME differs.
fn is_equipment_key(key_tag: &TypeTag) -> bool {
    let TypeTag::Struct(ns) = key_tag else { return false };
    if ns.module.as_str() != EXTENSION_MODULE || ns.name.as_str() != NS_KEY_TYPE {
        return false;
    }
    matches!(ns.type_params.first(), Some(TypeTag::Struct(inner))
        if inner.module.as_str() == EQUIPMENT_MODULE && inner.name.as_str() == EQUIPMENT_KEY_TYPE)
}

/// Is a `0x2::dynamic_field::Field`'s KEY type parameter an equipped-item key —
/// `extension::NsKey<0x2::object::ID>`? These are the sibling Item fields beside the single
/// EquipmentMap. Runtime decode additionally requires namespace 1, key == Item.id, category `pet`,
/// and an `item::Item` VALUE type parameter before it can project pet identity.
fn is_equipped_item_key(key_tag: &TypeTag) -> bool {
    let TypeTag::Struct(ns) = key_tag else { return false };
    if ns.module.as_str() != EXTENSION_MODULE || ns.name.as_str() != NS_KEY_TYPE {
        return false;
    }
    matches!(ns.type_params.first(), Some(TypeTag::Struct(inner))
        if inner.module.as_str() == OBJECT_MODULE && inner.name.as_str() == OBJECT_ID_TYPE)
}

fn is_item_value(value_tag: &TypeTag) -> bool {
    matches!(value_tag, TypeTag::Struct(value)
        if value.module.as_str() == ITEM_MODULE && value.name.as_str() == ITEM_TYPE)
}

/// Is a `0x2::dynamic_field::Field`'s KEY type parameter the zone-state key — `aresrpg::zones::ZoneKey`?
/// UNLIKE the character DFs above, the zone key is a PLAIN struct (NOT wrapped in `NsKey`), so this matches
/// `zones::ZoneKey` directly (no envelope). Matched by (module, name) — stable across upgrades, the SAME
/// match-by-name trust the sibling arms run under. Attaching a `ZoneKey` DF to a World's UID needs `&mut UID`
/// (package-gated — only `zones::search_zone` does it), so only our own package writes these; a forged
/// look-alike keyed to an attacker's own object lands under a non-world parent id the client never queries.
/// Residual hardening (like the sibling arms): pin the `zones` package address when the allowlist activates.
fn is_zone_key(key_tag: &TypeTag) -> bool {
    let TypeTag::Struct(s) = key_tag else { return false };
    s.module.as_str() == ZONES_MODULE && s.name.as_str() == ZONE_KEY_TYPE
}

/// Is a `0x2::dynamic_field::Field`'s KEY type parameter the zone GROUP-ROOT commitment key —
/// `aresrpg::zones::ZoneGroupRootKey`? A sibling of [`is_zone_key`] (same `zones` module, same World
/// parent, same plain-struct-key shape — only the NAME differs), carrying the fight-create diet's
/// search-committed Blake2b root + group count. Same package-gated trust: only `zones::search_zone`
/// can attach it to a World's UID (`&mut UID`), so a forged look-alike lands under an attacker-owned
/// parent the client never queries. Residual hardening rides the same future package-address pin.
fn is_group_root_key(key_tag: &TypeTag) -> bool {
    let TypeTag::Struct(s) = key_tag else { return false };
    s.module.as_str() == ZONES_MODULE && s.name.as_str() == ZONE_GROUP_ROOT_KEY_TYPE
}

/// Project one per-job XP dynamic field onto its owner character's doc: `$.jobs["<job u8>"] =
/// <absolute total xp>`. The DF `value` IS the running total (`character_link::add_job_xp` banks
/// gather/craft/forgemagie xp), so this is an idempotent ABSOLUTE upsert — replay-safe with no
/// relative counter, mirroring the §3 stats block (`stat_allocation::StatRaised` in `project.rs`).
/// Keyed by the NUMERIC job index; the `/v1/characters` view maps index -> job slug via the SDK
/// JOBS order (exactly like stats index -> vitality/wisdom/…). `character_id` is the Field's parent
/// (its checkpoint `ObjectOwner` — the Field is attached directly to the Character's UID). `char_init`
/// seeds the doc + `$.jobs` NX-inits so a job-xp snapshot that lands before any mint event still
/// projects (latest-wins per (character, job), same as every object snapshot here).
pub fn map_job_xp_field(character_id: &str, job: u8, value: u64) -> Vec<RedisWrite> {
    let key = k_character(character_id);
    vec![
        char_init(&key, character_id),
        set_nx(key.clone(), "$.jobs", json!({})),
        set(key, &mpath("$.jobs", &job.to_string()), json!(value)),
    ]
}

/// Project a character's LIVE progression DF onto its doc: absolute fight XP/level plus the RAW stored
/// current HP and lazy-regen last-touch stamp (`$.experience` / `$.level` / `$.current_hp` /
/// `$.hp_updated_ms`). The CLIENT owns the §5.4 natural-regen projection — the indexer serves the raw
/// HP stamps ONLY (a server-side regen recompute would be the banked remainder-carry bug). Latest-wins
/// (the Progression DF re-emits on every fight hp write / heal / xp grant). `char_init` NX-seeds the doc
/// so a progression snapshot that lands before the mint event still projects, like every DF/object
/// snapshot here.
pub fn map_progression_field(
    character_id: &str,
    xp: u64,
    level: u16,
    hp: u64,
    hp_updated_ms: u64,
) -> Vec<RedisWrite> {
    let key = k_character(character_id);
    vec![
        char_init(&key, character_id),
        set(key.clone(), "$.experience", json!(xp)),
        set(key.clone(), "$.level", json!(level)),
        set(key.clone(), "$.current_hp", json!(hp)),
        set(key, "$.hp_updated_ms", json!(hp_updated_ms)),
    ]
}

/// Project the two served truths from a character's EquipmentMap: its NET GEAR vitality cache and
/// current equipped-pet boolean. Both are latest-wins absolute values from the same DF. A false pet
/// boolean also clears `$.pet`, because the sibling Item field is deleted on unequip and therefore has
/// no output snapshot of its own. True deliberately leaves `$.pet` untouched: a later unrelated gear
/// mutation re-emits EquipmentMap but need not re-emit the already-equipped pet sibling.
pub fn map_equipment_state(character_id: &str, gear_vitality: u64, pet_equipped: bool) -> Vec<RedisWrite> {
    let key = k_character(character_id);
    let mut writes = vec![
        char_init(&key, character_id),
        set(key.clone(), "$.gear_vitality", json!(gear_vitality)),
        set(key.clone(), "$.pet_equipped", json!(pet_equipped)),
    ];
    if !pet_equipped {
        writes.push(set(key, "$.pet", json!(null)));
    }
    writes
}

/// Decode and project an equipped pet's sibling Item field. Identity is sourced only from the
/// complete on-chain Item (`item_id`, canonical template object id, and the catalog/render slug in
/// `item_type`). EquipmentMap remains the sole authority for `pet_equipped`; this write never invents
/// or changes that boolean. `None` drops malformed, wrong-namespace, mismatched-key, or non-pet fields.
pub fn map_equipped_pet_field(character_id: &str, contents: &[u8]) -> Option<Vec<RedisWrite>> {
    let field: EquippedItemField = bcs::from_bytes(contents).ok()?;
    if field.namespace != NS_CHARACTER_EQUIPMENT
        || field.key != field.value.id
        || field.value.category != "pet"
    {
        return None;
    }
    let key = k_character(character_id);
    Some(vec![
        char_init(&key, character_id),
        set(
            key,
            "$.pet",
            json!({
                "item_id": field.value.id.to_canonical_string(true),
                "template_id": field.value.template.to_canonical_string(true),
                "slug": field.value.item_type,
            }),
        ),
    ])
}

/// Project one discovered `aresrpg::zones::Zone` DF onto its zone doc `rpc:zone:{world}:{zx}:{zy}` — the
/// SAME doc/index the `zones::ZoneSearched` event arm projects (see `project.rs`), converging idempotently:
/// the event sets discovery + the DERIVED-population counts, this snapshot adds the raw ZONE STATE (`$.seed`
/// + `$.mob_bitmap`/`$.res_bitmap` — the search-cost-rework Zone DF stores seed + consumed-bitmaps, never
/// spawn rows; the CLIENT derives the rows via `@aresrpg/sim`). `world_id` is the Field's parent (its
/// checkpoint `ObjectOwner` — the Zone DF is attached DIRECTLY to the World's UID). Self-sufficient (NX
/// skeleton + SADD index) so a zone surfaces in `/v1/zones` even if its snapshot lands before the
/// `ZoneSearched` event; latest-wins (idempotent — the Zone DF re-emits on every search/claim/gather that
/// flips a bit). `None` = the bytes did not decode as a Zone (defensive — never fails the batch). RAW stamps
/// only (lazy-accrual law: `discovered_at_ms` verbatim, the client owns the §17.1 TTL math). `seed` (a full
/// random u64) is a STRING (2^53 law); the api view subtracts the bitmap popcounts off the event's totals to
/// serve LIVE counts.
pub fn map_zone_field(world_id: &str, contents: &[u8]) -> Option<Vec<RedisWrite>> {
    let z: ZoneField = bcs::from_bytes(contents).ok()?;
    let key = k_zone(world_id, z.zx, z.zy);
    Some(vec![
        // NX skeleton (matches the ZoneSearched event arm) so this snapshot is self-sufficient.
        set_nx(key.clone(), "$", json!({ "world": world_id, "zx": z.zx, "zy": z.zy, "discovered": true })),
        set(key.clone(), "$.discovered_at_ms", json!(z.discovered_at_ms)),
        set(key.clone(), "$.seed", json!(z.seed.to_string())),
        set(key.clone(), "$.mob_bitmap", json!(z.mob_bitmap)),
        set(key, "$.res_bitmap", json!(z.res_bitmap)),
        sadd(k_zones(world_id), format!("{}:{}", z.zx, z.zy)),
    ])
}

/// Project one `aresrpg::zones::ZoneGroupCommitment` DF (the fight-create diet's search-committed
/// Blake2b mob-group root, `Field<ZoneGroupRootKey, ZoneGroupCommitment>` on the World's UID) onto the
/// SAME zone doc `map_zone_field` writes — `$.group_root` (a plain 32-byte array, symmetric with the
/// bitmaps) + `$.group_count`. Search upserts the commitment in the SAME tx that (re)rolls the zone
/// state, so both DFs re-emit together and the doc stays intra-coherent; the client's
/// `compose_mob_group_proof` (@aresrpg/sdk) recomputes the root from the served seed-derived stream and
/// FAILS SHUT (falls back to the original derivation door) on any mismatch, so a lagged or partial doc
/// can never produce a signed-but-doomed claim. A pre-diet zone (searched before the upgrade) simply
/// never gets these fields → `/v1/zones` serves nulls → old door. Self-sufficient (NX skeleton + SADD)
/// and latest-wins like every snapshot here; `None` = the bytes did not decode (defensive — never
/// fails the batch). `count` ≤ 64 on-chain (`zone_gen` MAX_GROUPS), so a plain JSON number is exact.
pub fn map_group_root_field(world_id: &str, contents: &[u8]) -> Option<Vec<RedisWrite>> {
    let f: ZoneGroupRootField = bcs::from_bytes(contents).ok()?;
    let key = k_zone(world_id, f.zx, f.zy);
    Some(vec![
        set_nx(key.clone(), "$", json!({ "world": world_id, "zx": f.zx, "zy": f.zy, "discovered": true })),
        set(key.clone(), "$.group_root", json!(f.root)),
        set(key, "$.group_count", json!(f.count)),
        sadd(k_zones(world_id), format!("{}:{}", f.zx, f.zy)),
    ])
}

/// Generic kiosk discovery (the ONE mechanism mandated — characters use it now,
/// items later): a kiosk-locked object's checkpoint owner is `ObjectOwner(<dynamic-object-
/// field wrapper>)`, and that wrapper's OWN owner is `ObjectOwner(<kiosk>)`. Given the
/// object's owner and a `wrapper -> kiosk` map built from the same checkpoint's `0x2::
/// dynamic_field::Field` output objects (see [`AresSnapshotHandler::process`]), resolve the
/// kiosk id. `None` for a non-kiosk owner (address-owned / shared) or an unmapped wrapper
/// (the child was touched without its wrapper — never happens at place/trade, when both are
/// output objects). Pure so it is unit-tested offline (the mandate's regression fixture).
fn resolve_kiosk(owner: &Owner, wrappers: &HashMap<SuiAddress, SuiAddress>) -> Option<String> {
    match owner {
        // Format as an object id (canonical 0x+64 hex), like every other id in the model —
        // `SuiAddress` has no `to_canonical_string`, so hop through `ObjectID` (they share the
        // 32-byte `AccountAddress`).
        Owner::ObjectOwner(wrapper) => {
            wrappers.get(wrapper).map(|kiosk| ObjectID::from(*kiosk).to_canonical_string(true))
        }
        _ => None,
    }
}

/// Project one `aresrpg_fight::settlement::FightOutcome` output object into its wallet's
/// pending-outcome set + per-outcome doc. `owner` is the object's checkpoint owner
/// (`AddressOwner` — the seat's wallet); a non-address owner yields `None` (defensive —
/// the outcome is soulbound address-owned by construction). `ts_ms` is the enclosing
/// checkpoint timestamp (the sorted-set score = recency, for the defensive cap). `None`
/// also when the bytes do not decode as a FightOutcome (never fails the batch). The doc
/// carries EXACTLY the frozen view fields.
pub fn map_fight_outcome_object(id: &str, contents: &[u8], owner: &Owner, ts_ms: u64) -> Option<Vec<RedisWrite>> {
    let Owner::AddressOwner(owner_addr) = owner else { return None };
    let o: FightOutcomeObject = bcs::from_bytes(contents).ok()?;
    let owner = owner_addr.to_string();
    let idx = k_pending_outcomes(&owner);
    Some(vec![
        zadd(idx.clone(), ts_ms as i64, id.to_string()),
        zrem_rank_keep_newest(idx, PENDING_CAP),
        set(
            k_pending_outcome(id),
            "$",
            json!({
                "outcome_id": id,
                "character_id": o.character.to_canonical_string(true),
                "fight_id": o.fight.to_canonical_string(true),
                "world_id": o.world.to_canonical_string(true),
                "pvp": o.pvp,
                "outcome": o.outcome,
                "aged_bp": o.aged_bp,
            }),
        ),
    ])
}

/// The delete half of the pending-outcome projection: `results::open` CONSUMES (deletes)
/// the FightOutcome, so mirror it by dropping the per-owner-index member + the per-outcome doc.
/// The owning address rides the deleted input object (its pre-delete `AddressOwner`), so the `ZREM`
/// is exact — no monotonic index wart (unlike the fight/result terminals). Both writes are
/// idempotent (removing/deleting absent keys is a no-op), so the batch replays safely.
fn remove_pending_outcome(id: &str, owner: &str) -> Vec<RedisWrite> {
    vec![zrem(k_pending_outcomes(owner), id.to_string()), del(k_pending_outcome(id), "$")]
}

/// Snapshot one `aresrpg::loot_box::PetBoxClaim` output object into its opener's pet-claims
/// map doc: `rpc:petclaims:{owner}` `$.claims["<claim_id>"] = "<rolled_template>"` (see the
/// key-builder note on [`k_pet_claims`]). `owner` is the object's checkpoint owner
/// (`AddressOwner` — the claim is soulbound, `key`-only, no `store`); a non-address owner is
/// pathological → `None`. `None` also when the bytes do not decode as a PetBoxClaim
/// (defensive — never fails the batch).
pub fn map_pet_box_claim_object(id: &str, contents: &[u8], owner: &Owner) -> Option<Vec<RedisWrite>> {
    let Owner::AddressOwner(owner_addr) = owner else { return None };
    let c: PetBoxClaimObject = bcs::from_bytes(contents).ok()?;
    let owner = owner_addr.to_string();
    let key = k_pet_claims(&owner);
    Some(vec![
        // NX skeleton so a snapshot landing before any other write to this wallet's doc still has one.
        set_nx(key.clone(), "$", json!({ "owner": owner, "claims": {} })),
        set(key, &mpath("$.claims", id), json!(c.rolled_template.to_canonical_string(true))),
    ])
}

/// The delete half: `claim_pet` CONSUMES (deletes) the claim, so mirror it by dropping the
/// map entry — idempotent (deleting an absent sub-path is a no-op), so the batch replays safely.
fn remove_pet_box_claim(id: &str, owner: &str) -> Vec<RedisWrite> {
    vec![del(k_pet_claims(owner), &mpath("$.claims", id))]
}

/// Snapshot one `aresrpg::item::ItemTemplate` object's authoring fields into its
/// encyclopedia doc `rpc:template:{id}` — the SAME doc/index the `item::TemplateCreated`
/// event arm projects (see `project.rs`), so the two converge idempotently (the event
/// sets item_type + liveness; the snapshot adds name/category/level). Self-sufficient
/// (NX doc + SADD) so items surface in `/v1/encyclopedia` even before/without the event.
/// `None` = the bytes did not decode as an ItemTemplate (defensive — never fails the batch).
pub fn map_item_template_object(id: &str, contents: &[u8]) -> Option<Vec<RedisWrite>> {
    let t: ItemTemplateObject = bcs::from_bytes(contents).ok()?;
    let key = k_template(id);
    Some(vec![
        set_nx(key.clone(), "$", json!({ "template": id, "live": true })),
        set(key.clone(), "$.item_type", json!(t.item_type)),
        set(key.clone(), "$.name", json!(t.name)),
        set(key.clone(), "$.description", json!(t.description)),
        set(key.clone(), "$.category", json!(t.category)),
        set(key, "$.level", json!(t.level)),
        sadd(K_TEMPLATES.into(), id.to_string()),
    ])
}

/// Snapshot one `aresrpg::item::Item` object's display fields into its item doc
/// `rpc:item:{id}` — the SAME doc the `item::ItemMinted`/`scribe::Scribed` event arms project
/// (see `project.rs`), so the two converge idempotently (the event sets template/item_type/
/// level; the snapshot adds name/category/amount). Self-sufficient (NX doc init) so an item
/// surfaces even if its snapshot lands before its mint event. When the wrapper→kiosk hop
/// resolved (see [`resolve_kiosk`]), the item's CURRENT kiosk is written latest-wins AND the
/// item joins that kiosk's membership set — the two halves the `/v1/owner-items` join reads.
/// `None` = the bytes did not decode as an Item (defensive — never fails the batch).
pub fn map_item_object(id: &str, contents: &[u8], kiosk_id: Option<&str>) -> Option<Vec<RedisWrite>> {
    let it: ItemObject = bcs::from_bytes(contents).ok()?;
    let key = k_item(id);
    let mut writes = vec![
        // NX skeleton (matches the ItemMinted arm) so `level` stays event-sourced (Scribed)
        // and a snapshot arriving before the mint event never clobbers a scribed level.
        set_nx(key.clone(), "$", json!({ "id": id, "level": null })),
        set(key.clone(), "$.template", json!(it.template.to_canonical_string(true))),
        set(key.clone(), "$.name", json!(it.name)),
        set(key.clone(), "$.item_type", json!(it.item_type)),
        set(key.clone(), "$.description", json!(it.description)),
        set(key.clone(), "$.category", json!(it.category)),
        set(key.clone(), "$.amount", json!(it.amount)),
    ];
    // Kiosk edge (latest-wins) + membership in that kiosk's item set. Only written when the
    // wrapper→kiosk hop resolved (never fabricate a kiosk); an item that leaves this kiosk
    // gets a NEW kiosk_id at its next snapshot, and the stale set membership is dropped at
    // read time by the doc's live `kiosk_id` — no per-item SREM the pure map cannot do.
    if let Some(kiosk) = kiosk_id {
        writes.push(set(key, "$.kiosk_id", json!(kiosk)));
        writes.push(sadd(k_kiosk_items(kiosk), id.to_string()));
    }
    Some(writes)
}

/// Snapshot one `kiosk::personal_kiosk::PersonalKioskCap` object into the wallet↔kiosk edge:
/// SADD the kiosk to the wallet's `owner_kiosks` set + write the per-kiosk doc carrying the cap
/// id (the client's `kiosk_cap_id`). `owner` is the object's checkpoint owner — the cap is
/// non-transferable, so a non-`AddressOwner` is pathological → `None`. `None` also when the
/// bytes do not decode, or the wrapped cap is (impossibly) absent (never fails the batch).
///
/// The kiosk→cap→owner edge is IMMUTABLE (a personal kiosk has exactly one soulbound
/// PersonalKioskCap for life; the cap can never move wallets or re-wrap), so the doc is
/// CREATE-ONCE (`set_nx`). That is both semantically right and the hardening that contains the
/// allowlist exemption: because the REAL cap is created at kiosk creation (its EARLIEST
/// checkpoint) and the sequential pipeline replays in order, the real cap wins the NX race — a
/// later FORGED look-alike cap that names an existing victim kiosk NX-no-ops and CANNOT
/// overwrite the victim's cap_id. (The forged cap can still SADD the victim kiosk into the
/// ATTACKER's own `owner_kiosks`, but that only surfaces already-public kiosk contents under
/// the attacker's address with the victim's real, unusable soulbound cap — no leak, no poison.)
pub fn map_personal_kiosk_cap(id: &str, contents: &[u8], owner: &Owner) -> Option<Vec<RedisWrite>> {
    let Owner::AddressOwner(owner_addr) = owner else { return None };
    let cap: PersonalKioskCapObject = bcs::from_bytes(contents).ok()?;
    let kiosk = cap.cap?.for_kiosk.to_canonical_string(true);
    let owner = owner_addr.to_string();
    Some(vec![
        sadd(k_owner_kiosks(&owner), kiosk.clone()),
        set_nx(k_kiosk(&kiosk), "$", json!({ "kiosk_id": kiosk, "cap_id": id, "owner": owner })),
    ])
}

/// The scalar prefix + loot table of an `aresrpg::mob_template::MobTemplate` object.
/// The prefix (name / level range / hp / element) is REQUIRED — the §14 bestiary list.
/// `drops` is a BEST-EFFORT tail decode: BCS is positional, so reaching the `loot`
/// vector means walking past the intervening `stats` (a fixed `Stats` = 22 `u64` = 176
/// bytes — spell.move) and `spells` (`vector<SpellLevel>`, each a variable record with
/// nested `vector<Effect>` — spell_effect.move). We SKIP those (no view serves a mob's
/// resistances or spell kit) and DECODE only `loot` (`vector<MobLootEntry>` — mob.move).
/// A malformed/foreign tail yields `drops = None` (honest-unknown) WITHOUT dropping the
/// prefix — the loot walk can never regress the working name/level projection.
struct MobTemplatePrefix {
    name: String,
    min_level: u16,
    max_level: u16,
    base_hp: u64,
    element: u8,
    drops: Option<Vec<LootRow>>,
}

/// One decoded `aresrpg_fight::mob::MobLootEntry` row for the §14 bestiary drops view.
/// `template_id` is the canonical `0x…` item-template id — the JS view joins it to the
/// item docs' name/category (`rpc:template:{id}`, written by the item snapshot above).
/// `chance_bp` is basis points on-chain (10000 = 100%); the view derives the percent.
#[derive(Debug, Serialize)]
struct LootRow {
    template_id: String,
    chance_bp: u16,
    min_qty: u16,
    max_qty: u16,
}

impl MobTemplatePrefix {
    /// Layout: `id:UID(32) | name:String | min_level:u16 | max_level:u16 | base_hp:u64 |
    /// ap:u64 | mp:u64 | element:u8 | stats:Stats(176) | spells:vector<SpellLevel> |
    /// loot:vector<MobLootEntry> | xp_reward:u64`. The prefix (through `element`) is
    /// required (`None` on truncation); `loot` is a best-effort tail — a short/foreign
    /// body past the prefix sets `drops = None` and never fails the prefix.
    fn parse(bytes: &[u8]) -> Option<Self> {
        let mut r = ByteReader::new(bytes);
        r.skip(32)?; // UID = a bare 32-byte ObjectID (no length prefix)
        let name = r.string()?;
        let min_level = r.u16()?;
        let max_level = r.u16()?;
        let base_hp = r.u64()?;
        let _ap = r.u64()?;
        let _mp = r.u64()?;
        let element = r.u8()?;
        // Best-effort: skip `stats` + `spells`, decode `loot`. `None` here (short/foreign
        // tail) leaves the already-parsed prefix intact — loot never regresses the list.
        let drops = r.read_mob_loot();
        Some(Self { name, min_level, max_level, base_hp, element, drops })
    }
}

/// Snapshot one `aresrpg::mob_template::MobTemplate` object into its encyclopedia doc
/// `rpc:mob_template:{id}` (+ the `idx:mob_templates` index the view reads). `None` = a
/// truncated/foreign body that did not parse as the prefix (defensive — never fails the
/// batch). `element` is the raw `spell` discriminant (0=fire,1=water,2=earth,3=air,255=none);
/// the frontend maps it to a name, exactly as the legacy reader did.
pub fn map_mob_template_object(id: &str, contents: &[u8]) -> Option<Vec<RedisWrite>> {
    let p = MobTemplatePrefix::parse(contents)?;
    let key = k_mob_template(id);
    Some(vec![
        set(
            key,
            "$",
            json!({
                "template": id,
                "name": p.name,
                "min_level": p.min_level,
                "max_level": p.max_level,
                "base_hp": p.base_hp,
                "element": p.element,
                // Raw on-chain loot rows (id + basis-point chance + qty band); `null` when
                // the nested tail did not decode. The JS view joins name/category + %.
                "drops": p.drops,
                "live": true,
            }),
        ),
        sadd(K_MOB_TEMPLATES.into(), id.to_string()),
    ])
}

/// Snapshot one `aresrpg_game::world::World` object's join gate into its world doc
/// `rpc:world:{id}` (+ the `idx:worlds` index the `/v1/encyclopedia` worlds view reads).
/// The gate lives ONLY on the object: `world::set_required_level` fires a payload-less
/// `WorldUpdated { world }` ("the RPC re-reads the object" — world.move), and the create
/// event carries seed/biome only — so without this snapshot every world served "Lv 1+"
/// (the view's `?? 1` fallback; found 2026-07-17). Prefix decode (`id | seed | biome |
/// required_level`) tolerating the dial/spawn-table tail; latest-wins whole-doc set — the
/// World object mutates on every dial edit and spawn-nonce bump, so the doc self-heals.
/// `None` = a truncated/foreign body (defensive — never fails the batch).
pub fn map_world_object(id: &str, contents: &[u8]) -> Option<Vec<RedisWrite>> {
    let mut r = ByteReader::new(contents);
    r.skip(32)?; // UID = a bare 32-byte ObjectID (no length prefix)
    let seed = r.u64()?;
    let biome = r.string()?;
    let required_level = r.u16()?;
    Some(vec![
        set(
            k_world(id),
            "$",
            json!({
                "world": id,
                // String — mirrors the WorldCreated event projection (u64 precision over JSON).
                "seed": seed.to_string(),
                "biome": biome,
                "required_level": required_level,
            }),
        ),
        sadd(K_WORLDS.into(), id.to_string()),
    ])
}

/// Snapshot one `aresrpg::crafting::Recipe` object into its encyclopedia doc `rpc:recipe:{id}`
/// (+ the `idx:recipes` index the `/v1/encyclopedia` recipes view reads). The doc carries the
/// EXACT on-chain values (ingredient template ids + quantities, output template + quantity,
/// required job u8 + knowledge level, per-craft xp) — the §14 crafting truth: a recipe served
/// here is a real shared Recipe object, so it is provably craftable in game. Latest-wins whole-doc
/// set (idempotent; the object is immutable after share, so replays converge trivially). `None` =
/// the bytes did not decode as a Recipe (defensive — never fails the batch).
pub fn map_recipe_object(id: &str, contents: &[u8]) -> Option<Vec<RedisWrite>> {
    let r: RecipeObject = bcs::from_bytes(contents).ok()?;
    let inputs: Vec<_> = r
        .inputs
        .iter()
        .map(|i| {
            json!({
                "template_id": i.template.to_canonical_string(true),
                "quantity": i.quantity,
            })
        })
        .collect();
    Some(vec![
        set(
            k_recipe(id),
            "$",
            json!({
                "recipe": id,
                "output_template": r.output_template.to_canonical_string(true),
                "output_quantity": r.output_quantity,
                "required_job": r.required_job,
                "required_level": r.required_level,
                "craft_xp": r.craft_xp,
                "inputs": inputs,
                "live": true,
            }),
        ),
        sadd(K_RECIPES.into(), id.to_string()),
    ])
}

/// A cursor over a BCS byte slice — the handful of primitive reads the MobTemplate
/// prefix needs (positional, little-endian; String = ULEB128 length + UTF-8 bytes).
/// Bounds-checked: any short read returns `None` (the caller drops the snapshot).
struct ByteReader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> ByteReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0 }
    }
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let end = self.pos.checked_add(n)?;
        let slice = self.bytes.get(self.pos..end)?;
        self.pos = end;
        Some(slice)
    }
    fn skip(&mut self, n: usize) -> Option<()> {
        self.take(n).map(|_| ())
    }
    fn u8(&mut self) -> Option<u8> {
        Some(self.take(1)?[0])
    }
    fn u16(&mut self) -> Option<u16> {
        let s = self.take(2)?;
        Some(u16::from_le_bytes([s[0], s[1]]))
    }
    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }
    /// ULEB128 (BCS's length prefix for strings/vectors).
    fn uleb(&mut self) -> Option<usize> {
        let mut result: u64 = 0;
        let mut shift = 0u32;
        loop {
            let byte = self.u8()?;
            result |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                break;
            }
            shift += 7;
            if shift >= 64 {
                return None; // malformed / overlong
            }
        }
        usize::try_from(result).ok()
    }
    fn string(&mut self) -> Option<String> {
        let len = self.uleb()?;
        let bytes = self.take(len)?;
        String::from_utf8(bytes.to_vec()).ok()
    }

    fn bool(&mut self) -> Option<bool> {
        match self.u8()? {
            0 => Some(false),
            1 => Some(true),
            _ => None,
        }
    }

    fn option_tag(&mut self) -> Option<bool> {
        match self.u8()? {
            0 => Some(false),
            1 => Some(true),
            _ => None,
        }
    }

    fn skip_option_id(&mut self) -> Option<()> {
        if self.option_tag()? {
            self.skip(32)?;
        }
        Some(())
    }

    fn skip_option_string(&mut self) -> Option<()> {
        if self.option_tag()? {
            self.string()?;
        }
        Some(())
    }

    fn skip_option_u8(&mut self) -> Option<()> {
        if self.option_tag()? {
            self.u8()?;
        }
        Some(())
    }

    // ── MobTemplate tail walk (positional): skip `stats` + `spells`, decode `loot` ──
    // Byte widths are pinned to the Move sources; each returns `None` on a short read so
    // a malformed tail collapses to `drops = None` rather than a mis-aligned loot table.

    /// Skip a `vector<u16>` (ULEB count + count × 2 bytes).
    fn skip_u16_vec(&mut self) -> Option<()> {
        let n = self.uleb()?;
        self.skip(n.checked_mul(2)?)
    }

    /// Skip a `vector<u8>` (ULEB count + count × 1 byte).
    fn skip_u8_vec(&mut self) -> Option<()> {
        let n = self.uleb()?;
        self.skip(n)
    }

    /// Skip a `vector<ID>` (ULEB count + count × 32 bytes — each `ID` is a bare 32-byte address).
    fn skip_id_vec(&mut self) -> Option<()> {
        let n = self.uleb()?;
        self.skip(n.checked_mul(32)?)
    }

    /// Skip a `vector<Effect>` — each `Effect` (spell_effect.move) is 11 fixed-width
    /// fields = 25 bytes (`u8+u8+u64+u8+u64+u8+u8+u8+u8+u8+u8`).
    fn skip_effect_vec(&mut self) -> Option<()> {
        let n = self.uleb()?;
        self.skip(n.checked_mul(25)?)
    }

    /// Skip one `SpellLevel` (spell_effect.move): a 42-byte fixed head
    /// (`u16 + 3×u64 + 4 bool + 3 u8 + u64 + bool`) then four vectors —
    /// `required_states`/`forbidden_states` (`vector<u16>`) and
    /// `effects`/`crit_effects` (`vector<Effect>`).
    fn skip_spell_level(&mut self) -> Option<()> {
        self.skip(42)?;
        self.skip_u16_vec()?;
        self.skip_u16_vec()?;
        self.skip_effect_vec()?;
        self.skip_effect_vec()
    }

    /// From just after `element`: skip `stats` (fixed `Stats` = 22 `u64` = 176 bytes;
    /// spell.move), skip the `spells` vector (walking each `SpellLevel`), then decode the
    /// `loot` vector (`MobLootEntry { item_template: ID(32), chance_bp: u16, min_qty: u16,
    /// max_qty: u16 }` — mob.move) into display rows. `None` on any short read.
    fn read_mob_loot(&mut self) -> Option<Vec<LootRow>> {
        self.skip(22 * 8)?; // Stats — 22 u64
        let spells = self.uleb()?;
        for _ in 0..spells {
            self.skip_spell_level()?;
        }
        let loot = self.uleb()?;
        let mut rows = Vec::new();
        for _ in 0..loot {
            let template_id = format!("0x{}", hex::encode(self.take(32)?));
            let chance_bp = self.u16()?;
            let min_qty = self.u16()?;
            let max_qty = self.u16()?;
            rows.push(LootRow { template_id, chance_bp, min_qty, max_qty });
        }
        Some(rows)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct EquipmentState {
    gear_vitality: u64,
    pet_equipped: bool,
}

/// Read `EquipmentMap.gear.vitality` and its current `pet` boolean out of the character's equipment
/// dynamic field (`Field<NsKey<equipment::EquipmentKey>, EquipmentMap>`). The full Move-derived wire is
/// `Field UID | namespace | EquipmentKey dummy bool | singles | ring_count | relic_templates |
/// Stats(22×u64) | weapon_item Option<ID> | weapon_family Option<String> | tool_job Option<u8> | pet bool`.
/// Cursor parsing keeps the fixed Stats position explicit while strictly walking every variable tail
/// before pet; malformed option tags, bools, or truncation return `None` rather than guessing state.
fn equipment_state(contents: &[u8]) -> Option<EquipmentState> {
    let mut r = ByteReader::new(contents);
    r.skip(32)?; // id: UID — a bare 32-byte ObjectID (no length prefix)
    if r.u8()? != NS_CHARACTER_EQUIPMENT {
        return None;
    }
    r.bool()?; // EquipmentKey {}'s hidden dummy bool (empty Move structs are one byte)
    r.skip_u8_vec()?; // singles: vector<u8>
    r.skip(1)?; // ring_count: u8
    r.skip_id_vec()?; // relic_templates: vector<ID>
    r.skip(21 * 8)?; // gear: Stats — the first 21 u64 fields (vitality is the 22nd/last)
    let gear_vitality = r.u64()?;
    r.skip_option_id()?; // weapon_item: Option<ID>
    r.skip_option_string()?; // weapon_family: Option<String>
    r.skip_option_u8()?; // tool_job: Option<u8>
    let pet_equipped = r.bool()?;
    Some(EquipmentState { gear_vitality, pet_equipped })
}

/// Project one `aresrpg_forgemagie::forgemagie` event into the taux read-model. `None` = a
/// forgemagie event we do not index (e.g. `RuneRegistered` — the rune registry is
/// not a taux view). The stored coefficient is the settled `coeff_after`; the view
/// folds bracket drift `(pressure_now − snapshot) × 3/5` at read time.
pub fn map_taux_event(name: &str, contents: &[u8]) -> Option<Vec<RedisWrite>> {
    Some(match name {
        "BoardCreated" => {
            let e: BoardCreated = bcs::from_bytes(contents).ok()?;
            vec![set(
                K_TAUX_META.into(),
                "$",
                json!({ "neutral_milli": e.neutral_milli, "bracket_size": e.bracket_size }),
            )]
        }
        "Crushed" => {
            let e: Crushed = bcs::from_bytes(contents).ok()?;
            let t = e.template.to_canonical_string(true);
            vec![
                // NX-init preserves a prior `recipe_less` flag across a later crush.
                set_nx(k_taux(&t), "$", json!({ "template": t, "recipe_less": false })),
                set(k_taux(&t), "$.coeff_milli", json!(e.coeff_after)),
                set(k_taux(&t), "$.bracket", json!(e.bracket)),
                set(k_taux(&t), "$.snapshot", json!(e.pressure_after)),
                sadd(K_TAUX_IDX.into(), t.clone()),
                // The bracket's current monotone pressure (latest checkpoint wins).
                set(k_taux_bracket(e.bracket), "$", json!(e.pressure_after)),
            ]
        }
        "RecipelessSet" => {
            let e: RecipelessSet = bcs::from_bytes(contents).ok()?;
            let t = e.gear_template.to_canonical_string(true);
            vec![
                set_nx(k_taux(&t), "$", json!({ "template": t })),
                set(k_taux(&t), "$.recipe_less", json!(e.recipe_less)),
                sadd(K_TAUX_IDX.into(), t),
            ]
        }
        _ => return None,
    })
}

// ── Last-sale price (marketcap) — the per-template realised-price projection ──

/// Record `template`'s newest realised PER-UNIT sale price — one latest-wins `SET` of
/// `rpc:lastsale:{template}` (idempotent on replay; cross-checkpoint order is exact because every
/// venue's write flows through THIS one sequential pipeline — see project.rs `k_lastsale`).
/// `price_mist` is a string (the 2^53 money law); `ts` is the checkpoint timestamp so the view
/// can say how stale the price is.
pub fn map_last_sale(template: &str, price_per_unit_mist: u64, ts_ms: u64) -> Vec<RedisWrite> {
    vec![set(
        k_lastsale(template),
        "$",
        json!({ "template": template, "price_mist": price_per_unit_mist.to_string(), "ts": ts_ms }),
    )]
}

/// The kiosk-marketplace per-unit price, or `None` when the purchase must NOT stamp a price:
/// price == 0 is the EXTRACT SEAM's internal zero-price list+purchase (every equip / burn /
/// crush / merge flows through it — extract.move `extract_locked`), not a market trade; and a
/// zero `amount` can only be a test-minted ghost stack (mint/split/merge all keep amount ≥ 1) —
/// refused rather than divided by. Whole-stack listings sell all units for one price, so the
/// per-unit price is `price / amount` (floored — sub-MIST dust).
pub fn kiosk_purchase_per_unit(price_mist: u64, amount: u64) -> Option<u64> {
    if price_mist == 0 || amount == 0 {
        return None;
    }
    Some(price_mist / amount)
}

/// Snapshots Character objects + projects forgemagie taux events. Shares the same
/// optional package allowlist as the event handler — but note the allowlist must
/// include EVERY emitting package address: `character::Character` keeps its original
/// defining address, while `forgemagie` now lives in its OWN sibling `aresrpg_forgemagie`
/// package (package-split 2026-07-12). Unset = match by `(module, name)` alone.
pub struct AresSnapshotHandler {
    packages: Option<HashSet<String>>,
}

impl AresSnapshotHandler {
    pub fn new(packages: Option<HashSet<String>>) -> Self {
        Self { packages }
    }

    fn admits(&self, pkg: &str) -> bool {
        match &self.packages {
            None => true,
            Some(allow) => allow.contains(pkg),
        }
    }
}

#[async_trait]
impl Processor for AresSnapshotHandler {
    type Value = RedisWrite;

    const NAME: &'static str = "ares_snapshot";

    async fn process(&self, checkpoint: &Arc<Checkpoint>) -> Result<Vec<Self::Value>> {
        let mut writes = Vec::new();
        // Applied after Phase 2: a fight can output both the stale-base Character object and its
        // live Progression DF, so progression must win the same-checkpoint JSON.SET ordering.
        let mut progression_writes = Vec::new();
        let ts_ms = checkpoint.summary.timestamp_ms;

        // ── Phase 1 (checkpoint-wide): kiosk discovery map ────────────────────
        // A kiosk-locked object's checkpoint owner is `ObjectOwner(<dynamic-object-field
        // wrapper>)`; the wrapper's OWN owner is `ObjectOwner(<kiosk>)`. Index every
        // `0x2::dynamic_field::Field` output object → its kiosk (its own owner). This
        // framework `0x2` type is deliberately EXEMPT from the AresRPG package allowlist
        // (like the event pipeline admits native kiosk). Only OUR objects' owners consume
        // the map (Phase 2), so unrelated dynamic fields here never produce a write.
        let mut kiosk_of_wrapper: HashMap<SuiAddress, SuiAddress> = HashMap::new();
        for tx in &checkpoint.transactions {
            for obj in tx.output_objects(&checkpoint.object_set) {
                let Some(ty) = obj.type_() else { continue };
                if ty.module().as_str() == DYNAMIC_FIELD_MODULE && ty.name().as_str() == DYNAMIC_FIELD_TYPE {
                    if let Owner::ObjectOwner(kiosk) = obj.owner() {
                        kiosk_of_wrapper.insert(obj.id().into(), *kiosk);
                    }
                    // First-party DFs attached DIRECTLY to a PARENT's UID, so the Field's checkpoint
                    // `ObjectOwner` IS that parent (a Character or the World). Discriminated by the key
                    // TYPE PARAMETER (never the byte-identical bodies), latest-wins per parent. Independent
                    // of the kiosk map above (a first-party-DF id is never looked up AS a wrapper, so the
                    // shared insert stays inert for it). Six arms:
                    //   • job-xp   (`Field<NsKey<JobXpKey>, u64>`, parent=character)  — ABSOLUTE running total.
                    //   • progression (`…<ProgressionKey>, Progression>`, character)  — fight xp/level + RAW hp/stamp.
                    //   • equipment  (`…<EquipmentKey>, EquipmentMap>`, character)     — NET GEAR vitality cache.
                    //   • equipped item (`…<object::ID>, item::Item>`, character)      — pet identity sibling.
                    //   • zone     (`Field<zones::ZoneKey, Zone>`, parent=WORLD)       — seed + consumed bitmaps.
                    //   • group root (`Field<zones::ZoneGroupRootKey, ZoneGroupCommitment>`, WORLD) — the
                    //     fight-create diet's committed Blake2b mob-group root + count (witness ingredient).
                    if let Owner::ObjectOwner(parent) = obj.owner() {
                        let params = ty.type_params();
                        let key = params.first().map(|k| &**k);
                        let value = params.get(1).map(|v| &**v);
                        let id = || ObjectID::from(*parent).to_canonical_string(true);
                        if key.is_some_and(is_job_xp_key) {
                            if let Some(mv) = obj.data.try_as_move() {
                                if let Ok(f) = bcs::from_bytes::<JobXpField>(mv.contents()) {
                                    writes.extend(map_job_xp_field(&id(), f.job, f.value));
                                }
                            }
                        } else if key.is_some_and(is_progression_key) {
                            if let Some(mv) = obj.data.try_as_move() {
                                if let Ok(p) = bcs::from_bytes::<ProgressionField>(mv.contents()) {
                                    progression_writes.extend(map_progression_field(
                                        &id(),
                                        p.xp,
                                        p.level,
                                        p.hp,
                                        p.hp_updated_ms,
                                    ));
                                }
                            }
                        } else if key.is_some_and(is_equipment_key) {
                            if let Some(mv) = obj.data.try_as_move() {
                                if let Some(state) = equipment_state(mv.contents()) {
                                    writes.extend(map_equipment_state(
                                        &id(),
                                        state.gear_vitality,
                                        state.pet_equipped,
                                    ));
                                }
                            }
                        } else if key.is_some_and(is_equipped_item_key) && value.is_some_and(is_item_value) {
                            if let Some(mv) = obj.data.try_as_move() {
                                if let Some(w) = map_equipped_pet_field(&id(), mv.contents()) {
                                    writes.extend(w);
                                }
                            }
                        } else if key.is_some_and(is_zone_key) {
                            // The Zone DF's parent (`id()`) is the WORLD id, not a character.
                            if let Some(mv) = obj.data.try_as_move() {
                                if let Some(w) = map_zone_field(&id(), mv.contents()) {
                                    writes.extend(w);
                                }
                            }
                        } else if key.is_some_and(is_group_root_key) {
                            // Same WORLD parent as the Zone DF — the diet's group-root commitment.
                            if let Some(mv) = obj.data.try_as_move() {
                                if let Some(w) = map_group_root_field(&id(), mv.contents()) {
                                    writes.extend(w);
                                }
                            }
                        }
                    }
                }
            }
        }

        // ── Phase 2: taux + sale events + object snapshots + fight-outcome create/delete ──
        for tx in &checkpoint.transactions {
            // Per-TX item map for the kiosk-purchase → template correlation: the native
            // `0x2::kiosk::ItemPurchased` event carries `{kiosk, id, price}` but NOT the
            // template — and the purchased Item is ALWAYS an output object of the SAME tx
            // (its ownership changed: pulled off the seller's kiosk, re-locked into the
            // buyer's), whose decoded contents carry template AND stack `amount`. A purchased
            // CHARACTER has no Item output → absent from the map → correctly skipped (no
            // template, no price row). Built only when the tx actually has events.
            let mut tx_items: HashMap<ObjectID, (String, u64)> = HashMap::new();
            if tx.events.is_some() {
                for obj in tx.output_objects(&checkpoint.object_set) {
                    let Some(ty) = obj.type_() else { continue };
                    if ty.module().as_str() == ITEM_MODULE
                        && ty.name().as_str() == ITEM_TYPE
                        && self.admits(&ty.address().to_canonical_string(true))
                    {
                        if let Some(mv) = obj.data.try_as_move() {
                            if let Ok(it) = bcs::from_bytes::<ItemObject>(mv.contents()) {
                                tx_items.insert(obj.id(), (it.template.to_canonical_string(true), it.amount));
                            }
                        }
                    }
                }
            }

            // ── taux (forgemagie) + last-sale (shop / pool / kiosk marketplace) events ──
            if let Some(events) = &tx.events {
                for event in &events.data {
                    let module = event.type_.module.as_str();
                    let name = event.type_.name.as_str();
                    let pkg = event.type_.address.to_canonical_string(true);
                    match (module, name) {
                        (FORGEMAGIE_MODULE, _) if self.admits(&pkg) => {
                            if let Some(mut w) = map_taux_event(name, &event.contents) {
                                writes.append(&mut w);
                            }
                        }
                        // Primary shop: `price` is already PER-UNIT (shop.move charges
                        // `price × quantity`; the event echoes `sale.price` + `amount`).
                        (SHOP_MODULE, "SaleBought") if self.admits(&pkg) => {
                            if let Ok(e) = bcs::from_bytes::<SaleBought>(&event.contents) {
                                let t = e.template.to_canonical_string(true);
                                writes.extend(map_last_sale(&t, e.price, ts_ms));
                            }
                        }
                        // AMM pool: totals for `quantity` units → per-unit floored. Buy uses the
                        // buyer's `sui_in`; sell uses `gross` (pre-royalty market value).
                        (POOL_MODULE, "PoolBuy") if self.admits(&pkg) => {
                            if let Ok(e) = bcs::from_bytes::<PoolBuy>(&event.contents) {
                                if e.quantity > 0 {
                                    let t = e.template.to_canonical_string(true);
                                    writes.extend(map_last_sale(&t, e.sui_in / e.quantity, ts_ms));
                                }
                            }
                        }
                        (POOL_MODULE, "PoolSell") if self.admits(&pkg) => {
                            if let Ok(e) = bcs::from_bytes::<PoolSell>(&event.contents) {
                                if e.quantity > 0 {
                                    let t = e.template.to_canonical_string(true);
                                    writes.extend(map_last_sale(&t, e.gross / e.quantity, ts_ms));
                                }
                            }
                        }
                        // Kiosk marketplace: address-PINNED to the 0x2 framework (see the const),
                        // template + units via the same-tx Item output map, zero-price extract-seam
                        // purchases skipped (`kiosk_purchase_per_unit`). `ItemPurchased<T>`'s phantom
                        // `T` is not in the BCS body — same decode as the event pipeline's listing arm.
                        (KIOSK_MODULE, "ItemPurchased") if pkg == SUI_FRAMEWORK_PKG => {
                            if let Ok(e) = bcs::from_bytes::<KioskItemListed>(&event.contents) {
                                if let Some((template, amount)) = tx_items.get(&e.id) {
                                    if let Some(per_unit) = kiosk_purchase_per_unit(e.price, *amount) {
                                        writes.extend(map_last_sale(template, per_unit, ts_ms));
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }

            // ── fight-outcome + pet-claim DELETES (consumed by results::open / claim_pet) ──
            // Neither the settled outcome nor the redeemed claim is an output object, so read
            // its pre-delete state (owning address + id) from the tx's input objects, gated by the
            // effects' delete set.
            let deleted: HashSet<ObjectID> = tx.effects.deleted().into_iter().map(|r| r.0).collect();
            if !deleted.is_empty() {
                for obj in tx.input_objects(&checkpoint.object_set) {
                    if !deleted.contains(&obj.id()) {
                        continue;
                    }
                    let Some(ty) = obj.type_() else { continue };
                    if !self.admits(&ty.address().to_canonical_string(true)) {
                        continue;
                    }
                    if ty.module().as_str() == SETTLEMENT_MODULE && ty.name().as_str() == FIGHT_OUTCOME_TYPE {
                        if let Owner::AddressOwner(owner) = obj.owner() {
                            writes.extend(remove_pending_outcome(
                                &obj.id().to_canonical_string(true),
                                &owner.to_string(),
                            ));
                        }
                    } else if ty.module().as_str() == LOOT_BOX_MODULE && ty.name().as_str() == PET_BOX_CLAIM_TYPE {
                        if let Owner::AddressOwner(owner) = obj.owner() {
                            writes.extend(remove_pet_box_claim(
                                &obj.id().to_canonical_string(true),
                                &owner.to_string(),
                            ));
                        }
                    }
                }
            }

            // ── object snapshots (output objects, latest-wins): character cosmetics +
            //    kiosk edge, §14 encyclopedia blueprints, pending fight outcomes + pet claims ──
            for obj in tx.output_objects(&checkpoint.object_set) {
                let Some(ty) = obj.type_() else { continue };
                let (module, name) = (ty.module().as_str(), ty.name().as_str());
                // EXEMPT from the AresRPG allowlist (like the Phase-1 dynamic_field hop): the
                // mysten personal-kiosk cap is framework-adjacent, matched by (module, name) —
                // the SAME match-by-name trust the character/item event arms run under while the
                // allowlist is unset. Its AddressOwner IS the wallet. A forged look-alike cap
                // cannot poison a victim: the per-kiosk doc is create-once (see
                // `map_personal_kiosk_cap` — the real cap wins the NX at kiosk creation). When
                // the ARES_PACKAGES allowlist is activated for production, pin the mysten kiosk
                // package here too (the residual hardening seam, tracked in the report).
                if module == PERSONAL_KIOSK_MODULE && name == PERSONAL_KIOSK_CAP_TYPE {
                    if let Some(mv) = obj.data.try_as_move() {
                        let id = obj.id().to_canonical_string(true);
                        if let Some(mut w) = map_personal_kiosk_cap(&id, mv.contents(), obj.owner()) {
                            writes.append(&mut w);
                        }
                    }
                    continue;
                }
                if !self.admits(&ty.address().to_canonical_string(true)) {
                    continue;
                }
                let Some(mv) = obj.data.try_as_move() else { continue };
                let id = obj.id().to_canonical_string(true);
                let mapped = match (module, name) {
                    (CHARACTER_MODULE, CHARACTER_TYPE) => {
                        let kiosk = resolve_kiosk(obj.owner(), &kiosk_of_wrapper);
                        map_character_object(&id, mv.contents(), kiosk.as_deref())
                    }
                    // The loose bag: an Item resolves its kiosk through the SAME wrapper map as
                    // the character (both personal-kiosk-locked), threading an owner-items join.
                    (ITEM_MODULE, ITEM_TYPE) => {
                        let kiosk = resolve_kiosk(obj.owner(), &kiosk_of_wrapper);
                        map_item_object(&id, mv.contents(), kiosk.as_deref())
                    }
                    (ITEM_MODULE, ITEM_TEMPLATE_TYPE) => map_item_template_object(&id, mv.contents()),
                    (MOB_TEMPLATE_MODULE, MOB_TEMPLATE_TYPE) => map_mob_template_object(&id, mv.contents()),
                    (WORLD_MODULE, WORLD_TYPE) => map_world_object(&id, mv.contents()),
                    (CRAFTING_MODULE, RECIPE_TYPE) => map_recipe_object(&id, mv.contents()),
                    (SETTLEMENT_MODULE, FIGHT_OUTCOME_TYPE) => {
                        map_fight_outcome_object(&id, mv.contents(), obj.owner(), ts_ms)
                    }
                    (LOOT_BOX_MODULE, PET_BOX_CLAIM_TYPE) => map_pet_box_claim_object(&id, mv.contents(), obj.owner()),
                    _ => continue,
                };
                if let Some(mut w) = mapped {
                    writes.append(&mut w);
                }
            }
        }
        writes.append(&mut progression_writes);
        if !writes.is_empty() {
            debug!(count = writes.len(), checkpoint = checkpoint.summary.sequence_number, "projected ares snapshot writes");
        }
        Ok(writes)
    }
}

#[async_trait]
impl Handler for AresSnapshotHandler {
    type Store = RedisStore;
    type Batch = Vec<RedisWrite>;

    fn batch(&self, batch: &mut Self::Batch, values: std::vec::IntoIter<Self::Value>) {
        batch.extend(values);
    }

    async fn commit<'a>(
        &self,
        batch: &Self::Batch,
        conn: &mut <Self::Store as Store>::Connection<'a>,
    ) -> Result<usize> {
        project::execute(batch, conn.connection()).await?;
        Ok(batch.len())
    }
}

#[cfg(test)]
#[path = "snapshot_tests.rs"]
mod tests;
