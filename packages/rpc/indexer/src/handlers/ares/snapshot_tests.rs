// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Offline unit tests for the object-snapshot + taux projection (mirrors the
//! `tests.rs` pattern: synthetic/real BCS in → exact write batch out).

use super::*;
// CharacterObject / BoardCreated / Crushed / RecipelessSet / ZoneField ride in via `super::*`
// (imported by `snapshot.rs`); the rest are only constructed in tests.
use super::super::model::{
    Customization, ItemDamagesLine, ItemTemplateObject, PositionAnchor, RecipeIngredient,
};
use std::collections::HashMap;
use std::io::{self, Write};
use std::sync::{Arc, Mutex};
use sui_indexer_alt_framework::types::base_types::{ObjectID, SuiAddress};
use sui_indexer_alt_framework::types::object::Owner;

#[derive(Clone, Default)]
struct SharedLog(Arc<Mutex<Vec<u8>>>);

impl SharedLog {
    fn contents(&self) -> String {
        String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
    }
}

impl Write for SharedLog {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// The pre-#577 origin — the last universe live before the 2026-07-23 fresh publish, and the one
/// registered 25-byte lineage. This is the file's one pre-existing chain-capture reference; every
/// synthetic object id below is built from the gate's short-id fixture convention instead.
const NARROW_EFFECT_ARESRPG_ORIGIN: &str = "0x4217b46f8dfe7c1ccc6a5e1c37e012a53bf25b07e0edb228a3c5a1575eeb2b06";

/// The `json` string of the first `JSON.SET key path …` write matching `path`.
fn set_json<'a>(writes: &'a [RedisWrite], path: &str) -> Option<&'a str> {
    writes.iter().find_map(|w| match w {
        RedisWrite::Set { path: p, json, .. } if p == path => Some(json.as_str()),
        _ => None,
    })
}

fn has_sadd(writes: &[RedisWrite], key: &str, member: &str) -> bool {
    writes.iter().any(|w| matches!(w, RedisWrite::SetAdd { key: k, member: m } if k == key && m == member))
}

/// Canonicalize a deliberately short synthetic fixture id at runtime. The BCS/ObjectID builder
/// supplies the zero padding; source never contains a full-width string that could be a live id.
fn synthetic_object_id(short: &str) -> String {
    ObjectID::from_hex_literal(short).unwrap().to_canonical_string(true)
}

// ── Character object snapshot ────────────────────────────────────────────────

/// RUNTIME PROVENANCE: the exact 94 bytes of the live testnet character
/// `0x3fa736…5344` (`qasenshi`, senshi) fetched via `sui_getObject showBcs` —
/// proves the Rust struct layout matches the published `aresrpg::character::
/// Character` byte-for-byte, not just our own round-trip.
const REAL_CHARACTER_BCS_HEX: &str = "3fa736761de4effbf240d049a3a9e698fe6065fdfaca8c134f0ec12c9f33534408716173656e7368690673656e73686901ffffff004ca2d40014698b0000000000000000008f4f5b449f0100000000000000000000000000000000000000";

#[test]
fn real_testnet_character_snapshots_its_cosmetics() {
    let bytes = hex::decode(REAL_CHARACTER_BCS_HEX).unwrap();
    let id = "0x3fa736761de4effbf240d049a3a9e698fe6065fdfaca8c134f0ec12c9f335344";
    let writes = map_character_object(id, &bytes, None).expect("real character bytes must decode");

    // NX skeleton first (so a snapshot before the mint event still has a doc).
    assert!(matches!(&writes[0], RedisWrite::Set { key, nx: true, .. } if key == &k_character(id)));
    assert_eq!(set_json(&writes, "$.name"), Some(r#""qasenshi""#));
    assert_eq!(set_json(&writes, "$.class"), Some(r#""senshi""#));
    assert_eq!(set_json(&writes, "$.male"), Some("true"));
    // color_1 = 0x00ffffff, color_2 = 0x00d4a24c, color_3 = 0x008b6914.
    assert_eq!(
        set_json(&writes, "$.colors"),
        Some(r#"{"color_1":16777215,"color_2":13935180,"color_3":9136404}"#)
    );
    assert_eq!(set_json(&writes, "$.experience"), Some("0"));
    assert_eq!(set_json(&writes, "$.level"), Some("1")); // 0 xp = level 1
}

#[test]
fn character_snapshot_round_trips_and_derives_level() {
    let obj = CharacterObject {
        id: ObjectID::from_hex_literal("0xabc").unwrap(),
        name: "Aiden".into(),
        class: "sram".into(),
        male: false,
        customization: Customization { color_1: 1, color_2: 2, color_3: 3 },
        experience: 22_385_000, // exactly the level-70 threshold
        created_at_ms: 42,
        anchor: PositionAnchor { pos_x: 0, pos_z: 0, zone: String::new(), anchored_at_ms: 0 },
    };
    let bytes = bcs::to_bytes(&obj).unwrap();
    let writes = map_character_object("0xabc", &bytes, None).unwrap();
    assert_eq!(set_json(&writes, "$.male"), Some("false"));
    assert_eq!(set_json(&writes, "$.level"), Some("70"));
    assert_eq!(set_json(&writes, "$.experience"), Some("22385000"));
}

#[test]
fn garbage_bytes_are_a_safe_none() {
    assert!(map_character_object("0xabc", &[0x00, 0x01, 0x02], None).is_none());
}

/// P1 xp-reset-on-refresh (2026-07-17), the SECOND home: the base `Character.experience` is the
/// GENESIS value, frozen at mint — live XP/level belong to the Progression DF projection alone.
/// Any `&mut Character` tx (equip, stat raise, world move…) re-emits the base object WITHOUT a
/// Progression change, so a plain `JSON.SET` here regressed `$.experience`/`$.level` to genesis in
/// every such checkpoint. The object arm must therefore SEED (NX) those two paths, never overwrite.
#[test]
fn character_object_experience_and_level_are_nx_seeds_never_overwrites() {
    let bytes = hex::decode(REAL_CHARACTER_BCS_HEX).unwrap();
    let id = "0x3fa736761de4effbf240d049a3a9e698fe6065fdfaca8c134f0ec12c9f335344";
    let writes = map_character_object(id, &bytes, None).unwrap();
    for path in ["$.experience", "$.level"] {
        assert!(
            writes
                .iter()
                .any(|w| matches!(w, RedisWrite::Set { path: p, nx: true, .. } if p == path)),
            "{path} must be an NX seed (genesis) — the live Progression DF owns it afterward"
        );
    }
    // The identity/cosmetic fields stay latest-wins (plain set) — they are object-authoritative.
    for path in ["$.name", "$.class", "$.male", "$.colors"] {
        assert!(
            writes
                .iter()
                .any(|w| matches!(w, RedisWrite::Set { path: p, nx: false, .. } if p == path)),
            "{path} must stay a plain latest-wins set"
        );
    }
}

/// REGRESSION GUARD (mandated behavior): the Character arm decode pinned over a REAL,
/// CURRENT live-character BCS fixture — `0xe9254e…ee25` ("smoke85987", senshi), the 96
/// bytes fetched via `sui_getObject showBcs`. The MobTemplate loot-walk extension lives
/// in a SEPARATE function (`map_mob_template_object` / `ByteReader`), so this arm must be
/// byte-for-byte unaffected; this test is the one that fails loudly if it ever isn't.
const REAL_CHARACTER_SMOKE_BCS_HEX: &str = "e9254e19fa953a1f4049136303e6eb099ca8825d555d88c4973a38b1acc4ee250a736d6f6b6538353938370673656e736869010000000000000000000000000000000000000000d96edc4a9f0100000000000000000000000000000000000000";

#[test]
fn character_arm_unaffected_by_mob_loot_extension() {
    let bytes = hex::decode(REAL_CHARACTER_SMOKE_BCS_HEX).unwrap();
    let id = "0xe9254e19fa953a1f4049136303e6eb099ca8825d555d88c4973a38b1acc4ee25";
    let writes = map_character_object(id, &bytes, None).expect("live character bytes must still decode");
    assert!(matches!(&writes[0], RedisWrite::Set { key, nx: true, .. } if key == &k_character(id)));
    assert_eq!(set_json(&writes, "$.name"), Some(r#""smoke85987""#));
    assert_eq!(set_json(&writes, "$.class"), Some(r#""senshi""#));
    assert_eq!(set_json(&writes, "$.male"), Some("true"));
    assert_eq!(set_json(&writes, "$.experience"), Some("0"));
    assert_eq!(set_json(&writes, "$.level"), Some("1")); // 0 xp = level 1
}

// ── Per-job XP dynamic field (lights the JobsDrawer + job-progression `character.jobs`) ─

#[test]
fn job_xp_field_projects_absolute_total_at_the_numeric_index() {
    // The DF value IS the running total (`character_link::add_job_xp`), so the projection is an
    // ABSOLUTE upsert at the numeric job index (miner = 2 @ 1911 xp) — replay-safe, mirror of the
    // §3 stats block.
    let character = "0x00000000000000000000000000000000000000000000000000000000000000c1";
    let writes = map_job_xp_field(character, 2, 1911);

    // char_init NX skeleton first (a job-xp snapshot can precede the mint event).
    assert!(matches!(&writes[0], RedisWrite::Set { key, nx: true, .. } if key == &k_character(character)));
    // `$.jobs` NX-init + the absolute set at the numeric index.
    assert!(writes.iter().any(|w| matches!(w, RedisWrite::Set { path, nx: true, .. } if path == "$.jobs")));
    assert_eq!(set_json(&writes, r#"$.jobs["2"]"#), Some("1911"));
    // Replay-safe: no relative counter on the projection (idempotent JSON.SET only).
    assert!(writes.iter().all(|w| !matches!(w, RedisWrite::NumIncrBy { .. })));
}

#[test]
fn job_xp_field_bcs_matches_the_onchain_df_layout() {
    // The exact DF contents the snapshot decodes: `id: UID(32) | NsKey { namespace: u8, key:
    // JobXpKey { job: u8 } } | value: u64` — the nested one-field structs flatten with NO framing,
    // so the wire is 42 bytes and the two leading u8s ARE (namespace, job).
    let f = JobXpField {
        id: ObjectID::from_hex_literal("0xf1").unwrap(),
        namespace: 2, // NS_CHARACTER_WORLD
        job: 2,       // miner
        value: 1911,  // level-10 threshold
    };
    let bytes = bcs::to_bytes(&f).unwrap();
    assert_eq!(bytes.len(), 32 + 1 + 1 + 8);
    let decoded: JobXpField = bcs::from_bytes(&bytes).unwrap();
    assert_eq!((decoded.namespace, decoded.job, decoded.value), (2, 2, 1911));
}

#[test]
fn is_job_xp_key_discriminates_from_the_byte_identical_stat_alloc_key() {
    use std::str::FromStr;
    // Field<NsKey<JobXpKey>, u64> matches; the byte-identical Field<NsKey<StatAllocKey>, u64>
    // (same namespace, same {u8}->u64 shape) must NOT — the inner struct NAME is the only signal.
    let job = TypeTag::from_str("0x2::extension::NsKey<0x2::character_link::JobXpKey>").unwrap();
    let stat = TypeTag::from_str("0x2::extension::NsKey<0x2::character_link::StatAllocKey>").unwrap();
    assert!(is_job_xp_key(&job));
    assert!(!is_job_xp_key(&stat));
    // The value type param (u64) — a non-struct key — never matches.
    assert!(!is_job_xp_key(&TypeTag::U64));
    // Right inner key, WRONG envelope struct → also rejected.
    let wrong_ns = TypeTag::from_str("0x2::extension::Wrong<0x2::character_link::JobXpKey>").unwrap();
    assert!(!is_job_xp_key(&wrong_ns));
}

// ── Live-progression dynamic field (XP/level + RAW hp/regen stamp) ────────────

#[test]
fn progression_field_projects_absolute_xp_level_and_raw_hp_state() {
    // The DF carries absolute fight XP/level plus RAW stored hp and the lazy-regen stamp; the
    // projection serves all four verbatim. The CLIENT owns the §5.4 natural-regen math, so the
    // indexer NEVER recomputes regen (the banked remainder-carry bug class).
    let character = "0x00000000000000000000000000000000000000000000000000000000000000c1";
    let writes = map_progression_field(character, 32_600, 12, 137, 1_700_000_000_123);

    // char_init NX skeleton first (a progression snapshot can precede the mint event).
    assert!(matches!(&writes[0], RedisWrite::Set { key, nx: true, .. } if key == &k_character(character)));
    assert_eq!(set_json(&writes, "$.experience"), Some("32600"));
    assert_eq!(set_json(&writes, "$.level"), Some("12"));
    assert_eq!(set_json(&writes, "$.current_hp"), Some("137"));
    assert_eq!(set_json(&writes, "$.hp_updated_ms"), Some("1700000000123"));
    // Replay-safe: idempotent JSON.SET only, never a relative counter.
    assert!(writes.iter().all(|w| !matches!(w, RedisWrite::NumIncrBy { .. })));
}

/// RUNTIME PROVENANCE (P1 xp-reset-on-refresh, 2026-07-17): the exact 60 bytes of the LIVE testnet
/// progression Field `0x9e16ac7d…d6ae` (character `0xc00f5791…dc79`, "jawad") at version
/// 942652010 / digest `BfDTNTQxmZsrafNK2EvHS6t8LFynpmnYVrcFPuZN8h4J`, fetched via
/// `sui_getObject showBcs`. Wire: `id: UID(32) | NsKey.namespace: u8 | ProgressionKey.dummy_field:
/// bool | xp: u64 | level: u16 | hp: u64 | hp_updated_ms: u64` = 60 bytes. The EMPTY Move struct
/// `ProgressionKey {}` serializes as ONE hidden `dummy_field: bool` byte — a 59-byte model without
/// it fails `bcs::from_bytes` on EVERY real DF (silent skip → `/v1` never carried XP/HP → the
/// production "xp went back to 0 on refresh"). The old self-round-trip fixture encoded the same wrong
/// model on both sides, so it could never catch this — real wire only.
const REAL_PROGRESSION_FIELD_BCS_HEX: &str =
    "9e16ac7d7ffe2bec7ae094639144e49ec2cb46d97b3b68b751848f8ad446d6ae0000090000000000000001001e000000000000001286c26f9f010000";

#[test]
fn progression_field_bcs_decodes_the_real_onchain_wire() {
    let bytes = hex::decode(REAL_PROGRESSION_FIELD_BCS_HEX).unwrap();
    assert_eq!(bytes.len(), 32 + 1 + 1 + 8 + 2 + 8 + 8); // 60 — the dummy_field byte is on the wire
    let decoded: ProgressionField = bcs::from_bytes(&bytes).expect("real progression DF bytes must decode");
    assert_eq!(
        (decoded.namespace, decoded.xp, decoded.level, decoded.hp, decoded.hp_updated_ms),
        (0, 9, 1, 30, 1_784_286_447_122)
    );
    let character = "0xc00f5791c883c391b704088a25ccd61cccb77ac805761d1762d4e7543a8adc79";
    let writes = map_progression_field(
        character,
        decoded.xp,
        decoded.level,
        decoded.hp,
        decoded.hp_updated_ms,
    );
    assert_eq!(set_json(&writes, "$.experience"), Some("9"));
    assert_eq!(set_json(&writes, "$.level"), Some("1"));
    assert_eq!(set_json(&writes, "$.current_hp"), Some("30"));
    assert_eq!(set_json(&writes, "$.hp_updated_ms"), Some("1784286447122"));
}

#[test]
fn is_progression_key_discriminates_from_the_other_character_dfs() {
    use std::str::FromStr;
    // Field<NsKey<ProgressionKey>, Progression> matches; the sibling Character DFs (job-xp / equipment,
    // same envelope) must NOT — the inner struct identity is the only signal.
    let prog = TypeTag::from_str("0x2::extension::NsKey<0x2::character_link::ProgressionKey>").unwrap();
    let job = TypeTag::from_str("0x2::extension::NsKey<0x2::character_link::JobXpKey>").unwrap();
    let equip = TypeTag::from_str("0x2::extension::NsKey<0x2::equipment::EquipmentKey>").unwrap();
    assert!(is_progression_key(&prog));
    assert!(!is_progression_key(&job));
    assert!(!is_progression_key(&equip));
    // Cross-guard: neither sibling arm claims the progression key (no double-projection).
    assert!(!is_job_xp_key(&prog));
    assert!(!is_equipment_key(&prog));
}

// ── Equipment-map + malus dynamic fields (the exact fight-authoritative signed fold) ─

fn test_equipment_stats(vitality: u64) -> EquipmentStats {
    EquipmentStats {
        vitality,
        wisdom: 0,
        strength: 0,
        intelligence: 0,
        chance: 0,
        agility: 0,
        range: 0,
        movement: 0,
        action: 0,
        critical: 0,
        raw_damage: 0,
        earth_resistance: 0,
        fire_resistance: 0,
        water_resistance: 0,
        air_resistance: 0,
    }
}

#[test]
fn equipment_state_projects_pet_truth_and_clears_identity() {
    // The api's `vitality` is ALLOCATED-only; `$.gear_vitality` is the equipped-gear sum the client
    // adds to derive max_hp. EquipmentMap.pet is the separate current equipped-pet truth. False
    // authoritatively clears any older sibling identity; true must not clear it because an unrelated
    // equipment-map mutation need not re-emit the already-equipped pet Item sibling.
    let character = "0x00000000000000000000000000000000000000000000000000000000000000c1";
    let mut absent_stats = test_equipment_stats(55);
    absent_stats.strength = 7;
    let absent = map_equipment_state(character, absent_stats, false, 488, 7);
    assert!(matches!(&absent[0], RedisWrite::Set { key, nx: true, .. } if key == &k_character(character)));
    assert_eq!(set_json(&absent, "$.gear_vitality"), Some("55"));
    assert!(set_json(&absent, "$.gear_positive").unwrap().contains(r#""strength":7"#));
    assert!(absent.iter().any(
        |w| matches!(w, RedisWrite::Set { path, nx: true, .. } if path == "$.gear_malus")
    ));
    assert_eq!(set_json(&absent, "$.pet_equipped"), Some("false"));
    assert_eq!(
        set_json(&absent, "$.gear_cursor"),
        Some(r#"{"checkpoint":488,"tx_index":7}"#)
    );
    assert_eq!(set_json(&absent, "$.pet"), Some("null"));

    let present = map_equipment_state(character, test_equipment_stats(89), true, 489, 8);
    assert_eq!(set_json(&present, "$.gear_vitality"), Some("89"));
    assert_eq!(set_json(&present, "$.pet_equipped"), Some("true"));
    assert_eq!(set_json(&present, "$.pet"), None);
    assert!(present.iter().all(|w| !matches!(w, RedisWrite::NumIncrBy { .. })));
}

#[test]
fn equipment_state_reads_constructed_pet_true_after_the_complete_variable_tail() {
    // CONSTRUCTED TRUE CASE — no live pet=true capture exists in-repo; NEEDS-LEAD before deploy.
    // This Move-derived `Field<NsKey<EquipmentKey>, EquipmentMap>` body proves the cursor lands on
    // `gear.vitality` (the 22nd/last Stats u64) AFTER walking the variable `singles`/`relic_templates`
    // vectors — and then reaches pet only AFTER all three variable Option fields. It is decode coverage,
    // never live-capture evidence.
    let mut b = Vec::new();
    b.extend_from_slice(&[0u8; 32]); // id: UID
    b.push(1); // NsKey.namespace = NS_CHARACTER_EQUIPMENT
    b.push(0); // EquipmentKey {} — an EMPTY Move struct is ONE hidden `dummy_field: bool` byte
    b.push(2);
    b.extend_from_slice(&[3, 5]); // singles: vector<u8> len 2
    b.push(4); // ring_count: u8
    b.push(1);
    b.extend_from_slice(&[0u8; 32]); // relic_templates: vector<ID> len 1
    b.extend_from_slice(&7u64.to_le_bytes()); // gear.strength (field 1) — must NOT be read as vitality
    for _ in 0..20 {
        b.extend_from_slice(&0u64.to_le_bytes()); // gear fields 2..=21
    }
    b.extend_from_slice(&42u64.to_le_bytes()); // gear.vitality (field 22/last)
    let option_tail = b.len();
    b.push(1); // weapon_item: Some
    b.extend_from_slice(&[9u8; 32]);
    b.push(1); // weapon_family: Some
    b.push(3); // String byte length
    b.extend_from_slice(b"bow");
    b.extend_from_slice(&[1, 7]); // tool_job: Some(7)
    b.push(1); // pet: true
    let decoded = equipment_state(&b).expect("complete Move-derived EquipmentMap wire must decode");
    assert_eq!((decoded.gear.strength, decoded.gear.vitality, decoded.pet_equipped), (7, 42, true));
    // A body truncated before the final pet bool yields None — never a guessed false.
    assert!(equipment_state(&b[..b.len() - 1]).is_none());
    let mut malformed_option = b.clone();
    malformed_option[option_tail] = 2;
    assert!(equipment_state(&malformed_option).is_none());
    let mut malformed_pet = b.clone();
    *malformed_pet.last_mut().unwrap() = 2;
    assert!(equipment_state(&malformed_pet).is_none());
}

/// RUNTIME PROVENANCE (same P1 sweep as the progression fixture): the exact 218 bytes of the LIVE
/// testnet equipment Field `0xc7cd0af3…00b7` (character `0xc00f5791…dc79`, one cloak equipped,
/// all-zero gear stats), fetched via `sui_getObject showBcs`. Wire prefix: `id(32) | namespace 0x01 |
/// EquipmentKey.dummy_field 0x00 | singles len 1 [0x0d] | ring_count 0 | relics len 0 | 22× u64 gear |
/// None×3 | pet false`. The pre-fix parser (which skipped only the namespace byte) walked this wire
/// one byte off and OVERRAN on the relics length → `None` → `$.gear_vitality` silently stale.
const REAL_EQUIPMENT_FIELD_BCS_HEX: &str =
    "c7cd0af3183c13f70965a5882f399546932f556b2feadfd4740c674ab79200b70100010d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

#[test]
fn equipment_gear_vitality_decodes_the_real_onchain_wire() {
    let bytes = hex::decode(REAL_EQUIPMENT_FIELD_BCS_HEX).unwrap();
    assert_eq!(bytes.len(), 218);
    let decoded = equipment_state(&bytes).expect("real equipment DF bytes including the tail must decode");
    assert_eq!((decoded.gear.vitality, decoded.pet_equipped), (0, false));
}

#[test]
fn equipment_malus_field_projects_only_the_private_namespaced_key() {
    let character = "0x00000000000000000000000000000000000000000000000000000000000000c1";
    let mut bytes = vec![0u8; 32]; // Field UID
    bytes.push(NS_CHARACTER_EQUIPMENT);
    bytes.extend_from_slice(&EQUIPMENT_MALUS_CACHE_KEY.to_le_bytes());
    for value in [
        3u64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2,
    ]
    .into_iter()
    {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    let writes = map_equipment_malus_field(character, &bytes).expect("private malus field must decode");
    let stats = set_json(&writes, "$.gear_malus").unwrap();
    assert!(stats.contains(r#""strength":3"#));
    assert!(stats.contains(r#""vitality":2"#));

    let mut wrong_key = bytes.clone();
    wrong_key[33..41].copy_from_slice(&0u64.to_le_bytes());
    assert!(map_equipment_malus_field(character, &wrong_key).is_none());
    assert!(map_equipment_malus_field(character, &bytes[..bytes.len() - 1]).is_none());
}

#[test]
fn equipment_malus_type_guard_requires_namespaced_u64_to_spell_stats() {
    use std::str::FromStr;
    let key = TypeTag::from_str("0xa11ce::extension::NsKey<u64>").unwrap();
    let wrong_key = TypeTag::from_str("0xa11ce::extension::NsKey<u8>").unwrap();
    let value = TypeTag::from_str("0xf00::spell::Stats").unwrap();
    let wrong_value = TypeTag::from_str("0xf00::spell::Effect").unwrap();
    assert!(is_namespaced_u64_key(&key));
    assert!(!is_namespaced_u64_key(&wrong_key));
    assert!(is_spell_stats_value(&value));
    assert!(!is_spell_stats_value(&wrong_value));
}

#[test]
fn is_equipment_key_discriminates_from_the_equipped_item_dfs() {
    use std::str::FromStr;
    let equip = TypeTag::from_str("0xa11ce::extension::NsKey<0xa11ce::equipment::EquipmentKey>").unwrap();
    // The sibling equipped-ITEM DFs sit under the SAME NS_CHARACTER_EQUIPMENT namespace, keyed by the
    // item id (`object::ID`) — only the inner struct NAME tells them apart.
    let item = TypeTag::from_str("0xa11ce::extension::NsKey<0x2::object::ID>").unwrap();
    let item_value = TypeTag::from_str("0xa11ce::item::Item").unwrap();
    let wrong_value = TypeTag::from_str("0xa11ce::item::ItemTemplate").unwrap();
    assert!(is_equipment_key(&equip));
    assert!(!is_equipment_key(&item));
    assert!(is_equipped_item_key(&item));
    assert!(!is_equipped_item_key(&equip));
    assert!(!is_equipment_key(&TypeTag::U64));
    assert!(!is_equipped_item_key(&TypeTag::U64));
    assert!(is_item_value(&item_value));
    assert!(!is_item_value(&wrong_value));
    assert!(!is_job_xp_key(&equip));
}

#[test]
fn equipped_pet_item_field_projects_the_move_derived_identity() {
    // NEEDS-LEAD: live capture verification required before deploy.
    // This synthetic wire independently mirrors Move's
    // `Field UID | NsKey.namespace | key ID | Item { id, template, name, item_type,
    // description, category, amount }` layout. It is decode coverage, never live-capture evidence.
    #[derive(serde::Serialize)]
    struct ChainItem {
        id: ObjectID,
        template: ObjectID,
        name: String,
        item_type: String,
        description: String,
        category: String,
        amount: u64,
    }
    #[derive(serde::Serialize)]
    struct ChainEquippedItemField {
        field_id: ObjectID,
        namespace: u8,
        key: ObjectID,
        value: ChainItem,
    }

    let character = ObjectID::from_hex_literal("0xc1").unwrap().to_canonical_string(true);
    let item_id = ObjectID::from_hex_literal("0xa001").unwrap();
    let template_id = ObjectID::from_hex_literal("0x7a01").unwrap();
    let field = ChainEquippedItemField {
        field_id: ObjectID::from_hex_literal("0xf1").unwrap(),
        namespace: 1,
        key: item_id,
        value: ChainItem {
            id: item_id,
            template: template_id,
            name: "Bouloute".into(),
            item_type: "pet_bouloute".into(),
            description: "A faithful companion.".into(),
            category: "pet".into(),
            amount: 1,
        },
    };
    let bytes = bcs::to_bytes(&field).unwrap();
    let writes = map_equipped_pet_field(&character, &bytes).expect("Move-derived pet Item field must decode");
    let pet: serde_json::Value = serde_json::from_str(set_json(&writes, "$.pet").unwrap()).unwrap();
    assert_eq!(
        pet,
        serde_json::json!({
            "item_id": item_id.to_canonical_string(true),
            "template_id": template_id.to_canonical_string(true),
            "slug": "pet_bouloute",
        })
    );

    let mut mismatched_key = bytes.clone();
    mismatched_key[64] ^= 1; // Field UID(32) + namespace(1) + the final byte of key ID(32)
    assert!(map_equipped_pet_field(&character, &mismatched_key).is_none());

    // The namespace and category are both load-bearing: another NsKey<ID> field or a non-pet
    // equipped Item must never become the character's pet identity.
    let wrong_namespace = ChainEquippedItemField {
        field_id: ObjectID::from_hex_literal("0xf2").unwrap(),
        namespace: 2,
        key: item_id,
        value: ChainItem {
            id: item_id,
            template: template_id,
            name: "Bouloute".into(),
            item_type: "pet_bouloute".into(),
            description: String::new(),
            category: "pet".into(),
            amount: 1,
        },
    };
    assert!(map_equipped_pet_field(&character, &bcs::to_bytes(&wrong_namespace).unwrap()).is_none());

    let non_pet = ChainEquippedItemField {
        field_id: ObjectID::from_hex_literal("0xf3").unwrap(),
        namespace: 1,
        key: item_id,
        value: ChainItem {
            id: item_id,
            template: template_id,
            name: "Iron Sword".into(),
            item_type: "sword_iron".into(),
            description: String::new(),
            category: "sword".into(),
            amount: 1,
        },
    };
    assert!(map_equipped_pet_field(&character, &bcs::to_bytes(&non_pet).unwrap()).is_none());
}

// ── Zone DF snapshot (the zone's seed + consumed-bitmaps — search-cost rework) ─

#[test]
fn zone_field_with_consumed_spawns_projects_both_bitmap_arrays() {
    // The mutated Zone DF re-emits on every search/claim/gather bit-flip; the snapshot writes the RAW
    // state (seed + bitmaps) — the client derives the rows, the api view derives the live counts.
    let world = "0x0000000000000000000000000000000000000000000000000000000000000e01";
    let z = ZoneField {
        id: ObjectID::from_hex_literal("0xf1").unwrap(),
        zx: 7,
        zy: 9,
        discovered_at_ms: 1_700_000_000_000,
        seed: u64::MAX, // must survive as a STRING (2^53 law) — the client String()s it into the derivation
        mob_bitmap: vec![0b0000_0101],
        res_bitmap: vec![0b0000_0010],
    };
    let bytes = bcs::to_bytes(&z).unwrap();
    let writes = map_zone_field(world, &bytes).expect("zone df must decode");

    // NX skeleton on the SAME rpc:zone:{world}:{zx}:{zy} doc the ZoneSearched event arm uses.
    assert!(matches!(&writes[0], RedisWrite::Set { key, nx: true, .. } if key == &k_zone(world, 7, 9)));
    assert_eq!(set_json(&writes, "$.discovered_at_ms"), Some("1700000000000")); // RAW stamp (client owns TTL)
    // The composition seed is a STRING (full u64); the bitmaps are plain byte arrays.
    assert_eq!(set_json(&writes, "$.seed"), Some(r#""18446744073709551615""#));
    assert_eq!(set_json(&writes, "$.mob_bitmap"), Some("[5]"));
    assert_eq!(set_json(&writes, "$.res_bitmap"), Some("[2]"));
    // The retired materialised-row paths must never reappear: fresh Zone DFs contain no such
    // vectors, and the API/frontend derive rows from the state asserted above.
    assert_eq!(set_json(&writes, "$.mobs"), None);
    assert_eq!(set_json(&writes, "$.resources"), None);
    // Zone indexed under the world; replay-safe (idempotent JSON.SET only, never a relative counter).
    assert!(has_sadd(&writes, &format!("rpc:idx:zones:{world}"), "7:9"));
    assert!(writes.iter().all(|w| !matches!(w, RedisWrite::NumIncrBy { .. })));
}

#[test]
fn zone_field_bcs_matches_the_onchain_df_layout() {
    // `id: UID(32) | zx: u32 | zy: u32 | discovered_at_ms: u64 | seed: u64 | mob_bitmap: Vec<u8> |
    // res_bitmap: Vec<u8>` — the zones.move field order. Fresh-search shape = two trailing ULEB
    // zero-length markers (1 byte each): a search stores NOTHING per-mob (the cost invariant).
    let z = ZoneField {
        id: ObjectID::from_hex_literal("0xf1").unwrap(),
        zx: 1,
        zy: 2,
        discovered_at_ms: 9,
        seed: 42,
        mob_bitmap: vec![],
        res_bitmap: vec![],
    };
    let bytes = bcs::to_bytes(&z).unwrap();
    assert_eq!(bytes.len(), 32 + 4 + 4 + 8 + 8 + 1 + 1);
    let decoded: ZoneField = bcs::from_bytes(&bytes).unwrap();
    assert_eq!((decoded.zx, decoded.zy, decoded.discovered_at_ms, decoded.seed), (1, 2, 9, 42));
    // A freshly-searched zone still projects (seed + empty bitmaps) — distinct from undiscovered (no doc
    // at all): the client derives the full advertised population from the seed alone.
    let writes = map_zone_field("0xe01", &bytes).expect("fresh zone still decodes");
    assert_eq!(set_json(&writes, "$.seed"), Some(r#""42""#));
    assert_eq!(set_json(&writes, "$.mob_bitmap"), Some("[]"));
}

#[test]
fn is_zone_key_discriminates_from_the_namespaced_character_dfs() {
    use std::str::FromStr;
    // The zone key is a PLAIN struct (no NsKey envelope); the character DFs are NsKey-wrapped.
    let zone = TypeTag::from_str("0x3::zones::ZoneKey").unwrap();
    let job = TypeTag::from_str("0x2::extension::NsKey<0x2::character_link::JobXpKey>").unwrap();
    assert!(is_zone_key(&zone));
    assert!(!is_zone_key(&job));
    assert!(!is_zone_key(&TypeTag::U64));
    // Cross-guard: no sibling arm claims the zone key, and the zone arm claims none of theirs.
    assert!(!is_job_xp_key(&zone));
    assert!(!is_progression_key(&zone));
    assert!(!is_equipment_key(&zone));
}

#[test]
fn zone_garbage_bytes_are_a_safe_none() {
    assert!(map_zone_field("0xe01", &[0x00, 0x01, 0x02]).is_none());
}

// ── ZoneGroupCommitment DF snapshot (fight-create compute diet — the search-committed root) ─

#[test]
fn group_root_field_projects_the_commitment_onto_the_zone_doc() {
    // `zones::search_zone` upserts `Field<ZoneGroupRootKey, ZoneGroupCommitment>` on the World's UID;
    // the snapshot merges `{root, count}` onto the SAME zone doc the seed/bitmaps ride, so `/v1/zones
    // ?zone=` serves every witness ingredient in ONE coherent read (the client-side
    // `compose_mob_group_proof` fails shut on any intra-doc mismatch). Short synthetic id (chain-id
    // gate: no new full-width 0x…64-hex literals) — the arm treats the parent id as an opaque string.
    let world = "0xe01";
    let f = ZoneGroupRootField {
        id: ObjectID::from_hex_literal("0xf2").unwrap(),
        zx: 7,
        zy: 9,
        root: (0u8..32).collect(),
        count: 64,
    };
    let bytes = bcs::to_bytes(&f).unwrap();
    let writes = map_group_root_field(world, &bytes).expect("commitment df must decode");

    // NX skeleton on the SAME rpc:zone:{world}:{zx}:{zy} doc (self-sufficient, like map_zone_field).
    assert!(matches!(&writes[0], RedisWrite::Set { key, nx: true, .. } if key == &k_zone(world, 7, 9)));
    // The 32-byte Blake2b root travels as a plain byte ARRAY (symmetric with the bitmaps — the SDK
    // composer accepts number[]); the count is a plain number (≤ 64 groups by construction on-chain).
    assert_eq!(
        set_json(&writes, "$.group_root"),
        Some(
            "[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]"
        )
    );
    assert_eq!(set_json(&writes, "$.group_count"), Some("64"));
    // Zone indexed under the world; replay-safe (idempotent JSON.SET only, never a relative counter).
    assert!(has_sadd(&writes, &format!("rpc:idx:zones:{world}"), "7:9"));
    assert!(writes.iter().all(|w| !matches!(w, RedisWrite::NumIncrBy { .. })));
}

#[test]
fn group_root_field_bcs_matches_the_onchain_df_layout() {
    // `id: UID(32) | zx: u32 | zy: u32 | root: Vec<u8> | count: u64` — the flattened
    // `Field { id, name: ZoneGroupRootKey{zx,zy}, value: ZoneGroupCommitment{root,count} }` envelope,
    // field order mirroring zones.move:50-51 byte-for-byte. A 32-byte root = 1 ULEB length byte + 32.
    let f = ZoneGroupRootField {
        id: ObjectID::from_hex_literal("0xf2").unwrap(),
        zx: 1,
        zy: 2,
        root: vec![0xAB; 32],
        count: 5,
    };
    let bytes = bcs::to_bytes(&f).unwrap();
    assert_eq!(bytes.len(), 32 + 4 + 4 + 1 + 32 + 8);
    let decoded: ZoneGroupRootField = bcs::from_bytes(&bytes).unwrap();
    assert_eq!((decoded.zx, decoded.zy, decoded.count), (1, 2, 5));
    assert_eq!(decoded.root, vec![0xAB; 32]);
}

#[test]
fn is_group_root_key_discriminates_from_the_zone_state_key() {
    use std::str::FromStr;
    // Both zone DFs are PLAIN struct keys in the SAME `zones` module on the SAME World parent —
    // only the struct NAME tells the seed/bitmap state apart from the group-root commitment.
    let root = TypeTag::from_str("0x3::zones::ZoneGroupRootKey").unwrap();
    let zone = TypeTag::from_str("0x3::zones::ZoneKey").unwrap();
    assert!(is_group_root_key(&root));
    assert!(!is_group_root_key(&zone));
    assert!(!is_group_root_key(&TypeTag::U64));
    // Cross-guard: the zone-state arm must not claim the commitment key, nor any character arm.
    assert!(!is_zone_key(&root));
    assert!(!is_job_xp_key(&root));
    assert!(!is_progression_key(&root));
    assert!(!is_equipment_key(&root));
}

#[test]
fn group_root_garbage_bytes_are_a_safe_none() {
    assert!(map_group_root_field("0xe01", &[0x00, 0x01, 0x02]).is_none());
}

// ── Origin gate for Phase-1 DF children (2026-07-24 ①-fix: the inbound-ghost leak) ──
// `results::open` / `zones::join_world` on an ORPHANED old-lineage package can still attach a
// byte-identical DF (job-xp/progression/equipment/malus/equipped-item/zone/group-root/stats-
// min/stats-max/damages) to a legacy parent — the `is_*_key` predicates above match purely by
// (module, name), so without this gate the write ghosts a fresh `rpc:character:{parent}` (or
// `rpc:zone:…`) doc into existence via the arm's own NX skeleton, even though the parent object
// itself never re-appears as an admitted Phase-2 output. `origin_admitted` is what `process`
// filters `key` through before ANY of the ten arms run — proven here at the same TypeTag level
// the `is_*_key_discriminates_…` tests above already use for the (module, name) half.

#[test]
fn orphaned_lineage_progression_key_is_rejected_fresh_lineage_is_admitted() {
    use std::str::FromStr;
    // Reuse the file's own correctly zero-padded origin constant rather than hand-typing a new
    // 64-hex-char literal (a hand-typed one silently under-padded here on the first attempt,
    // masking the real assertion behind a canonical-string mismatch).
    let fresh = FRESH_ARESRPG_ORIGIN;
    let orphaned = "0xd0";
    let handler = AresSnapshotHandler::new(Some(HashSet::from([fresh.to_string()])));

    let fresh_key =
        TypeTag::from_str(&format!("{fresh}::extension::NsKey<{fresh}::character_link::ProgressionKey>"))
            .unwrap();
    let orphaned_key = TypeTag::from_str(&format!(
        "{orphaned}::extension::NsKey<{orphaned}::character_link::ProgressionKey>"
    ))
    .unwrap();

    assert!(handler.origin_admitted(&fresh_key));
    assert!(!handler.origin_admitted(&orphaned_key));

    // The exact mechanism `process` runs: `key.filter(|k| self.origin_admitted(k))` collapses
    // an orphaned key to `None` before `key.is_some_and(is_progression_key)` — the real dispatch
    // condition — ever runs, even though the (module, name) shape is byte-identical and would
    // otherwise match.
    assert!(handler.origin_admitted(&fresh_key) && is_progression_key(&fresh_key));
    assert!(
        !(handler.origin_admitted(&orphaned_key) && is_progression_key(&orphaned_key)),
        "orphaned-lineage progression DF must NOT project"
    );
}

#[test]
fn orphaned_lineage_zone_key_is_rejected_the_unwrapped_struct_shape_too() {
    use std::str::FromStr;
    // The sibling key FAMILY (zones/item_stats/item_damages): a bare struct, no `NsKey<…>`
    // envelope. Proves the origin check is uniform across both key shapes, not just the wrapped one.
    let fresh = FRESH_ARESRPG_ORIGIN;
    let orphaned = "0xd0";
    let handler = AresSnapshotHandler::new(Some(HashSet::from([fresh.to_string()])));

    let fresh_key = TypeTag::from_str(&format!("{fresh}::zones::ZoneKey")).unwrap();
    let orphaned_key = TypeTag::from_str(&format!("{orphaned}::zones::ZoneKey")).unwrap();

    assert!(handler.origin_admitted(&fresh_key));
    assert!(!handler.origin_admitted(&orphaned_key));

    assert!(handler.origin_admitted(&fresh_key) && is_zone_key(&fresh_key));
    assert!(
        !(handler.origin_admitted(&orphaned_key) && is_zone_key(&orphaned_key)),
        "orphaned-lineage zone DF must NOT project"
    );
}

#[test]
fn unset_allowlist_admits_every_origin() {
    // Regression guard: local/dev runs with no ARES_PACKAGES configured must keep matching by
    // (module, name) alone, exactly like `admits`'s existing `None => true` contract — this gate
    // must never accidentally require an allowlist to be configured.
    use std::str::FromStr;
    let handler = AresSnapshotHandler::new(None);
    let any_origin = TypeTag::from_str("0xdeadbeef::zones::ZoneKey").unwrap();
    assert!(handler.origin_admitted(&any_origin));
}

#[test]
fn non_struct_key_is_conservatively_rejected() {
    // A primitive TypeTag carries no address, so it can never be admitted as an ORIGIN. This is
    // load-bearing, not hypothetical: the wrapped-World payload arm is keyed by a bare `u64`
    // (`Versioned` keys its payload by version), which is exactly why that arm gates on its VALUE
    // tag instead — see `world_inner_field_is_matched_by_the_u64_key_and_the_value_origin`.
    let handler = AresSnapshotHandler::new(None);
    assert!(!handler.origin_admitted(&TypeTag::U64));
}

// ── Taux (forgemagie) events ─────────────────────────────────────────────────

#[test]
fn board_created_records_the_taux_defaults() {
    let e = BoardCreated {
        board: ObjectID::from_hex_literal("0xb0").unwrap(),
        neutral_milli: 100_000,
        bracket_size: 20,
    };
    let writes = map_taux_event("BoardCreated", &bcs::to_bytes(&e).unwrap()).unwrap();
    assert_eq!(
        set_json(&writes, "$"),
        Some(r#"{"neutral_milli":100000,"bracket_size":20}"#)
    );
}

#[test]
fn crushed_stores_coefficient_bracket_and_pressure() {
    let template = ObjectID::from_hex_literal("0x5e21").unwrap();
    let e = Crushed {
        template,
        items: 3,
        total_weight: 500,
        coeff_after: 72_000, // 72%
        bracket: 2,
        pressure_after: 15_000,
    };
    let t = template.to_canonical_string(true);
    let writes = map_taux_event("Crushed", &bcs::to_bytes(&e).unwrap()).unwrap();
    assert_eq!(set_json(&writes, "$.coeff_milli"), Some("72000"));
    assert_eq!(set_json(&writes, "$.bracket"), Some("2"));
    assert_eq!(set_json(&writes, "$.snapshot"), Some("15000"));
    assert!(has_sadd(&writes, "rpc:idx:taux", &t));
    // the bracket's current monotone pressure is stored under its own key
    assert!(writes.iter().any(|w| matches!(w, RedisWrite::Set { key, json, .. }
        if key == "rpc:taux:bracket:2" && json == "15000")));
}

#[test]
fn recipeless_set_marks_the_row() {
    let gear = ObjectID::from_hex_literal("0x606d").unwrap();
    let e = RecipelessSet { gear_template: gear, recipe_less: true };
    let writes = map_taux_event("RecipelessSet", &bcs::to_bytes(&e).unwrap()).unwrap();
    assert_eq!(set_json(&writes, "$.recipe_less"), Some("true"));
    assert!(has_sadd(&writes, "rpc:idx:taux", &gear.to_canonical_string(true)));
}

#[test]
fn unindexed_forgemagie_event_is_none() {
    // RuneRegistered is a registry event, not a taux view — deferred.
    assert!(map_taux_event("RuneRegistered", &[]).is_none());
}

// ── Last-sale price (marketcap) — rpc:lastsale:{template} ────────────────────

#[test]
fn map_last_sale_writes_one_latest_wins_doc_with_string_price() {
    let t = "0x00000000000000000000000000000000000000000000000000000000000000aa";
    let writes = map_last_sale(t, 2_500_000_000, 1_700_000_000_000);
    assert_eq!(writes.len(), 1);
    // price_mist is a STRING (2^53 money law); ts = the checkpoint stamp; plain SET (no NX,
    // no NUMINCRBY) — latest checkpoint wins, replay re-SETs the same value (idempotent).
    assert_eq!(
        writes,
        vec![set(
            k_lastsale(t),
            "$",
            serde_json::json!({ "template": t, "price_mist": "2500000000", "ts": 1_700_000_000_000u64 }),
        )]
    );
}

#[test]
fn kiosk_purchase_per_unit_divides_a_stack_and_skips_the_extract_seam() {
    // A 5-unit stack sold for 10 SUI → 2 SUI per unit (floored).
    assert_eq!(kiosk_purchase_per_unit(10_000_000_000, 5), Some(2_000_000_000));
    // A unique NFT: whole price per its single unit.
    assert_eq!(kiosk_purchase_per_unit(7_000_000_000, 1), Some(7_000_000_000));
    // price == 0 is the EXTRACT SEAM's internal zero-price list+purchase (every equip / burn /
    // crush / merge) — stamping it would zero every touched template's last sale constantly.
    assert_eq!(kiosk_purchase_per_unit(0, 1), None);
    // amount == 0 can only be a test-minted ghost stack — refused, never divided by.
    assert_eq!(kiosk_purchase_per_unit(5_000_000_000, 0), None);
}

// ── ItemTemplate object snapshot (§14 encyclopedia name/level/category) ───────

#[test]
fn item_template_object_enriches_the_encyclopedia_doc() {
    let id = "0x00000000000000000000000000000000000000000000000000000000000000ab";
    let obj = ItemTemplateObject {
        id: ObjectID::from_hex_literal(id).unwrap(),
        name: "Bronze Sword".into(),
        description: "A sturdy blade.".into(),
        item_type: "bronze_sword".into(),
        category: "sword".into(),
        level: 12,
    };
    let writes = map_item_template_object(id, &bcs::to_bytes(&obj).unwrap()).expect("item template must decode");

    // Writes into the SAME rpc:template:{id} doc + rpc:idx:templates the event arm uses.
    assert!(matches!(&writes[0], RedisWrite::Set { key, nx: true, .. } if key == &k_template(id)));
    assert_eq!(set_json(&writes, "$.item_type"), Some(r#""bronze_sword""#));
    assert_eq!(set_json(&writes, "$.name"), Some(r#""Bronze Sword""#));
    assert_eq!(set_json(&writes, "$.description"), Some(r#""A sturdy blade.""#));
    assert_eq!(set_json(&writes, "$.category"), Some(r#""sword""#));
    assert_eq!(set_json(&writes, "$.level"), Some("12"));
    assert!(has_sadd(&writes, "rpc:idx:templates", id));
}

/// DRIFT GUARD (the 2026-07-12 fresh-publish `description` insertion). The round-trip test
/// above builds bytes from `ItemTemplateObject` itself, so it can NEVER catch a field
/// reorder/insertion — encode and decode drift in lockstep and stay green (exactly why the
/// break shipped). This pins the decode against an INDEPENDENT mirror of the CURRENT
/// `aresrpg::item::ItemTemplate` source order (item.move: id, name, description, item_type,
/// category, level). If `ItemTemplateObject` drifts from Move again, this fails: either the
/// decode returns `None` (trailing bytes) or a value lands on the wrong key.
#[test]
fn item_template_decodes_current_onchain_field_order() {
    #[derive(serde::Serialize)]
    struct ChainItemTemplate {
        id: ObjectID,
        name: String,
        description: String,
        item_type: String,
        category: String,
        level: u16,
    }
    let id = "0x00000000000000000000000000000000000000000000000000000000000000ab";
    let chain = ChainItemTemplate {
        id: ObjectID::from_hex_literal(id).unwrap(),
        name: "Bronze Sword".into(),
        description: "A sturdy blade.".into(),
        item_type: "bronze_sword".into(),
        category: "sword".into(),
        level: 12,
    };
    let writes = map_item_template_object(id, &bcs::to_bytes(&chain).unwrap())
        .expect("current-layout ItemTemplate must decode");
    // Every field lands on its OWN key — not `description` bleeding into `item_type` (the drift symptom).
    assert_eq!(set_json(&writes, "$.name"), Some(r#""Bronze Sword""#));
    assert_eq!(set_json(&writes, "$.description"), Some(r#""A sturdy blade.""#));
    assert_eq!(set_json(&writes, "$.item_type"), Some(r#""bronze_sword""#));
    assert_eq!(set_json(&writes, "$.category"), Some(r#""sword""#));
    assert_eq!(set_json(&writes, "$.level"), Some("12"));
}

// ── Item-template stat-range dynamic fields (issue #219 — encyclopedia characteristics) ──────

#[test]
fn item_stats_min_field_projects_the_named_block_onto_the_template_doc() {
    let id = "0x00000000000000000000000000000000000000000000000000000000000000ab";
    let f = ItemStatsField {
        id: ObjectID::from_hex_literal("0xdf1").unwrap(),
        dummy_field: false,
        vitality: 32_800,
        wisdom: 32_768,
        strength: 32_768,
        intelligence: 32_768,
        chance: 32_768,
        agility: 32_768,
        range: 32_768,
        movement: 32_768,
        action: 32_768,
        critical: 32_768,
        raw_damage: 32_768,
        critical_chance: 32_768,
        critical_outcomes: 32_768,
        earth_resistance: 32_768,
        fire_resistance: 32_768,
        water_resistance: 32_768,
        air_resistance: 32_768,
    };
    let writes =
        map_item_stats_min_field(id, &bcs::to_bytes(&f).unwrap()).expect("item stats min DF must decode");

    // Self-sufficient: NX skeleton first (a stats DF can land before TemplateCreated/the object snapshot).
    assert!(matches!(&writes[0], RedisWrite::Set { key, nx: true, .. } if key == &k_template(id)));
    // Structural comparison (never a hand-guessed key order — this crate's `serde_json` resolves
    // with `preserve_order`/`indexmap`, so `Value::eq` is the only order-independent check).
    let stats_min: Value = serde_json::from_str(set_json(&writes, "$.stats_min").unwrap()).unwrap();
    assert_eq!(
        stats_min,
        json!({
            "vitality": 32800, "wisdom": 32768, "strength": 32768, "intelligence": 32768, "chance": 32768,
            "agility": 32768, "range": 32768, "movement": 32768, "action": 32768, "critical": 32768,
            "raw_damage": 32768, "critical_chance": 32768, "critical_outcomes": 32768, "earth_resistance": 32768,
            "fire_resistance": 32768, "water_resistance": 32768, "air_resistance": 32768,
        })
    );
    assert!(has_sadd(&writes, "rpc:idx:templates", id));
}

#[test]
fn item_stats_max_field_projects_onto_the_sibling_stats_max_path() {
    let id = "0x00000000000000000000000000000000000000000000000000000000000000ab";
    let f = ItemStatsField {
        id: ObjectID::from_hex_literal("0xdf2").unwrap(),
        dummy_field: false,
        vitality: 33_000,
        wisdom: 32_768,
        strength: 32_768,
        intelligence: 32_768,
        chance: 32_768,
        agility: 32_768,
        range: 32_768,
        movement: 32_768,
        action: 32_768,
        critical: 32_768,
        raw_damage: 32_768,
        critical_chance: 32_768,
        critical_outcomes: 32_768,
        earth_resistance: 32_768,
        fire_resistance: 32_768,
        water_resistance: 32_768,
        air_resistance: 32_768,
    };
    let writes =
        map_item_stats_max_field(id, &bcs::to_bytes(&f).unwrap()).expect("item stats max DF must decode");
    assert!(matches!(&writes[0], RedisWrite::Set { key, nx: true, .. } if key == &k_template(id)));
    // Independent sub-path from the min half — no cross-DF read-modify-write.
    assert!(set_json(&writes, "$.stats_min").is_none());
    assert!(set_json(&writes, "$.stats_max").unwrap().contains(r#""vitality":33000"#));
    assert!(has_sadd(&writes, "rpc:idx:templates", id));
}

/// RUNTIME PROVENANCE (issue #219): the exact 67 bytes of the LIVE testnet `StatsMinKey` dynamic
/// field `0x0c426977…8a870` on ItemTemplate `0xec8b1444…30225` ("Windbreak", a level-113
/// chestplate; the min/max ranges are attached ATOMICALLY by `item_stats::attach_ranges` in the
/// SAME transaction `EQJvWvJKEfFi4vZ1jta8Azw2pGx2PNdewphdqeZ58RLn`, version 940290060, digest
/// `CADV49BpTWzaB2Fc7taehG6F4N3cme2VsWZZPfmKQm1s`) — fetched via `sui client dynamic-field
/// <template> --json` (the CLI's own gRPC config; testnet JSON-RPC is dead — see
/// reference_sui_testnet_rpc_endpoint), reading the `fieldObject.contents.value` BCS bytes (the
/// Move object's own contents, exactly what `MoveObject::contents()` hands `process()`). Proves
/// the `StatsMinKey {}` empty-struct wire (`id:UID(32) | dummy_field:bool(1) | 17×u16`) matches
/// the live chain byte-for-byte, not just a self-encoded round trip (the SAME class of bug the
/// Progression DF's `dummy_field` omission shipped — P1 xp-reset-on-refresh, 2026-07-17).
const REAL_STATS_MIN_FIELD_BCS_HEX: &str = "0c42697752fcbc484f0de9bcfe8d7627e6d4769052806f55589650bad9e8a8700014800080118000800080008000800080008000800080008000800080008000800280";

#[test]
fn item_stats_min_field_bcs_decodes_the_real_onchain_wire() {
    let bytes = hex::decode(REAL_STATS_MIN_FIELD_BCS_HEX).unwrap();
    assert_eq!(bytes.len(), 32 + 1 + 17 * 2); // 67 — id | dummy_field | 17 × u16
    let decoded: ItemStatsField = bcs::from_bytes(&bytes).expect("real StatsMinKey DF bytes must decode");
    // Live values (SHIFT_U16 = 32768 centre): vitality/strength/air_resistance carry the authored
    // MIN bonus, every other field sits at the neutral centre.
    assert_eq!(
        (decoded.vitality, decoded.strength, decoded.air_resistance, decoded.wisdom),
        (32_788, 32_785, 32_770, 32_768)
    );

    let id = "0xec8b1444018aa34a552289698500fb0e5d6cf62eec29c0d80ce7ca7bdab30225";
    let writes = map_item_stats_min_field(id, &bytes).expect("must project");
    let stats_min = set_json(&writes, "$.stats_min").unwrap();
    assert!(stats_min.contains(r#""vitality":32788"#));
    assert!(stats_min.contains(r#""strength":32785"#));
    assert!(stats_min.contains(r#""air_resistance":32770"#));
    assert!(stats_min.contains(r#""wisdom":32768"#));
}

/// RUNTIME PROVENANCE (issue #219): the sibling `StatsMaxKey` field `0xf84bfef9…5143c0` on the
/// SAME ItemTemplate/transaction as the MIN fixture above (version 940290060, digest
/// `CriMK2o4FrefRA4jvtgBbofJFKnj9ndNvWciog7uzSTw`) — captured + fetched identically.
const REAL_STATS_MAX_FIELD_BCS_HEX: &str = "f84bfef99eeb94c3c3aed833890ac5db6fb711549d3008f8ccd8a8ccbd5143c00064800080558000800080008000800080008004800080008000800080008000800a80";

#[test]
fn item_stats_max_field_bcs_decodes_the_real_onchain_wire() {
    let bytes = hex::decode(REAL_STATS_MAX_FIELD_BCS_HEX).unwrap();
    assert_eq!(bytes.len(), 32 + 1 + 17 * 2);
    let decoded: ItemStatsField = bcs::from_bytes(&bytes).expect("real StatsMaxKey DF bytes must decode");
    assert_eq!(
        (decoded.vitality, decoded.strength, decoded.critical, decoded.air_resistance),
        (32_868, 32_853, 32_772, 32_778)
    );

    let id = "0xec8b1444018aa34a552289698500fb0e5d6cf62eec29c0d80ce7ca7bdab30225";
    let writes = map_item_stats_max_field(id, &bytes).expect("must project");
    let stats_max = set_json(&writes, "$.stats_max").unwrap();
    assert!(stats_max.contains(r#""vitality":32868"#));
    assert!(stats_max.contains(r#""strength":32853"#));
    assert!(stats_max.contains(r#""critical":32772"#));
    assert!(stats_max.contains(r#""air_resistance":32778"#));
}

#[test]
fn is_stats_min_max_key_discriminate_from_each_other_and_the_zone_key() {
    use std::str::FromStr;
    // Plain struct keys (NOT `NsKey`-wrapped) — mirrors the zone-key discrimination shape.
    let min = TypeTag::from_str("0xa11ce::item_stats::StatsMinKey").unwrap();
    let max = TypeTag::from_str("0xa11ce::item_stats::StatsMaxKey").unwrap();
    let zone = TypeTag::from_str("0xa11ce::zones::ZoneKey").unwrap();
    assert!(is_stats_min_key(&min));
    assert!(!is_stats_min_key(&max));
    assert!(!is_stats_min_key(&zone));
    assert!(is_stats_max_key(&max));
    assert!(!is_stats_max_key(&min));
    assert!(!is_stats_max_key(&zone));
    // Cross-guard: neither sibling arm claims the other's key, and the address is IGNORED
    // (match-by-(module,name), the same trust the sibling arms run under while unset).
    assert!(!is_zone_key(&min));
    assert!(!is_zone_key(&max));
    assert!(!is_stats_min_key(&TypeTag::U64));
    assert!(!is_stats_max_key(&TypeTag::U64));
}

#[test]
fn item_stats_field_garbage_bytes_are_a_safe_none() {
    assert!(map_item_stats_min_field("0xab", &[0x00, 0x01, 0x02]).is_none());
    assert!(map_item_stats_max_field("0xab", &[0x00, 0x01, 0x02]).is_none());
}

// ── Item damages projection (issue #619 leg 3: /v1's item shape had no damages field) ──

#[test]
fn is_damages_key_discriminates_from_the_stats_keys_and_the_zone_key() {
    use std::str::FromStr;
    let damages = TypeTag::from_str("0xa11ce::item_damages::DamagesKey").unwrap();
    let min = TypeTag::from_str("0xa11ce::item_stats::StatsMinKey").unwrap();
    assert!(is_damages_key(&damages));
    assert!(!is_damages_key(&min));
    assert!(!is_damages_key(&TypeTag::U64));
    // Cross-guard: the sibling stats arms never claim the damages key either.
    assert!(!is_stats_min_key(&damages));
    assert!(!is_stats_max_key(&damages));
}

#[test]
fn item_damages_field_projects_a_multi_element_line_array() {
    let id = "0x00000000000000000000000000000000000000000000000000000000000000ad";
    let f = ItemDamagesField {
        id: ObjectID::from_hex_literal("0xdf3").unwrap(),
        dummy_field: false,
        lines: vec![
            ItemDamagesLine { from: 22, to: 39, damage_type: "weapon".into(), element: "earth".into() },
            ItemDamagesLine { from: 19, to: 36, damage_type: "weapon".into(), element: "air".into() },
        ],
    };
    let writes = map_item_damages_field(id, &bcs::to_bytes(&f).unwrap()).expect("item damages DF must decode");
    assert!(matches!(&writes[0], RedisWrite::Set { key, nx: true, .. } if key == &k_template(id)));
    let damages = set_json(&writes, "$.damages").unwrap();
    assert!(damages.contains(r#"{"element":"earth","from":22,"to":39,"damage_type":"weapon"}"#), "{damages}");
    assert!(damages.contains(r#"{"element":"air","from":19,"to":36,"damage_type":"weapon"}"#), "{damages}");
    assert!(has_sadd(&writes, "rpc:idx:templates", id));
}

/// RUNTIME PROVENANCE (issue #619): the exact 66 bytes of the LIVE testnet `DamagesKey` dynamic
/// field `0xa6f55cd6…bffc1f9` on ItemTemplate `0x76faa8b1…7f7f49b` ("Longdraw", a bow — a
/// two-line multi-element weapon, earth + air) fetched via `sui client dynamic-field <template>
/// --json` (the CLI's own gRPC config; testnet JSON-RPC is dead — see
/// reference_sui_testnet_rpc_endpoint), reading `fieldObject.contents.value`. Proves the
/// `DamagesKey {}` empty-struct wire (`id:UID(32) | dummy_field:bool(1) | vector<ItemDamages>`)
/// matches the live chain byte-for-byte, not just a self-encoded round trip.
const REAL_LONGDRAW_DAMAGES_BCS_HEX: &str = "a6f55cd63c10abf995392f4f07f980a77d0d91f92010eb53418cc2376bffc1f900021600270006776561706f6e0565617274681300240006776561706f6e03616972";

#[test]
fn real_testnet_longdraw_damages_bcs_decodes_the_real_onchain_wire() {
    let bytes = hex::decode(REAL_LONGDRAW_DAMAGES_BCS_HEX).unwrap();
    let decoded: ItemDamagesField = bcs::from_bytes(&bytes).expect("real DamagesKey DF bytes must decode");
    assert_eq!(decoded.lines.len(), 2);
    assert_eq!((decoded.lines[0].from, decoded.lines[0].to, decoded.lines[0].element.as_str()), (22, 39, "earth"));
    assert_eq!((decoded.lines[1].from, decoded.lines[1].to, decoded.lines[1].element.as_str()), (19, 36, "air"));

    let id = "0x76faa8b18c3aba367f51640fd676502d95a902a8bdcf53b8e4d4ca7cc7f7f49b";
    let writes = map_item_damages_field(id, &bytes).expect("must project");
    let damages = set_json(&writes, "$.damages").unwrap();
    assert!(damages.contains(r#"{"element":"earth","from":22,"to":39,"damage_type":"weapon"}"#), "{damages}");
    assert!(damages.contains(r#"{"element":"air","from":19,"to":36,"damage_type":"weapon"}"#), "{damages}");
}

#[test]
fn item_damages_field_garbage_bytes_are_a_safe_none() {
    assert!(map_item_damages_field("0xab", &[0x00, 0x01, 0x02]).is_none());
}

// ── Item object snapshot (the /v1/owner-items loose bag) ──────────────────────

#[test]
fn item_object_snapshots_display_fields_and_kiosk_membership() {
    let id = "0x000000000000000000000000000000000000000000000000000000000000a001";
    let kiosk = "0x6b1ff2a365e231af5c80ca741c8739d47a757489d375bdf87f9297633555eb62";
    let tpl = ObjectID::from_hex_literal("0x7a01").unwrap();
    let obj = ItemObject {
        id: ObjectID::from_hex_literal(id).unwrap(),
        template: tpl,
        name: "Iron Sword".into(),
        item_type: "sword_iron".into(),
        description: "Forged in the deep.".into(),
        category: "sword".into(),
        amount: 1,
    };
    let bytes = bcs::to_bytes(&obj).unwrap();

    let package = NARROW_EFFECT_ARESRPG_ORIGIN;

    // Resolved kiosk → the item doc carries name/category/amount/template + kiosk_id, and the
    // item joins its kiosk's membership set (the two halves an owner-items join reads).
    let writes = map_item_object(id, &bytes, Some(kiosk), package).expect("item bytes must decode");
    assert!(matches!(&writes[0], RedisWrite::Set { key, nx: true, .. } if key == &k_item(id)));
    assert_eq!(set_json(&writes, "$.name"), Some(r#""Iron Sword""#));
    assert_eq!(set_json(&writes, "$.item_type"), Some(r#""sword_iron""#));
    assert_eq!(set_json(&writes, "$.description"), Some(r#""Forged in the deep.""#));
    assert_eq!(set_json(&writes, "$.category"), Some(r#""sword""#));
    assert_eq!(set_json(&writes, "$.amount"), Some("1"));
    assert_eq!(set_json(&writes, "$.template"), Some(format!("\"{}\"", tpl.to_canonical_string(true)).as_str()));
    assert_eq!(set_json(&writes, "$.kiosk_id"), Some(format!("\"{kiosk}\"").as_str()));
    // issue #524 server half: the object's OWN package id, so the frontend's dead-universe
    // lineage filter (`is_aresrpg_item`) can run on the PRIMARY `/v1/owner-items` path.
    assert_eq!(set_json(&writes, "$.package"), Some(format!("\"{package}\"").as_str()));
    assert!(has_sadd(&writes, &format!("rpc:idx:kiosk_items:{kiosk}"), id));

    // Unresolved kiosk → NO kiosk_id / kiosk_items write (never fabricate; the row waits for a
    // checkpoint where the wrapper is an output object — mint/place/trade always are).
    let no_kiosk = map_item_object(id, &bytes, None, package).unwrap();
    assert!(no_kiosk.iter().all(|w| !matches!(w, RedisWrite::Set { path, .. } if path == "$.kiosk_id")));
    assert!(no_kiosk
        .iter()
        .all(|w| !matches!(w, RedisWrite::SetAdd { key, .. } if key.starts_with("rpc:idx:kiosk_items:"))));
    // `package` is written regardless of kiosk resolution — it comes off the object's own type,
    // not the kiosk join.
    assert_eq!(set_json(&no_kiosk, "$.package"), Some(format!("\"{package}\"").as_str()));
}

#[test]
fn item_garbage_bytes_are_a_safe_none() {
    assert!(map_item_object("0xabc", &[0x00, 0x01, 0x02], None, "0xdead").is_none());
}

/// DRIFT GUARD for the `Item` bag decode (same 2026-07-12 `description` insertion, between
/// `item_type` and `category`). Independent mirror of the CURRENT `aresrpg::item::Item`
/// source order (item.move: id, template, name, item_type, description, category, amount);
/// catches a future `ItemObject` reorder the symmetric round-trip test above cannot.
#[test]
fn item_object_decodes_current_onchain_field_order() {
    #[derive(serde::Serialize)]
    struct ChainItem {
        id: ObjectID,
        template: ObjectID,
        name: String,
        item_type: String,
        description: String,
        category: String,
        amount: u64,
    }
    let id = "0x000000000000000000000000000000000000000000000000000000000000a001";
    let chain = ChainItem {
        id: ObjectID::from_hex_literal(id).unwrap(),
        template: ObjectID::from_hex_literal("0x7a01").unwrap(),
        name: "Iron Sword".into(),
        item_type: "sword_iron".into(),
        description: "Forged in the deep.".into(),
        category: "sword".into(),
        amount: 1,
    };
    let writes = map_item_object(id, &bcs::to_bytes(&chain).unwrap(), None, "0xdead")
        .expect("current-layout Item must decode");
    assert_eq!(set_json(&writes, "$.name"), Some(r#""Iron Sword""#));
    assert_eq!(set_json(&writes, "$.item_type"), Some(r#""sword_iron""#));
    assert_eq!(set_json(&writes, "$.description"), Some(r#""Forged in the deep.""#));
    assert_eq!(set_json(&writes, "$.category"), Some(r#""sword""#));
    assert_eq!(set_json(&writes, "$.amount"), Some("1"));
}

// ── PersonalKioskCap object snapshot (wallet↔kiosk edge) ───────────────────────

/// RUNTIME PROVENANCE: the exact 97 bytes of the live testnet PersonalKioskCap
/// `0x13c0a3…eb29` (holder `0x3d13…2983`) fetched via `sui_getObject showBcs` — proves the Rust
/// struct decodes the wrapped `KioskOwnerCap.for` (the kiosk id) byte-for-byte THROUGH the
/// `Option` tag. This wallet is multi-kiosk: this cap controls kiosk `0xc773…7204`, a SIBLING
/// of the kiosk holding its character (`0x6b1f…eb62`) — exactly the stranded-item union case.
const REAL_PERSONAL_KIOSK_CAP_BCS_HEX: &str = "13c0a3ced5a7553414a9d6e9924d0f0ddc41e6cf158f068a200dfd860e4beb290111ac083cd815436c752a50c20da3891bdd8184dd893ddc1fbf13a334dbaaf29dc773a959874101ad19de80a6addd29b7a51ba9cd391179d8fd8034e5c7f27204";

#[test]
fn real_testnet_personal_kiosk_cap_projects_owner_edge() {
    let bytes = hex::decode(REAL_PERSONAL_KIOSK_CAP_BCS_HEX).unwrap();
    let cap_id = "0x13c0a3ced5a7553414a9d6e9924d0f0ddc41e6cf158f068a200dfd860e4beb29";
    let kiosk = "0xc773a959874101ad19de80a6addd29b7a51ba9cd391179d8fd8034e5c7f27204";
    let owner = SuiAddress::from_bytes([0x3d; 32]).unwrap(); // the edge keys by the AddressOwner
    let writes = map_personal_kiosk_cap(cap_id, &bytes, &Owner::AddressOwner(owner)).expect("real cap must decode");

    // owner → kiosk membership + the per-kiosk doc carrying the cap id (client's kiosk_cap_id).
    assert!(has_sadd(&writes, &format!("rpc:idx:owner_kiosks:{owner}"), kiosk));
    let doc = set_json(&writes, "$").expect("cap writes the kiosk doc");
    assert!(doc.contains(&format!(r#""kiosk_id":"{kiosk}""#)), "doc: {doc}");
    assert!(doc.contains(&format!(r#""cap_id":"{cap_id}""#)), "doc: {doc}");
    // The kiosk doc is CREATE-ONCE (nx) — the immutable-edge invariant that makes a forged
    // look-alike cap unable to overwrite a victim's cap_id (the real cap wins the NX at creation).
    assert!(writes
        .iter()
        .any(|w| matches!(w, RedisWrite::Set { key, nx: true, .. } if key == &format!("rpc:kiosk:{kiosk}"))));
    // No relative counters on the ownership edge (replay-safe like every other write here).
    assert!(writes.iter().all(|w| !matches!(w, RedisWrite::NumIncrBy { .. })));
}

#[test]
fn personal_kiosk_cap_non_address_owner_or_garbage_is_none() {
    let bytes = hex::decode(REAL_PERSONAL_KIOSK_CAP_BCS_HEX).unwrap();
    let wrapper = SuiAddress::from_bytes([0xbb; 32]).unwrap();
    // Soulbound by construction — a non-address owner is pathological → not projected.
    assert!(map_personal_kiosk_cap("0xdead", &bytes, &Owner::ObjectOwner(wrapper)).is_none());
    // Garbage bytes → safe None (never panics the batch).
    assert!(map_personal_kiosk_cap("0xdead", &[0x00, 0x01], &Owner::AddressOwner(wrapper)).is_none());
}

// ── MobTemplate prefix snapshot (§14 bestiary name/level-range/hp/element) ────

/// Assemble a synthetic `MobTemplate` BCS body: the scalar prefix the snapshot reads
/// (`id | name | min_level | max_level | base_hp | ap | mp | element`) followed by
/// arbitrary TRAILING bytes standing in for the real `stats`/`spells`/`loot`/`xp` —
/// proving the prefix parser reads the head and TOLERATES the (undecoded) tail.
fn mob_template_bytes(name: &str, min: u16, max: u16, hp: u64, element: u8, trailing: &[u8]) -> Vec<u8> {
    let mut b = vec![0xabu8; 32]; // UID (bare 32-byte ObjectID)
    b.push(name.len() as u8); // ULEB128 length (single byte for a short name)
    b.extend_from_slice(name.as_bytes());
    b.extend_from_slice(&min.to_le_bytes());
    b.extend_from_slice(&max.to_le_bytes());
    b.extend_from_slice(&hp.to_le_bytes());
    b.extend_from_slice(&6u64.to_le_bytes()); // ap (skipped)
    b.extend_from_slice(&3u64.to_le_bytes()); // mp (skipped)
    b.push(element);
    b.extend_from_slice(trailing); // stats/spells/loot/xp — never decoded
    b
}

/// Deploy config owns the real 374-row custody manifest. This deliberately invented three-row
/// fixture preserves its exact `{key,name,id}` shape — including the full-width 64-hex Sui object
/// id, built at runtime by [`synthetic_object_id`] so source carries no live-shaped literal —
/// without copying any live custody truth into the repository.
fn synthetic_mob_canonical_manifest() -> String {
    let rows = [
        ("alley_bunny", "Alley Bunny", "0xb1"),
        ("clockwork_heron", "Clockwork Heron", "0xb2"),
        ("velvet_slime", "Velvet Slime", "0xb3"),
    ]
    .map(|(key, name, short)| {
        format!(r#"  {{"key":"{key}","name":"{name}","id":"{}"}}"#, synthetic_object_id(short))
    })
    .join(",\n");
    format!("[\n{rows}\n]")
}

#[test]
fn mob_canonical_allowlist_filters_a_projection_walk_and_unset_warns_fail_open() {
    fn walk(handler: &AresSnapshotHandler, rows: &[(&str, &[u8])]) -> Vec<RedisWrite> {
        let mut writes = Vec::new();
        let mut skipped = 0;
        for (id, bytes) in rows {
            match handler.project_mob_template(id, bytes, NARROW_EFFECT_ARESRPG_ORIGIN) {
                MobTemplateProjection::Writes(mut mapped) => writes.append(&mut mapped),
                MobTemplateProjection::SkippedNonCanonical => skipped += 1,
                MobTemplateProjection::Malformed => {}
            }
        }
        handler.log_mob_template_skips(skipped, 42);
        writes
    }

    let manifest = synthetic_mob_canonical_manifest();
    let canonical =
        parse_mob_canonical_ids(manifest.as_bytes()).expect("synthetic custody-manifest shape must parse");
    assert_eq!(canonical.len(), 3);

    let included_id = synthetic_object_id("0xb1");
    let excluded_id = synthetic_object_id("0xbad");
    let included = included_id.as_str();
    let excluded = excluded_id.as_str();
    let included_bytes = mob_template_bytes("Alley Bunny", 1, 2, 12, 3, &[]);
    // The real exclusion shape: a SUPERSEDED TWIN — the census awards "Alley Bunny" to the id
    // above, so this second object carrying the same display name is the flat orphan the
    // adjudication ruled against. (A body whose name the census never adjudicated is a different
    // case entirely — `a_mob_minted_after_the_census_still_projects` below owns it.)
    let excluded_bytes = mob_template_bytes("Alley Bunny", 1, 2, 12, 3, &[]);
    let rows = [
        (included, included_bytes.as_slice()),
        (excluded, excluded_bytes.as_slice()),
    ];

    let configured_path = std::env::temp_dir().join(format!(
        "ares-mob-canonical-allowlist-configured-{}.json",
        std::process::id()
    ));
    std::fs::write(&configured_path, &manifest).unwrap();
    let configured_log = SharedLog::default();
    let configured_writer = configured_log.clone();
    let configured_subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .with_max_level(tracing::Level::DEBUG)
        .without_time()
        .with_writer(move || configured_writer.clone())
        .finish();
    let configured_writes = tracing::subscriber::with_default(configured_subscriber, || {
        let handler = AresSnapshotHandler::from_path(None, Some(configured_path.as_os_str()));
        walk(&handler, &rows)
    });
    std::fs::remove_file(&configured_path).unwrap();
    assert!(has_sadd(&configured_writes, K_MOB_TEMPLATES, included));
    assert!(!has_sadd(&configured_writes, K_MOB_TEMPLATES, excluded));
    let configured_log = configured_log.contents();
    assert_eq!(
        configured_log
            .matches("skipped non-canonical mob templates")
            .count(),
        1
    );
    assert!(
        configured_log.contains("skipped=1"),
        "log: {configured_log}"
    );
    assert!(!configured_log.contains("mob canonical allowlist not configured"));

    let fail_open_log = SharedLog::default();
    let fail_open_writer = fail_open_log.clone();
    let fail_open_subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .with_max_level(tracing::Level::DEBUG)
        .without_time()
        .with_writer(move || fail_open_writer.clone())
        .finish();
    let fail_open_writes = tracing::subscriber::with_default(fail_open_subscriber, || {
        let handler = AresSnapshotHandler::from_parts(None, None);
        walk(&handler, &rows)
    });
    assert!(has_sadd(&fail_open_writes, K_MOB_TEMPLATES, included));
    assert!(has_sadd(&fail_open_writes, K_MOB_TEMPLATES, excluded));
    let fail_open_log = fail_open_log.contents();
    assert_eq!(
        fail_open_log
            .matches("mob canonical allowlist not configured — projecting all templates, duplicates possible")
            .count(),
        1,
        "log: {fail_open_log}"
    );

    let unreadable_log = SharedLog::default();
    let unreadable_writer = unreadable_log.clone();
    let unreadable_subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .with_max_level(tracing::Level::DEBUG)
        .without_time()
        .with_writer(move || unreadable_writer.clone())
        .finish();
    let missing_path = std::env::temp_dir().join(format!(
        "ares-mob-canonical-allowlist-missing-{}.json",
        std::process::id()
    ));
    assert!(!missing_path.exists(), "test requires an unreadable path");
    let unreadable_writes = tracing::subscriber::with_default(unreadable_subscriber, || {
        let handler = AresSnapshotHandler::from_path(None, Some(missing_path.as_os_str()));
        walk(&handler, &rows)
    });
    assert!(has_sadd(&unreadable_writes, K_MOB_TEMPLATES, included));
    assert!(has_sadd(&unreadable_writes, K_MOB_TEMPLATES, excluded));
    let unreadable_log = unreadable_log.contents();
    assert_eq!(
        unreadable_log
            .matches("mob canonical allowlist not configured — projecting all templates, duplicates possible")
            .count(),
        1,
        "log: {unreadable_log}"
    );
}

/// RED-FIRST (2026-07-28): nine dungeon bosses were minted on the live lineage and never entered the
/// index — `rpc:mob_template:*` held exactly the census's own row count and not one id more. The gate
/// was reading the twin-adjudication census as an id ALLOWLIST, so EVERY template minted after that
/// file was written was "non-canonical" by construction: a new mob's id cannot appear in a list that
/// predates its mint, and no amount of replay changes that — only a manifest edit, a restart, and a
/// full re-anchor. The census can only refuse a DISPLAY NAME it adjudicated (see `MobCanonicalCensus`);
/// a name it never contested belongs to a mob only the chain knows about.
#[test]
fn a_mob_minted_after_the_census_still_projects() {
    let manifest = synthetic_mob_canonical_manifest();
    let census =
        parse_mob_canonical_ids(manifest.as_bytes()).expect("synthetic custody-manifest shape must parse");
    let handler = AresSnapshotHandler::from_parts(None, Some(census));

    // A mob minted AFTER the census was written: an id no row can carry, and a display name no row
    // ever adjudicated. Nothing about it is contested — it must reach the bestiary.
    let fresh_id = synthetic_object_id("0xf5e5");
    let fresh_bytes = mob_template_bytes("Voltstripe the Stormfang", 40, 40, 4200, 3 /* AIR */, &[]);
    let writes = match handler.project_mob_template(&fresh_id, &fresh_bytes, NARROW_EFFECT_ARESRPG_ORIGIN) {
        MobTemplateProjection::Writes(writes) => writes,
        MobTemplateProjection::SkippedNonCanonical => {
            panic!("a mob the census never adjudicated must not be refused as a superseded twin")
        }
        MobTemplateProjection::Malformed => panic!("fresh mob prefix must parse"),
    };
    assert!(has_sadd(&writes, K_MOB_TEMPLATES, &fresh_id));
    let doc = set_json(&writes, "$").expect("fresh mob writes its whole doc");
    assert!(doc.contains(r#""name":"Voltstripe the Stormfang""#), "doc: {doc}");

    // The tooth the census exists for is UNCHANGED: an unlisted id whose display name the census
    // awards to another id is the superseded twin, still refused.
    let twin_id = synthetic_object_id("0x7213");
    let twin_bytes = mob_template_bytes("Velvet Slime", 1, 2, 12, 1, &[]);
    assert!(
        matches!(
            handler.project_mob_template(&twin_id, &twin_bytes, NARROW_EFFECT_ARESRPG_ORIGIN),
            MobTemplateProjection::SkippedNonCanonical
        ),
        "a second id claiming an adjudicated display name is the twin the census rules against"
    );
}

#[test]
fn mob_template_prefix_reads_head_even_when_loot_tail_is_unparseable() {
    let id = "0x0000000000000000000000000000000000000000000000000000000000000c0d";
    // A fat, arbitrary tail (stand-in for the real 22-u64 stats + spells + loot). It does
    // NOT form a valid loot walk, so `drops` collapses to null — but the prefix must still
    // project (loot decode can never regress the working name/level/element fields).
    let trailing: Vec<u8> = (0..200u32).map(|i| (i % 251) as u8).collect();
    let bytes = mob_template_bytes("Ronin", 5, 9, 140, 2 /* EARTH */, &trailing);
    let writes = map_mob_template_object(id, &bytes, "0xold").expect("mob prefix must parse");

    let doc = set_json(&writes, "$").expect("mob template writes its whole doc");
    assert!(doc.contains(r#""name":"Ronin""#), "doc: {doc}");
    assert!(doc.contains(r#""min_level":5"#), "doc: {doc}");
    assert!(doc.contains(r#""max_level":9"#), "doc: {doc}");
    assert!(doc.contains(r#""base_hp":140"#), "doc: {doc}");
    assert!(doc.contains(r#""element":2"#), "doc: {doc}");
    assert!(doc.contains(r#""live":true"#), "doc: {doc}");
    assert!(has_sadd(&writes, "rpc:idx:mob_templates", id));
}

/// RUNTIME PROVENANCE: the exact 405 bytes of the live testnet MobTemplate
/// `0x0be2e4…6ffb` ("Test Brute", the 2026-07-10 S-21 QA seed) fetched via
/// `sui_getObject showBcs` — proves the loot walk lands on the published `loot`
/// vector byte-for-byte after SKIPPING the real 176-byte `Stats` and the real
/// one-`SpellLevel` kit (with its nested effect vectors), not just our own round-trip.
const REAL_MOB_BRUTE_BCS_HEX: &str = "0be2e4ae1dc4ae65256b6cb6a5e321fd750d3ab7484e08cc12f92451dfc66ffb0a5465737420427275746501000500280000000000000006000000000000000300000000000000020f0000000000000000000000000000000000000000000000050000000000000000000000000000000000000000000000000000000000000000800000000000000080000000000000008000000000000000800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001010004000000000000000100000000000000010000000000000000000100ffff00000000000000000000000001000208000000000000000000000000000000000164000000000002f541309de2496c93c01b98f55cc279550298d5c15e2d98ecfaadb5d8fa3ce3ed881301000100d41443bae6f0d4fc90cbe3d1ce35499ab4ea03bdf6d1a87e7455ced7b46cb27f401f010003003200000000000000";

#[test]
fn real_testnet_mob_template_decodes_prefix_and_loot() {
    let bytes = hex::decode(REAL_MOB_BRUTE_BCS_HEX).unwrap();
    let id = "0x0be2e4ae1dc4ae65256b6cb6a5e321fd750d3ab7484e08cc12f92451dfc66ffb";
    // Captured pre-2026-07-23 republish, so its MINTING origin is the pre-#577 lineage — named
    // exactly, not a placeholder: the width now comes from a registered origin or not at all.
    let writes = map_mob_template_object(id, &bytes, NARROW_EFFECT_ARESRPG_ORIGIN)
        .expect("real mob bytes must decode");
    let doc = set_json(&writes, "$").expect("mob template writes its whole doc");

    // Prefix (unchanged behaviour).
    assert!(doc.contains(r#""name":"Test Brute""#), "doc: {doc}");
    assert!(doc.contains(r#""min_level":1"#), "doc: {doc}");
    assert!(doc.contains(r#""max_level":5"#), "doc: {doc}");
    assert!(doc.contains(r#""base_hp":40"#), "doc: {doc}");
    assert!(doc.contains(r#""element":2"#), "doc: {doc}"); // EARTH

    // Resistances (issue #629): Test Brute authors no resistance bonus — all four sit at the
    // neutral SHIFT_U16 centre (32768), proving the block DECODED (not absent/null) even
    // though every field happens to equal the centre value.
    assert!(doc.contains(r#""fire_resistance":32768"#), "doc: {doc}");
    assert!(doc.contains(r#""water_resistance":32768"#), "doc: {doc}");
    assert!(doc.contains(r#""earth_resistance":32768"#), "doc: {doc}");
    assert!(doc.contains(r#""air_resistance":32768"#), "doc: {doc}");

    // Loot: longsword @ 5000 bp (qty 1) + iron_ore @ 8000 bp (qty 1-3), decoded past the
    // 176-byte Stats + the SpellLevel kit — the exact on-chain seed content.
    assert!(
        doc.contains(r#""template_id":"0xf541309de2496c93c01b98f55cc279550298d5c15e2d98ecfaadb5d8fa3ce3ed""#),
        "doc: {doc}"
    );
    assert!(doc.contains(r#""chance_bp":5000"#), "doc: {doc}");
    assert!(
        doc.contains(r#""template_id":"0xd41443bae6f0d4fc90cbe3d1ce35499ab4ea03bdf6d1a87e7455ced7b46cb27f""#),
        "doc: {doc}"
    );
    assert!(doc.contains(r#""chance_bp":8000"#), "doc: {doc}");
    assert!(doc.contains(r#""min_qty":1"#), "doc: {doc}");
    assert!(doc.contains(r#""max_qty":3"#), "doc: {doc}");
    assert!(has_sadd(&writes, "rpc:idx:mob_templates", id));
}

/// RUNTIME PROVENANCE (issue #629): the exact 513 bytes of the LIVE testnet MobTemplate
/// `0xc6be9c23…d07f35` ("Boar") fetched via `sui client object <id> --bcs --json` (the CLI's
/// own gRPC config; testnet JSON-RPC is dead — reference_sui_testnet_rpc_endpoint). Proves the
/// resistance read lands on the published Stats block byte-for-byte, NOT just a self-encoded
/// round trip — and, critically, that it is NON-neutral (issue #629's own cited donor profile:
/// "+40 earth / −20 air on the boar" — earth centred at 32768+40=32808, air at 32768−20=32748,
/// matching the identity-decode demo in PR #628's own body word-for-word).
const REAL_MOB_BOAR_BCS_HEX: &str = "c6be9c23359f0bb512b494b4635920acf4f7d96e04c0915f88f241e073d07f3504426f617212001c00960000000000000004000000000000000300000000000000022e00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000800000000000002880000000000000ec7f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001010004000000000000000100000000000000010000000000000000000100ffff000a000000000000000000000100020f000000000000000000000000000000000164000000000005aa6d6e1b80816f009e3b74e211488dabde467664a49f8c02931745b008f47fdf6c160100010025fcacf2cf521e29f6a6da63f6a9f52089b0abe5cab3678254411ccd6cb2295c480d01000100b313e6386305a1b779f8eb957f6fe0cdebedbf011f9d12621588172a821e85b2e5010100010041fbad9f338b723a6753ad441c9a064c647152e39cc8ebe58123a3704f74363e600001000100aaa08cdb6ea754151369c2fd7cc1daac3a80f0921a28a71b9bc68f67f4c03a40410001000100d606000000000000";

#[test]
fn real_testnet_boar_mob_projects_nonzero_resistances() {
    let bytes = hex::decode(REAL_MOB_BOAR_BCS_HEX).unwrap();
    let id = "0xc6be9c23359f0bb512b494b4635920acf4f7d96e04c0915f88f241e073d07f35";
    // Captured pre-2026-07-23 republish, so its MINTING origin is the pre-#577 lineage — named
    // exactly, not a placeholder: the width now comes from a registered origin or not at all.
    let writes = map_mob_template_object(id, &bytes, NARROW_EFFECT_ARESRPG_ORIGIN)
        .expect("real Boar bytes must decode");
    let doc = set_json(&writes, "$").expect("mob template writes its whole doc");

    assert!(doc.contains(r#""name":"Boar""#), "doc: {doc}");
    assert!(doc.contains(r#""min_level":18"#), "doc: {doc}");
    assert!(doc.contains(r#""max_level":28"#), "doc: {doc}");
    assert!(doc.contains(r#""base_hp":150"#), "doc: {doc}");
    assert!(doc.contains(r#""element":2"#), "doc: {doc}"); // EARTH

    // The cited donor profile, wire-value passthrough (client owns the 32768 decode).
    assert!(doc.contains(r#""fire_resistance":32768"#), "doc: {doc}"); // neutral
    assert!(doc.contains(r#""water_resistance":32768"#), "doc: {doc}"); // neutral
    assert!(doc.contains(r#""earth_resistance":32808"#), "doc: {doc}"); // +40
    assert!(doc.contains(r#""air_resistance":32748"#), "doc: {doc}"); // -20

    // The loot table still decodes past the resistance read (5 real drop rows on this mob).
    assert!(
        doc.contains(r#""template_id":"0xaa6d6e1b80816f009e3b74e211488dabde467664a49f8c02931745b008f47fdf""#),
        "doc: {doc}"
    );
    assert!(doc.contains(r#""chance_bp":5740"#), "doc: {doc}");
}

#[test]
fn mob_resistances_survive_a_loot_tail_that_fails_to_decode() {
    // A body with a VALID 176-byte Stats block (real resistance values) followed by garbage
    // that can never form a valid `spells`/`loot` walk. Resistances must still project — the
    // loot decode failing can never regress the (already-consumed, already-correct) stats read.
    let mut stats = vec![0u8; 176];
    // fire_resistance is field index 7 of 22 (byte offset 7*8 = 56).
    stats[56..64].copy_from_slice(&32_800u64.to_le_bytes());
    let mut trailing = stats;
    trailing.extend_from_slice(&[0xff; 40]); // an unparseable spells/loot tail
    let bytes = mob_template_bytes("Snarler", 3, 7, 80, 0 /* FIRE */, &trailing);
    let id = "0x0000000000000000000000000000000000000000000000000000000000000dad";
    let writes = map_mob_template_object(id, &bytes, "0xold").expect("mob prefix must parse");
    let doc = set_json(&writes, "$").expect("mob template writes its whole doc");

    assert!(doc.contains(r#""fire_resistance":32800"#), "doc: {doc}");
    assert!(doc.contains(r#""water_resistance":0"#), "doc: {doc}"); // raw 0 — the zeroed synthetic stand-in
    assert!(doc.contains(r#""drops":null"#), "doc: {doc}"); // loot walk failed — honest unknown
}

#[test]
fn mob_template_truncated_body_is_dropped_not_panicked() {
    // A body cut off inside the prefix must return None (defensive), never panic.
    assert!(map_mob_template_object("0xdead", &[0u8; 10], "0xold").is_none());
}

// ── Dual-shape Effect width (issue #629 round-2: 2026-07-23 republish widens Effect 25→33B) ──

#[test]
fn effect_byte_width_resolves_registered_origins_and_refuses_the_rest() {
    assert_eq!(effect_byte_width(FRESH_ARESRPG_ORIGIN), Some(33));
    assert_eq!(effect_byte_width(NARROW_EFFECT_ARESRPG_ORIGIN), Some(25));
    // FAIL CLOSED (issue #1315 finding 9): the republish mints an origin nobody has registered yet.
    // The old code answered 25 for it — a guess that misaligns every byte past `spells`.
    assert_eq!(effect_byte_width("0xnot_a_registered_origin"), None);
    assert_eq!(effect_byte_width("0xold"), None);
}

/// THE CEREMONY GATE (issue #1315 finding 9). `stamp_all.mjs` writes each ceremony's new package
/// ids into `packages/sdk/src/deployment/release.json`; the layout dimension that file does not
/// carry lives in [`ARES_ORIGIN_EFFECT_BYTES`]. Binding the two here means a republish CANNOT land
/// a stamped origin the indexer would decode blind — the omission is a red test, not a silent loot
/// outage discovered in the encyclopedia weeks later. Read at RUNTIME (never `include_str!`): the
/// indexer's Docker build context is the crate directory alone, so a compile-time reach into a
/// sibling package would break the image build.
#[test]
fn release_origins_are_all_registered() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../sdk/src/deployment/release.json");
    let raw = std::fs::read_to_string(path).expect("release.json is the ceremony's own output");
    let release: serde_json::Value = serde_json::from_str(&raw).expect("release.json parses");
    let networks = release["networks"].as_object().expect("release.json has networks");
    let mut checked = 0;
    for (network, row) in networks {
        let origin = row["packages"]["aresrpg"]["origin"].as_str().unwrap_or_default();
        if origin.is_empty() {
            continue; // an unpublished network (mainnet today) pins nothing yet
        }
        assert!(
            effect_byte_width(origin).is_some(),
            "release.json pins {network} aresrpg origin {origin}, which ARES_ORIGIN_EFFECT_BYTES does \
             not register — add it with the Effect width that ceremony's package was built against"
        );
        checked += 1;
    }
    assert!(checked > 0, "no published aresrpg origin found in release.json — the gate must not vacuously pass");
}

/// Build a `spells: vector<SpellLevel>` (ONE level, ONE `effects` entry sized `effect_bytes`,
/// zero `crit_effects`) + `loot: vector<MobLootEntry>` (ONE row) trailing block. The minimal
/// real walk that proves the cursor lands correctly PAST the width-dependent `effects` vector —
/// a wrong width misaligns every byte after it, corrupting or failing the loot decode entirely.
fn spells_and_loot_tail(effect_bytes: usize, loot_template_hex: &str) -> Vec<u8> {
    let mut b = Vec::new();
    b.push(1); // spells: ULEB count = 1
    b.extend_from_slice(&[0u8; 42]); // SpellLevel's fixed head — values irrelevant to this test
    b.push(0); // required_states: vector<u16> ULEB count = 0
    b.push(0); // forbidden_states: vector<u16> ULEB count = 0
    b.push(1); // effects: vector<Effect> ULEB count = 1
    b.extend_from_slice(&vec![0u8; effect_bytes]); // ONE Effect, all-zero — only its WIDTH matters here
    b.push(0); // crit_effects: vector<Effect> ULEB count = 0
    b.push(1); // loot: vector<MobLootEntry> ULEB count = 1
    b.extend_from_slice(&hex::decode(loot_template_hex).unwrap()); // item_template: ID(32)
    b.extend_from_slice(&5000u16.to_le_bytes()); // chance_bp
    b.extend_from_slice(&1u16.to_le_bytes()); // min_qty
    b.extend_from_slice(&2u16.to_le_bytes()); // max_qty
    b
}

#[test]
fn fresh_origin_mob_decodes_resistances_and_loot_past_the_widened_effect() {
    let loot_template = "aa6d6e1b80816f009e3b74e211488dabde467664a49f8c02931745b008f47fdf";
    let mut stats = vec![0u8; 176];
    stats[56..64].copy_from_slice(&32_808u64.to_le_bytes()); // fire_resistance (field 7): +40 centred
    let mut trailing = stats;
    trailing.extend_from_slice(&spells_and_loot_tail(33, loot_template)); // FRESH width
    let bytes = mob_template_bytes("Glowmoth", 20, 30, 200, 3 /* AIR */, &trailing);
    let id = "0x0000000000000000000000000000000000000000000000000000000000fee5";

    let writes = map_mob_template_object(id, &bytes, FRESH_ARESRPG_ORIGIN).expect("fresh-shape mob must parse");
    let doc = set_json(&writes, "$").expect("mob template writes its whole doc");
    assert!(doc.contains(r#""name":"Glowmoth""#), "doc: {doc}");
    assert!(doc.contains(r#""fire_resistance":32808"#), "doc: {doc}");
    // The tell: loot only decodes correctly if the 33-byte Effect was skipped, not 25.
    assert!(doc.contains(&format!(r#""template_id":"0x{loot_template}""#)), "doc: {doc}");
    assert!(doc.contains(r#""chance_bp":5000"#), "doc: {doc}");
    assert!(doc.contains(r#""min_qty":1"#), "doc: {doc}");
    assert!(doc.contains(r#""max_qty":2"#), "doc: {doc}");
}

#[test]
fn old_origin_mob_using_the_25_byte_effect_still_decodes_loot() {
    // The SAME shape of fixture as the fresh-origin test above, but with the PRE-#577 25-byte
    // Effect and the registered old-lineage origin — the sibling half of the dual-shape proof.
    let loot_template = "aa6d6e1b80816f009e3b74e211488dabde467664a49f8c02931745b008f47fdf";
    let trailing_stats = vec![0u8; 176];
    let mut trailing = trailing_stats;
    trailing.extend_from_slice(&spells_and_loot_tail(25, loot_template)); // OLD width
    let bytes = mob_template_bytes("Glowmoth Elder", 20, 30, 200, 3, &trailing);
    let id = "0x0000000000000000000000000000000000000000000000000000000000fee6";

    let writes =
        map_mob_template_object(id, &bytes, NARROW_EFFECT_ARESRPG_ORIGIN).expect("old-shape mob must parse");
    let doc = set_json(&writes, "$").expect("mob template writes its whole doc");
    assert!(doc.contains(&format!(r#""template_id":"0x{loot_template}""#)), "doc: {doc}");
    assert!(doc.contains(r#""chance_bp":5000"#), "doc: {doc}");
}

/// RED (issue #1315 finding 9): the republish mints an origin absent from the table, and the old
/// `else 25` walked genuinely-33-byte bodies at the wrong width. On this fixture that walk did not
/// even look broken — it resumed 8 bytes early, read a zeroed Effect byte as the `loot` count and
/// projected `"drops":[]`: a mob that drops nothing, asserted as fact. The honest answer for an
/// unresolvable width is `null` (unknown), which the bestiary already renders as a gap.
#[test]
fn unregistered_origin_never_guesses_a_width_it_reports_unknown_loot() {
    let loot_template = "aa6d6e1b80816f009e3b74e211488dabde467664a49f8c02931745b008f47fdf";
    let mut trailing = vec![0u8; 176];
    trailing[56..64].copy_from_slice(&32_808u64.to_le_bytes()); // fire_resistance — width-independent
    trailing.extend_from_slice(&spells_and_loot_tail(33, loot_template));
    let bytes = mob_template_bytes("Glowmoth", 20, 30, 200, 3, &trailing);
    let id = "0x0000000000000000000000000000000000000000000000000000000000fee8";

    let writes = map_mob_template_object(id, &bytes, "0xa_republished_origin_nobody_registered")
        .expect("the origin-independent prefix still projects");
    let doc = set_json(&writes, "$").expect("mob template writes its whole doc");
    // Everything that does NOT depend on the Effect width still projects — failing closed costs
    // exactly the loot walk, not the whole encyclopedia row.
    assert!(doc.contains(r#""name":"Glowmoth""#), "doc: {doc}");
    assert!(doc.contains(r#""fire_resistance":32808"#), "doc: {doc}");
    // No guess, and — critically — no FABRICATED empty drop list either.
    assert!(doc.contains(r#""drops":null"#), "doc: {doc}");
}

#[test]
fn fresh_origin_bytes_decoded_with_the_wrong_old_width_misaligns_loot() {
    // Negative control: prove the bug the round-2 rider fixes. Fresh-shape (33B Effect) bytes,
    // decoded as though origin were old (25B) — the loot walk must NOT land on the real
    // template id (the classic silent-misalignment failure mode this fix eliminates).
    let loot_template = "aa6d6e1b80816f009e3b74e211488dabde467664a49f8c02931745b008f47fdf";
    let stats = vec![0u8; 176];
    let mut trailing = stats;
    trailing.extend_from_slice(&spells_and_loot_tail(33, loot_template)); // FRESH width bytes
    let bytes = mob_template_bytes("Glowmoth", 20, 30, 200, 3, &trailing);
    let id = "0x0000000000000000000000000000000000000000000000000000000000fee7";

    // Wrong origin ⇒ wrong (old, 25B) width chosen for genuinely fresh (33B) bytes. The origin must
    // be a REGISTERED narrow one: an unregistered origin refuses the walk outright (the sibling
    // fail-closed test), which would prove the guard, not the misalignment this control is about.
    let writes =
        map_mob_template_object(id, &bytes, NARROW_EFFECT_ARESRPG_ORIGIN).expect("prefix still parses");
    let doc = set_json(&writes, "$").expect("mob template writes its whole doc");
    assert!(
        !doc.contains(&format!(r#""template_id":"0x{loot_template}""#)),
        "misaligned decode must NOT recover the real loot template: {doc}"
    );
}

// ── World object snapshot (S-67 world switcher / travel-modal level gates) ────

/// Assemble a synthetic `world::World` BCS body: the scalar prefix the snapshot reads
/// (`id | seed | biome | required_level`) followed by arbitrary TRAILING bytes standing in
/// for the real dials/spawn tables (`bounds_x…spawn_nonce`) — proving the prefix parser
/// reads the head and TOLERATES the (undecoded) tail.
fn world_bytes(seed: u64, biome: &str, required_level: u16, trailing: &[u8]) -> Vec<u8> {
    let mut b = vec![0x1fu8; 32]; // UID (bare 32-byte ObjectID)
    b.extend_from_slice(&seed.to_le_bytes());
    b.push(biome.len() as u8); // ULEB128 length (single byte for a short biome)
    b.extend_from_slice(biome.as_bytes());
    b.extend_from_slice(&required_level.to_le_bytes());
    b.extend_from_slice(trailing); // bounds/zone dials/spawn tables — never decoded
    b
}

/// REGRESSION (live-QA 07-17, "Lv 1+ on every world"): the on-chain gate lives ONLY on
/// the World OBJECT (`set_required_level` fires a payload-less `WorldUpdated`; the create
/// event carries seed/biome only), so without an object snapshot the `rpc:world:{id}` doc
/// never learns `required_level` and `/v1/encyclopedia` defaults every world to 1.
#[test]
fn world_object_snapshots_the_live_required_level() {
    let id = "0x0000000000000000000000000000000000000000000000000000000000001f1f";
    let trailing: Vec<u8> = (0..96u32).map(|i| (i % 251) as u8).collect();
    let bytes = world_bytes(777, "archipelago", 34, &trailing);
    let writes = map_world_object(id, &bytes).expect("world bytes must decode");

    let doc = set_json(&writes, "$").expect("world writes its whole doc");
    assert!(doc.contains(&format!(r#""world":"{id}""#)), "doc: {doc}");
    assert!(doc.contains(r#""seed":"777""#), "doc: {doc}"); // string — mirrors the event projection (u64 precision)
    assert!(doc.contains(r#""biome":"archipelago""#), "doc: {doc}");
    assert!(doc.contains(r#""required_level":34"#), "doc: {doc}");
    assert!(has_sadd(&writes, "rpc:idx:worlds", id));
}

#[test]
fn world_create_default_level_snapshots_as_one() {
    // A just-created world (create_world default) must project 1 — same value the API fallback
    // serves, so the doc converges instead of flapping between absent and present.
    let writes = map_world_object("0x1f", &world_bytes(1, "testlands", 1, &[])).expect("world bytes must decode");
    let doc = set_json(&writes, "$").expect("world writes its whole doc");
    assert!(doc.contains(r#""required_level":1"#), "doc: {doc}");
}

#[test]
fn world_truncated_body_is_dropped_not_panicked() {
    // A body cut off inside the prefix must return None (defensive), never panic.
    assert!(map_world_object("0xdead", &[0u8; 20]).is_none());
    assert!(map_world_object("0xdead", &world_bytes(9, "swamp", 12, &[])[..41]).is_none());
}

/// RUNTIME PROVENANCE: the exact first 128 bytes (of 1034) of the LIVE testnet World
/// `0x6285dc…251c` (03_emberfall_steppe, seed band [10,24]) fetched via `sui_getObject
/// showBcs` 2026-07-17 — proves the prefix layout (`UID | seed:u64 | biome:String |
/// required_level:u16`) against the published `world::World` byte-for-byte AND that the
/// live chain really carries the non-1 gate the "Lv 1+" panel was dropping.
const REAL_WORLD_BCS_PREFIX_HEX: &str = "6285dcbd827b856373ec93555890902d6452ebfa37b91f98bad8969964b5251cfbf3e8a5000000000a6173685f7374657070650a0020a1070020a107000002000000dd6d00000000007e04000000000000e8030000e8030000c8000000000000003000400018002a0001";

#[test]
fn real_testnet_world_snapshots_its_live_join_gate() {
    let bytes = hex::decode(REAL_WORLD_BCS_PREFIX_HEX).unwrap();
    let id = "0x6285dcbd827b856373ec93555890902d6452ebfa37b91f98bad8969964b5251c";
    let writes = map_world_object(id, &bytes).expect("real world bytes must decode");
    let doc = set_json(&writes, "$").expect("world writes its whole doc");
    assert!(doc.contains(r#""seed":"2783507451""#), "doc: {doc}");
    assert!(doc.contains(r#""biome":"ash_steppe""#), "doc: {doc}");
    assert!(doc.contains(r#""required_level":10"#), "doc: {doc}"); // the band[0] gate the seeder minted
    assert!(has_sadd(&writes, "rpc:idx:worlds", id));
}

// ── Wrapped World (#1289: `World { id, inner: Versioned }`) ──────────────────
// The republish moves EVERY world field out of the object body and into a
// `Field<u64, WorldInner>` hung off the shell's nested `Versioned` UID. Two shapes must decode
// through the transition: the legacy inline body above (real captured bytes, still green) and the
// wrapped pair below (issue #1315 finding 5).

/// The post-#1289 `world::World` SHELL body: `id: UID(32) | inner: Versioned { id: UID(32),
/// version: u64 }` — 72 bytes, no tail. `versioned` is supplied raw so a test can choose bytes that
/// the LEGACY prefix reader would happily (and wrongly) consume.
fn wrapped_world_shell_bytes(world_fill: u8, versioned: &[u8; 32], version: u64) -> Vec<u8> {
    let mut b = vec![world_fill; 32];
    b.extend_from_slice(versioned);
    b.extend_from_slice(&version.to_le_bytes());
    b
}

/// A `Versioned` UID whose bytes are ALSO a valid legacy `seed | biome | required_level` prefix:
/// byte 8 is a 3-byte biome length followed by UTF-8. Without this the legacy reader would fail on
/// a short/oversized string length and the regression would look like a benign drop instead of the
/// fabricated world row it really is.
fn legacy_readable_versioned_uid() -> [u8; 32] {
    let mut uid = [0xaau8; 32];
    uid[8] = 3; // ULEB biome length
    uid[9..12].copy_from_slice(b"bad");
    uid[12..14].copy_from_slice(&77u16.to_le_bytes()); // would surface as required_level 77
    uid
}

/// Assemble a `Field<u64, WorldInner>` body — the dynamic field `versioned::create` adds to the
/// `Versioned`'s UID (`df::add(&mut self.id, init_version, init_value)`): `id: UID(32) | name: u64
/// (the version, == the df key) | value: WorldInner`.
///
/// `WorldInner`'s field order here is DIFFABLE, line by line, against its struct DECLARATION in
/// `packages/move/aresrpg/sources/world.move` (BCS is positional and follows the declaration, NOT
/// `create_world`'s differently-ordered struct literal):
///   seed u64 · biome String · required_level u16 · bounds_x u32 · bounds_z u32 · zone_size u32 ·
///   zone_ttl_ms u64 · speed_budget u64 · spawn_zone_x u32 · spawn_zone_z u32 · protector_bp u64 ·
///   min_groups u16 · max_groups u16 · min_nodes u16 · max_nodes u16 · dungeon_key_template
///   Option<ID> · resources vector<ResourceEntry> · mobs vector<MobEntry> · dungeon_rooms
///   vector<DungeonRoom> · spawn_nonce u64 · rare_links VecMap<ID,ID> · mob_levels vector<u16> ·
///   protectors VecMap<ID,ID> · boss_mask vector<u16>
/// The projection reads the first three; the rest is the tail it must tolerate — encoded in FULL
/// (empty tables, real `mob_levels`/`boss_mask` rows) so this is a whole payload, not a prefix.
fn world_inner_field_bytes(version: u64, seed: u64, biome: &str, required_level: u16) -> Vec<u8> {
    let mut b = vec![0x5eu8; 32]; // the Field's own UID
    b.extend_from_slice(&version.to_le_bytes()); // name: u64 — the df key IS the version
    b.extend_from_slice(&seed.to_le_bytes());
    b.push(biome.len() as u8); // ULEB128 length (single byte for a short biome)
    b.extend_from_slice(biome.as_bytes());
    b.extend_from_slice(&required_level.to_le_bytes());
    b.extend_from_slice(&512u32.to_le_bytes()); // bounds_x
    b.extend_from_slice(&512u32.to_le_bytes()); // bounds_z
    b.extend_from_slice(&32u32.to_le_bytes()); // zone_size
    b.extend_from_slice(&600_000u64.to_le_bytes()); // zone_ttl_ms
    b.extend_from_slice(&320u64.to_le_bytes()); // speed_budget
    b.extend_from_slice(&8u32.to_le_bytes()); // spawn_zone_x
    b.extend_from_slice(&9u32.to_le_bytes()); // spawn_zone_z
    b.extend_from_slice(&150u64.to_le_bytes()); // protector_bp
    b.extend_from_slice(&1u16.to_le_bytes()); // min_groups
    b.extend_from_slice(&4u16.to_le_bytes()); // max_groups
    b.extend_from_slice(&2u16.to_le_bytes()); // min_nodes
    b.extend_from_slice(&6u16.to_le_bytes()); // max_nodes
    b.push(0); // dungeon_key_template: Option<ID> = none
    b.push(0); // resources: vector<ResourceEntry> = empty
    b.push(0); // mobs: vector<MobEntry> = empty
    b.push(0); // dungeon_rooms: vector<DungeonRoom> = empty
    b.extend_from_slice(&42u64.to_le_bytes()); // spawn_nonce
    b.push(0); // rare_links: VecMap<ID,ID> = empty (BCS: a vector of entries)
    b.push(2); // mob_levels: vector<u16> — two rows, parallel to `mobs`
    b.extend_from_slice(&11u16.to_le_bytes());
    b.extend_from_slice(&12u16.to_le_bytes());
    b.push(0); // protectors: VecMap<ID,ID> = empty
    b.push(1); // boss_mask: vector<u16> — one row
    b.extend_from_slice(&1u16.to_le_bytes());
    b
}

/// RED (issue #1315 finding 5): before the fix, the Phase-2 object arm fed a WRAPPED shell straight
/// into the legacy prefix reader, which read the nested `Versioned`'s UID bytes as `seed` and its
/// 9th byte as a `biome` length — measured output for this exact fixture:
/// `{"world":"0x…0e05","seed":"12297829382473034410","biome":"bad","required_level":77}`. A
/// fabricated world row, indistinguishable from a real one at the `/v1/encyclopedia` seam. The
/// wrapped shell carries NO world state, so the honest projection from it is nothing at all.
#[test]
fn wrapped_world_shell_never_projects_through_the_legacy_reader() {
    let id = synthetic_object_id("0xe05");
    let bytes = wrapped_world_shell_bytes(0x0e, &legacy_readable_versioned_uid(), 1);
    assert_eq!(bytes.len(), 72, "the wrapped shell is exactly UID | Versioned{{UID,u64}}");
    assert!(
        map_world_object(&id, &bytes).is_none(),
        "a wrapped shell must project NOTHING — its state lives in the Field<u64, WorldInner>"
    );
}

/// The other half of the transition: the payload field carries what the object used to, and lands
/// on the SAME `rpc:world:{id}` doc + `idx:worlds` index — keyed by the WORLD id resolved from the
/// shell, never by the Field's own parent (which is the Versioned id no reader knows).
#[test]
fn wrapped_world_payload_projects_the_live_join_gate() {
    let id = synthetic_object_id("0xe06");
    let bytes = world_inner_field_bytes(1, 4242, "emberfall_steppe", 27);
    let writes = map_world_inner_field(&id, &bytes).expect("wrapped payload must decode");
    let doc = set_json(&writes, "$").expect("world writes its whole doc");
    assert!(doc.contains(&format!(r#""world":"{id}""#)), "doc: {doc}");
    assert!(doc.contains(r#""seed":"4242""#), "doc: {doc}");
    assert!(doc.contains(r#""biome":"emberfall_steppe""#), "doc: {doc}");
    assert!(doc.contains(r#""required_level":27"#), "doc: {doc}");
    assert!(has_sadd(&writes, "rpc:idx:worlds", &id));
}

/// Byte-for-byte identical doc from both shapes — the transition cannot flip a world's served row.
#[test]
fn wrapped_and_legacy_worlds_project_the_same_doc() {
    let id = synthetic_object_id("0xe07");
    let legacy = map_world_object(&id, &world_bytes(777, "archipelago", 34, &[])).expect("legacy decodes");
    let wrapped = map_world_inner_field(&id, &world_inner_field_bytes(1, 777, "archipelago", 34))
        .expect("wrapped decodes");
    assert_eq!(legacy, wrapped);
}

/// FAIL CLOSED on the dial the `Versioned` wrapper exists to turn: a payload keyed by a version
/// this indexer does not speak has an UNKNOWN field order, so it is dropped rather than read at
/// offsets that stopped meaning what they meant.
#[test]
fn wrapped_world_payload_of_an_unspoken_version_is_dropped() {
    let id = synthetic_object_id("0xe08");
    assert!(map_world_inner_field(&id, &world_inner_field_bytes(2, 777, "archipelago", 34)).is_none());
    assert!(map_world_inner_field(&id, &[0u8; 20]).is_none()); // truncated — dropped, never panicked
}

/// The shape discriminator itself, from both sides — including the REAL captured legacy bytes, so
/// no future body-length change can quietly start routing live worlds down the wrapped path.
#[test]
fn world_shape_discriminator_separates_wrapped_from_legacy() {
    let real_legacy = hex::decode(REAL_WORLD_BCS_PREFIX_HEX).unwrap();
    assert!(world_shell(&real_legacy).is_none(), "a real live World is NOT a wrapped shell");
    assert!(world_shell(&world_bytes(1, "testlands", 1, &[])).is_none());
    let shell = wrapped_world_shell_bytes(0x0e, &legacy_readable_versioned_uid(), 1);
    let decoded = world_shell(&shell).expect("the wrapped shell decodes");
    assert_eq!(decoded.inner.id, ObjectID::from_bytes(legacy_readable_versioned_uid()).unwrap());
    // Trailing input is REFUSED — that strictness is what makes the two shapes unconfusable.
    let mut with_tail = shell.clone();
    with_tail.push(0);
    assert!(world_shell(&with_tail).is_none());
}

/// The world-inner arm's type guards. Its key is a bare `u64` (a `Versioned` payload is keyed by
/// its version), so — uniquely among the Phase-1 arms — the origin gate rides the VALUE tag; see
/// `non_struct_key_is_conservatively_rejected` for the primitive key's own (correct) refusal.
#[test]
fn world_inner_field_is_matched_by_the_u64_key_and_the_value_origin() {
    use std::str::FromStr;
    let fresh = FRESH_ARESRPG_ORIGIN;
    let orphaned = "0xd0";
    let handler = AresSnapshotHandler::new(Some(HashSet::from([fresh.to_string()])));

    let fresh_value = TypeTag::from_str(&format!("{fresh}::world::WorldInner")).unwrap();
    let orphaned_value = TypeTag::from_str(&format!("{orphaned}::world::WorldInner")).unwrap();

    assert!(is_versioned_payload_key(&TypeTag::U64));
    assert!(!is_versioned_payload_key(&fresh_value));
    assert!(is_world_inner_value(&fresh_value));
    assert!(!is_world_inner_value(&TypeTag::from_str(&format!("{fresh}::world::World")).unwrap()));

    // The exact dispatch condition `process` runs for this arm.
    assert!(is_world_inner_value(&fresh_value) && handler.origin_admitted(&fresh_value));
    assert!(
        !(is_world_inner_value(&orphaned_value) && handler.origin_admitted(&orphaned_value)),
        "an orphaned lineage's WorldInner payload must NOT project"
    );
}

// ── Recipe object snapshot (§14 encyclopedia crafting truth) ──────────────────

/// RUNTIME PROVENANCE: the exact 170 bytes of the live localnet Recipe
/// `0x7c1023…b98c` (rehearsal #2 gold seed — a 2-ingredient jeweler craft, job 11 /
/// level 1 / 23 xp) fetched via `sui_getObject showBcs` — proves the Rust struct
/// decodes the published `aresrpg::crafting::Recipe` byte-for-byte (UID | ULEB vec of
/// 40-byte Ingredients | output ID | u64 | u8 | u64 | u64), not just our own round-trip.
const REAL_RECIPE_BCS_HEX: &str = "7c10238c25a07efec27bf5b21087faa7282514dee2baabf6ff9fc6f357e4b98c0279623d667a08a16a29e09295872b36e5fa035403bc11ca32798179c54b4101480100000000000000b04ef0ae8602d22b8f0b67fb4f75b5e54c5f0ab47997d6487fc12d164304461d01000000000000000e4bac0a9ab4e645466fb2e009cabff1668ce4c576b79897d48e6bfe09d80e7f01000000000000000b01000000000000001700000000000000";

#[test]
fn real_localnet_recipe_snapshots_the_full_crafting_truth() {
    let bytes = hex::decode(REAL_RECIPE_BCS_HEX).unwrap();
    let id = "0x7c10238c25a07efec27bf5b21087faa7282514dee2baabf6ff9fc6f357e4b98c";
    let writes = map_recipe_object(id, &bytes).expect("real recipe bytes must decode");
    let doc = set_json(&writes, "$").expect("recipe writes its whole doc");

    // The EXACT on-chain values (standing law: every encyclopedia number is the chain's number).
    assert!(
        doc.contains(r#""output_template":"0x0e4bac0a9ab4e645466fb2e009cabff1668ce4c576b79897d48e6bfe09d80e7f""#),
        "doc: {doc}"
    );
    assert!(doc.contains(r#""output_quantity":1"#), "doc: {doc}");
    assert!(doc.contains(r#""required_job":11"#), "doc: {doc}"); // jeweler (SDK JOBS index)
    assert!(doc.contains(r#""required_level":1"#), "doc: {doc}");
    assert!(doc.contains(r#""craft_xp":23"#), "doc: {doc}");
    // Both ingredient rows, template id + quantity each.
    assert!(
        doc.contains(r#""template_id":"0x79623d667a08a16a29e09295872b36e5fa035403bc11ca32798179c54b410148""#),
        "doc: {doc}"
    );
    assert!(
        doc.contains(r#""template_id":"0xb04ef0ae8602d22b8f0b67fb4f75b5e54c5f0ab47997d6487fc12d164304461d""#),
        "doc: {doc}"
    );
    assert!(doc.contains(r#""quantity":1"#), "doc: {doc}");
    assert!(doc.contains(r#""live":true"#), "doc: {doc}");
    assert!(has_sadd(&writes, "rpc:idx:recipes", id));
}

#[test]
fn recipe_round_trips_multi_ingredient_quantities_exactly() {
    let obj = RecipeObject {
        id: ObjectID::from_hex_literal("0x1c1").unwrap(),
        inputs: vec![
            RecipeIngredient { template: ObjectID::from_hex_literal("0xaa01").unwrap(), quantity: 3 },
            RecipeIngredient { template: ObjectID::from_hex_literal("0xbb02").unwrap(), quantity: 12 },
        ],
        output_template: ObjectID::from_hex_literal("0xcc03").unwrap(),
        output_quantity: 5,
        required_job: 13, // baker
        required_level: 25,
        craft_xp: 480,
    };
    let writes = map_recipe_object("0x1c1", &bcs::to_bytes(&obj).unwrap()).expect("round-trip must decode");
    let doc = set_json(&writes, "$").expect("recipe writes its whole doc");
    assert!(doc.contains(r#""quantity":3"#), "doc: {doc}");
    assert!(doc.contains(r#""quantity":12"#), "doc: {doc}");
    assert!(doc.contains(r#""output_quantity":5"#), "doc: {doc}");
    assert!(doc.contains(r#""required_job":13"#), "doc: {doc}");
    assert!(doc.contains(r#""required_level":25"#), "doc: {doc}");
    assert!(doc.contains(r#""craft_xp":480"#), "doc: {doc}");
    assert!(has_sadd(&writes, "rpc:idx:recipes", "0x1c1"));
}

#[test]
fn recipe_garbage_bytes_are_a_safe_none() {
    assert!(map_recipe_object("0xdead", &[0x00, 0x01, 0x02]).is_none());
}

// ── Generic kiosk discovery (mandated: char→kiosk from checkpoint ownership) ─

#[test]
fn resolve_kiosk_two_hops_object_owner_to_kiosk() {
    // REGRESSION GUARD (mandated behavior + the empirically-proven mechanism): a kiosk-locked
    // object's checkpoint owner is `ObjectOwner(<dynamic-object-field wrapper>)`, and the
    // wrapper's OWN owner is `ObjectOwner(<kiosk>)` (verified on testnet: character
    // 0x5972…fae75 → wrapper 0xbb0b…0afa → kiosk 0x6b1f…eb62). `resolve_kiosk` does exactly
    // that hop against the map `process()` builds from the checkpoint's `Field` objects.
    let wrapper = SuiAddress::from_bytes([0xbb; 32]).unwrap();
    let kiosk = SuiAddress::from_bytes([0x6b; 32]).unwrap();
    let mut map = HashMap::new();
    map.insert(wrapper, kiosk);
    assert_eq!(resolve_kiosk(&Owner::ObjectOwner(wrapper), &map), Some(ObjectID::from(kiosk).to_canonical_string(true)));
    // Address-owned (not kiosk-locked) → None.
    assert_eq!(resolve_kiosk(&Owner::AddressOwner(wrapper), &map), None);
    // Object-owned but the wrapper is not in this checkpoint's map → None (never fabricate).
    let unknown = SuiAddress::from_bytes([0xcc; 32]).unwrap();
    assert_eq!(resolve_kiosk(&Owner::ObjectOwner(unknown), &map), None);
}

#[test]
fn character_snapshot_writes_kiosk_id_only_when_resolved() {
    let obj = CharacterObject {
        id: ObjectID::from_hex_literal("0xabc").unwrap(),
        name: "Aiden".into(),
        class: "sram".into(),
        male: true,
        customization: Customization { color_1: 1, color_2: 2, color_3: 3 },
        experience: 0,
        created_at_ms: 42,
        anchor: PositionAnchor { pos_x: 0, pos_z: 0, zone: String::new(), anchored_at_ms: 0 },
    };
    let bytes = bcs::to_bytes(&obj).unwrap();
    let kiosk = "0x6b1ff2a365e231af5c80ca741c8739d47a757489d375bdf87f9297633555eb62";

    // Resolved → the character doc carries `$.kiosk_id` (what the roster serves).
    let with_kiosk = map_character_object("0xabc", &bytes, Some(kiosk)).unwrap();
    assert_eq!(set_json(&with_kiosk, "$.kiosk_id"), Some(format!("\"{kiosk}\"").as_str()));

    // Unresolved → NO kiosk_id write (additive/back-compat; the view renders null).
    let without = map_character_object("0xabc", &bytes, None).unwrap();
    assert!(without.iter().all(|w| !matches!(w, RedisWrite::Set { path, .. } if path == "$.kiosk_id")));
}

// ── Pending FightOutcomes (create/delete → per-owner set + per-outcome doc) ───

/// RUNTIME PROVENANCE: the exact 265 bytes of the live testnet FightOutcome
/// `0x4fd5a7…b079` (holder 0x3d13…2983, the S-… backfill orphan) fetched via
/// `sui_getObject showBcs` — proves the Rust struct decodes the published
/// `aresrpg_fight::settlement::FightOutcome` byte-for-byte THROUGH the variable
/// `loot` vector to `pvp` (loot is empty here; the layout past it still lands exact).
const REAL_FIGHT_OUTCOME_BCS_HEX: &str = "4fd5a7a1433e994bf6c563ef8115204fa875deaa15c115b3a20a83651238b07953326361353531633466313862666135323034656237346436666233326132396261666564326133666530613732326166646266373832633430623234303961653a3a66696768743a3a46696768744272616e64bfc5222665988a711622543d2f221512ee8267dad5b4bb53735b0b1e3281596e0d936039531aa9c68da6fba56564d7f8adb02c26c1691c59d4efa7375164e4d159725530910de90712e39d8e279e6522f4da1b50de9f4ced936749ede17fae750300000000000000000000000000000000900100000000000000000000000000000100000000000000000000006400000000000000";

#[test]
fn real_testnet_fight_outcome_projects_pending_row() {
    let bytes = hex::decode(REAL_FIGHT_OUTCOME_BCS_HEX).unwrap();
    let id = "0x4fd5a7a1433e994bf6c563ef8115204fa875deaa15c115b3a20a83651238b079";
    let owner = SuiAddress::from_bytes([0x3d; 32]).unwrap();
    let writes = map_fight_outcome_object(id, &bytes, &Owner::AddressOwner(owner), 1_700_000_000_000)
        .expect("real fight outcome bytes must decode");

    // The per-outcome doc carries EXACTLY the frozen view fields (0x5972… character,
    // 0xbfc5… fight, 0x0d93… world, outcome 3 = defeat, aged_bp 400, pvp false).
    let doc = set_json(&writes, "$").expect("outcome writes its doc");
    assert!(doc.contains(r#""outcome_id":"0x4fd5a7a1433e994bf6c563ef8115204fa875deaa15c115b3a20a83651238b079""#), "doc: {doc}");
    assert!(doc.contains(r#""character_id":"0x59725530910de90712e39d8e279e6522f4da1b50de9f4ced936749ede17fae75""#), "doc: {doc}");
    assert!(doc.contains(r#""fight_id":"0xbfc5222665988a711622543d2f221512ee8267dad5b4bb53735b0b1e3281596e""#), "doc: {doc}");
    assert!(doc.contains(r#""world_id":"0x0d936039531aa9c68da6fba56564d7f8adb02c26c1691c59d4efa7375164e4d1""#), "doc: {doc}");
    assert!(doc.contains(r#""pvp":false"#), "doc: {doc}");
    assert!(doc.contains(r#""outcome":3"#), "doc: {doc}");
    assert!(doc.contains(r#""aged_bp":400"#), "doc: {doc}");

    // Owner index: ZADD (member = outcome id, score = checkpoint ts) + a recency cap.
    let idx = k_pending_outcomes(&owner.to_string());
    assert!(writes.iter().any(|w| matches!(w, RedisWrite::ZAdd { key, member, .. } if key == &idx && member == id)));
    assert!(writes.iter().any(|w| matches!(w, RedisWrite::ZRemRangeByRank { key, .. } if key == &idx)));
    // Money-safe: the pending path carries NO relative counter (replay double-count guard).
    assert!(writes.iter().all(|w| !matches!(w, RedisWrite::NumIncrBy { .. })));
}

#[test]
fn fight_outcome_non_address_owner_is_none() {
    // Defensive: a (pathological) non-address-owned outcome is not projected — the per-owner
    // index is keyed by the address, and there is none.
    let bytes = hex::decode(REAL_FIGHT_OUTCOME_BCS_HEX).unwrap();
    let wrapper = SuiAddress::from_bytes([0xbb; 32]).unwrap();
    assert!(map_fight_outcome_object("0xdead", &bytes, &Owner::ObjectOwner(wrapper), 0).is_none());
    assert!(map_fight_outcome_object("0xdead", &[0x00, 0x01], &Owner::AddressOwner(wrapper), 0).is_none());
}

#[test]
fn remove_pending_outcome_drops_index_member_and_doc() {
    // results::open CONSUMES the outcome → mirror the delete: exact ZREM (the owning address rides the
    // deleted input object) + DEL the doc. Both idempotent (absent = no-op) → replay-safe.
    let id = "0x4fd5a7a1433e994bf6c563ef8115204fa875deaa15c115b3a20a83651238b079";
    let owner = SuiAddress::from_bytes([0x3d; 32]).unwrap().to_string();
    let writes = remove_pending_outcome(id, &owner);
    assert_eq!(
        writes,
        vec![zrem(k_pending_outcomes(&owner), id.to_string()), del(k_pending_outcome(id), "$")]
    );
}

// ── Pet-box claims (create/delete → per-owner claims map) ────────────────────

#[test]
fn pet_box_claim_projects_into_the_owners_claims_map() {
    let owner = SuiAddress::from_bytes([0x3d; 32]).unwrap();
    let claim_id = "0x000000000000000000000000000000000000000000000000000000000000ab0a";
    let rolled = ObjectID::from_hex_literal("0xf00d").unwrap();
    let obj = PetBoxClaimObject {
        id: ObjectID::from_hex_literal(claim_id).unwrap(),
        opener: owner,
        box_template: ObjectID::from_hex_literal("0xb001").unwrap(),
        rolled_template: rolled,
    };
    let bytes = bcs::to_bytes(&obj).unwrap();
    let writes = map_pet_box_claim_object(claim_id, &bytes, &Owner::AddressOwner(owner))
        .expect("pet box claim bytes must decode");

    // NX skeleton first (a snapshot landing before any other write to this wallet's doc still projects).
    let key = k_pet_claims(&owner.to_string());
    assert!(matches!(&writes[0], RedisWrite::Set { key: k, nx: true, .. } if k == &key));
    assert_eq!(
        set_json(&writes, &format!(r#"$.claims["{claim_id}"]"#)),
        Some(format!("\"{}\"", rolled.to_canonical_string(true))).as_deref()
    );
}

/// DRIFT GUARD: an INDEPENDENT mirror of the CURRENT `aresrpg::loot_box::PetBoxClaim` source
/// order (loot_box.move: `PetBoxClaim { id, opener, box_template, rolled_template }`). The
/// round-trip test above builds bytes from `PetBoxClaimObject` itself, so it can NEVER catch a
/// field reorder/insertion in Move — this pins the decode against an independently-typed mirror
/// of the current layout; a future drift fails here first.
#[test]
fn pet_box_claim_decodes_current_onchain_field_order() {
    #[derive(serde::Serialize)]
    struct ChainPetBoxClaim {
        id: ObjectID,
        opener: SuiAddress,
        box_template: ObjectID,
        rolled_template: ObjectID,
    }
    let owner = SuiAddress::from_bytes([0x5e; 32]).unwrap();
    let claim_id = "0x000000000000000000000000000000000000000000000000000000000000ab0b";
    let rolled = ObjectID::from_hex_literal("0xc0de").unwrap();
    let chain = ChainPetBoxClaim {
        id: ObjectID::from_hex_literal(claim_id).unwrap(),
        opener: owner,
        box_template: ObjectID::from_hex_literal("0xb002").unwrap(),
        rolled_template: rolled,
    };
    let writes = map_pet_box_claim_object(claim_id, &bcs::to_bytes(&chain).unwrap(), &Owner::AddressOwner(owner))
        .expect("current-layout PetBoxClaim must decode");
    assert_eq!(
        set_json(&writes, &format!(r#"$.claims["{claim_id}"]"#)),
        Some(format!("\"{}\"", rolled.to_canonical_string(true))).as_deref()
    );
}

#[test]
fn pet_box_claim_non_address_owner_or_garbage_is_none() {
    let owner = SuiAddress::from_bytes([0x3d; 32]).unwrap();
    let wrapper = SuiAddress::from_bytes([0xbb; 32]).unwrap();
    let obj = PetBoxClaimObject {
        id: ObjectID::from_hex_literal("0xabc").unwrap(),
        opener: owner,
        box_template: ObjectID::from_hex_literal("0xb003").unwrap(),
        rolled_template: ObjectID::from_hex_literal("0xf1").unwrap(),
    };
    let bytes = bcs::to_bytes(&obj).unwrap();
    // Soulbound by construction — a non-address owner is pathological → not projected.
    assert!(map_pet_box_claim_object("0xabc", &bytes, &Owner::ObjectOwner(wrapper)).is_none());
    // Garbage bytes → safe None (never panics the batch).
    assert!(map_pet_box_claim_object("0xabc", &[0x00, 0x01], &Owner::AddressOwner(owner)).is_none());
}

#[test]
fn remove_pet_box_claim_drops_the_claims_map_entry() {
    // claim_pet CONSUMES the claim → mirror the delete: JSON.DEL the one map entry (idempotent —
    // deleting an absent sub-path is a no-op), so replay is safe.
    let owner = SuiAddress::from_bytes([0x3d; 32]).unwrap().to_string();
    let claim_id = "0x000000000000000000000000000000000000000000000000000000000000ab0a";
    let writes = remove_pet_box_claim(claim_id, &owner);
    assert_eq!(writes, vec![del(k_pet_claims(&owner), &mpath("$.claims", claim_id))]);
}
