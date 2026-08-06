// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Move ↔ Rust event-mirror parity gate.
//!
//! The source paths below are routing metadata, not golden layouts: every test run
//! parses the authoritative Move struct and the Rust BCS decode target afresh.

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy)]
struct Mirror {
    move_source: &'static str,
    move_struct: &'static str,
    rust_source: &'static str,
    rust_struct: &'static str,
}

macro_rules! mirrors {
    ($move_source:literal, $(($move_struct:literal, $rust_struct:literal)),+ $(,)?) => {
        &[$(Mirror {
            move_source: $move_source,
            move_struct: $move_struct,
            rust_source: "src/handlers/ares/model.rs",
            rust_struct: $rust_struct,
        }),+]
    };
}

// One entry per source-backed event layout decoded by the indexer. Historical
// handlers whose events no longer exist in the current Move tree and native Sui
// framework events are intentionally outside this source-parity class.
const MIRROR_GROUPS: &[&[Mirror]] = &[
    mirrors!(
        "../../move/gifting/sources/pool.move",
        ("PoolBuy", "PoolBuy"),
        ("PoolSell", "PoolSell"),
    ),
    mirrors!(
        "../../move/aresrpg/sources/shop.move",
        ("SaleCreated", "SaleCreated"),
        ("SaleBurned", "SaleBurned"),
        ("SaleBought", "SaleBought"),
        ("SalePaused", "SalePaused"),
        ("PriceChanged", "ShopPriceChanged"),
        ("WindowChanged", "WindowChanged"),
    ),
    mirrors!(
        "../../move/gifting/sources/creation.move",
        ("CharacterCreated", "CharacterCreated"),
        ("PriceChanged", "CreationPriceChanged"),
        ("PausedSet", "PausedSet"),
        ("ClassAdded", "ClassName"),
        ("ClassRemoved", "ClassName"),
        ("SponsorSet", "SponsorSet"),
        ("FreeEnabledSet", "FreeEnabledSet"),
    ),
    mirrors!(
        "../../move/aresrpg/sources/character.move",
        ("CharacterMinted", "CharacterMinted"),
        ("PositionAnchored", "PositionAnchored"),
    ),
    mirrors!(
        "../../move/aresrpg/sources/character_link.move",
        ("StatRaised", "StatRaised"),
    ),
    mirrors!(
        "../../move/aresrpg/sources/item.move",
        ("TemplateCreated", "Template"),
        ("TemplateBurned", "Template"),
        ("TemplateRenamed", "TemplateRenamed"),
        ("ItemMinted", "ItemMinted"),
    ),
    mirrors!(
        "../../move/aresrpg/sources/pet.move",
        ("PetPowerAdvanced", "PetPowerAdvanced"),
        ("FoodPowerSet", "FoodPowerSet"),
    ),
    mirrors!(
        "../../move/aresrpg/sources/extract.move",
        ("ItemEquipped", "ItemEquip"),
        ("ItemUnequipped", "ItemEquip"),
        ("ItemBurned", "ItemBurned"),
    ),
    mirrors!(
        "../../move/aresrpg/sources/world.move",
        ("WorldCreated", "WorldCreated"),
        ("RareLinkSet", "RareLinkSet"),
        ("RareLinkCleared", "RareLinkCleared"),
    ),
    mirrors!(
        "../../move/aresrpg/sources/zones.move",
        ("WorldJoined", "WorldJoined"),
        ("ZoneSearched", "ZoneSearched"),
        ("MobGroupClaimed", "MobGroupClaimed"),
    ),
    mirrors!(
        "../../move/aresrpg/sources/gathering.move",
        ("ProtectorTriggered", "ProtectorTriggered"),
    ),
    mirrors!(
        "../../move/aresrpg/sources/config.move",
        ("ConfigEnabledSet", "ConfigEnabledSet"),
        ("DialChanged", "DialChanged"),
        ("ClassRowSet", "ClassRowSet"),
    ),
    mirrors!(
        "../../move/dungeon/sources/dungeon_events.move",
        ("RunActivated", "RunActivated"),
        ("PassEnteredFight", "PassEnteredFight"),
        ("RunAdvanced", "RunAdvanced"),
        ("RunEnded", "RunEnded"),
    ),
    mirrors!(
        "../../move/kolizeum/sources/kolizeum_events.move",
        ("KolizeumCreated", "KolizeumCreated"),
        ("KolizeumCancelled", "KolizeumCancelled"),
        ("KolizeumStarted", "KolizeumStarted"),
        ("KolizeumSettled", "KolizeumSettled"),
        ("KolizeumDrawn", "KolizeumDrawn"),
        ("KolizeumSwept", "KolizeumSwept"),
    ),
    mirrors!(
        "../../move/engine/sources/fight_events.move",
        ("FightCreated", "FightCreated"),
        ("FightJoined", "FightJoined"),
        ("Placed", "Placed"),
        ("Ready", "Ready"),
        ("TurnStarted", "TurnStarted"),
        ("Moved", "Moved"),
        ("MobMoved", "MobMoved"),
        ("Displaced", "Displaced"),
        ("Cast", "Cast"),
        ("ActionStarted", "ActionStarted"),
        ("ActionEffect", "ActionEffect"),
        ("CriticalFailure", "CriticalFailure"),
        ("StanceChanged", "StanceChanged"),
        ("Revealed", "Revealed"),
        ("Hit", "Hit"),
        ("Drain", "Drain"),
        ("Tackled", "Tackled"),
        ("TurnEnded", "TurnEnded"),
        ("Abandoned", "Abandoned"),
        ("Victory", "FightVictory"),
        ("Defeat", "FightDefeat"),
        ("Settled", "FightSettled"),
        ("ResultMinted", "ResultMinted"),
        ("Swept", "FightSwept"),
    ),
    mirrors!(
        "../../move/aresrpg/sources/results.move",
        ("ResultOpened", "ResultOpened"),
        ("ResultBurned", "ResultBurned"),
    ),
    mirrors!(
        "../../move/aresrpg/sources/commission.move",
        ("CraftRequested", "CraftRequested"),
        ("CraftAccepted", "CraftAccepted"),
        ("CraftExecuted", "CraftExecuted"),
        ("CraftCancelled", "CraftCancelled"),
    ),
    mirrors!(
        "../../move/forgemagie/sources/forgemagie.move",
        ("BoardCreated", "BoardCreated"),
        ("Crushed", "Crushed"),
        ("RecipelessSet", "RecipelessSet"),
    ),
    // Not an event: the fixed-width value type `ActionEffect` embeds. BCS inlines it, so its
    // layout is part of that event's wire and drifts the same way.
    mirrors!(
        "../../move/foundation/sources/spell_effect.move",
        ("Effect", "Effect"),
    ),
    &[Mirror {
        move_source: "../../move/social/sources/party.move",
        move_struct: "PartyCreated",
        rust_source: "src/handlers/ares/party.rs",
        rust_struct: "PartyEvent",
    }],
    &[Mirror {
        move_source: "../../move/social/sources/party.move",
        move_struct: "PartyJoined",
        rust_source: "src/handlers/ares/party.rs",
        rust_struct: "PartyEvent",
    }],
    &[Mirror {
        move_source: "../../move/social/sources/party.move",
        move_struct: "PartyLeft",
        rust_source: "src/handlers/ares/party.rs",
        rust_struct: "PartyEvent",
    }],
];

#[derive(Debug, Clone, PartialEq, Eq)]
struct Field {
    name: String,
    ty: String,
}

fn manifest_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(relative)
}

fn source(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|error| panic!("read {}: {error}", path.display()))
}

fn without_line_comments(source: &str) -> String {
    source
        .lines()
        .map(|line| line.split_once("//").map_or(line, |(code, _)| code))
        .collect::<Vec<_>>()
        .join("\n")
}

fn struct_body(source: &str, prefix: &str, name: &str) -> String {
    let source = without_line_comments(source);
    let needle = format!("{prefix}{name}");
    let start = source
        .match_indices(&needle)
        .find_map(|(offset, _)| {
            let after = &source[offset + needle.len()..];
            after
                .chars()
                .next()
                .is_some_and(|ch| ch.is_whitespace() || ch == '{')
                .then_some(offset + needle.len())
        })
        .unwrap_or_else(|| panic!("struct {name} not found"));
    let open = source[start..]
        .find('{')
        .map(|offset| start + offset)
        .unwrap();
    let mut depth = 0_u32;
    for (offset, ch) in source[open..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return source[open + 1..open + offset].to_owned();
                }
            }
            _ => {}
        }
    }
    panic!("struct {name} has no closing brace");
}

fn split_fields(body: &str) -> Vec<&str> {
    let mut fields = Vec::new();
    let mut start = 0;
    let mut angle_depth = 0_u32;
    for (offset, ch) in body.char_indices() {
        match ch {
            '<' => angle_depth += 1,
            '>' => angle_depth -= 1,
            ',' if angle_depth == 0 => {
                fields.push(&body[start..offset]);
                start = offset + 1;
            }
            _ => {}
        }
    }
    fields.push(&body[start..]);
    fields
}

fn fields(body: &str, rust: bool) -> Vec<Field> {
    split_fields(body)
        .into_iter()
        .filter_map(|raw| {
            let raw = raw.trim();
            if raw.is_empty() {
                return None;
            }
            let raw = if rust {
                raw.strip_prefix("pub ").unwrap_or(raw)
            } else {
                raw
            };
            let (name, ty) = raw
                .split_once(':')
                .unwrap_or_else(|| panic!("cannot parse field `{raw}`"));
            Some(Field {
                name: name.trim().to_owned(),
                ty: normalize_type(ty),
            })
        })
        .collect()
}

fn normalize_type(ty: &str) -> String {
    let compact = ty
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>();
    match compact.as_str() {
        "ObjectID" | "ID" => "id".into(),
        "SuiAddress" | "address" => "address".into(),
        "String" => "string".into(),
        _ => {
            for wrapper in ["Option", "vector"] {
                if let Some(inner) = compact
                    .strip_prefix(wrapper)
                    .and_then(|rest| rest.strip_prefix('<'))
                    .and_then(|rest| rest.strip_suffix('>'))
                {
                    return format!(
                        "{}<{}>",
                        wrapper.to_ascii_lowercase(),
                        normalize_type(inner)
                    );
                }
            }
            compact
        }
    }
}

/// Move struct types a mirrored layout embeds BY VALUE, and the source that defines them. BCS
/// inlines a nested struct, so its contribution is its own layout's minimum — parsed from the
/// SAME Move source below, never a transcribed byte count (the one home for the layout stays
/// the Move file; this table holds only the path to it).
const NESTED_LAYOUTS: &[(&str, &str)] =
    &[("Effect", "../../move/foundation/sources/spell_effect.move")];

fn minimum_bcs_size(ty: &str) -> usize {
    match ty {
        "bool" | "u8" => 1,
        "u16" => 2,
        "u32" => 4,
        "u64" => 8,
        "u128" => 16,
        "u256" | "id" | "address" => 32,
        // Empty strings/vectors and None encode as a one-byte ULEB128/tag.
        "string" => 1,
        _ if ty.starts_with("option<") || ty.starts_with("vector<") => 1,
        _ => nested_minimum_bcs_size(ty),
    }
}

fn nested_minimum_bcs_size(ty: &str) -> usize {
    let (_, move_source) = NESTED_LAYOUTS
        .iter()
        .find(|(name, _)| *name == ty)
        .unwrap_or_else(|| panic!("BCS size rule missing for `{ty}`"));
    let body = struct_body(&source(&manifest_path(move_source)), "public struct ", ty);
    layout_minimum_bcs_size(&fields(&body, false))
}

fn layout_minimum_bcs_size(fields: &[Field]) -> usize {
    fields.iter().map(|field| minimum_bcs_size(&field.ty)).sum()
}

fn render_field(field: Option<&Field>) -> String {
    field.map_or_else(
        || "<missing>".into(),
        |field| format!("{}: {}", field.name, field.ty),
    )
}

#[test]
fn move_event_mirrors_match_rust_fields_and_bcs_sizes() {
    let mut failures = String::new();
    let mirror_count = MIRROR_GROUPS.iter().map(|group| group.len()).sum::<usize>();
    assert_eq!(
        mirror_count, 84,
        "update the reviewed mirror count when the registry changes"
    );
    for mirror in MIRROR_GROUPS.iter().flat_map(|group| group.iter()) {
        let move_path = manifest_path(mirror.move_source);
        let rust_path = manifest_path(mirror.rust_source);
        let move_fields = fields(
            &struct_body(&source(&move_path), "public struct ", mirror.move_struct),
            false,
        );
        let rust_fields = fields(
            &struct_body(&source(&rust_path), "struct ", mirror.rust_struct),
            true,
        );
        let move_size = layout_minimum_bcs_size(&move_fields);
        let rust_size = layout_minimum_bcs_size(&rust_fields);
        if move_fields == rust_fields && move_size == rust_size {
            continue;
        }

        writeln!(
            failures,
            "\n{}::{} -> {} ({}):",
            mirror.move_source, mirror.move_struct, mirror.rust_struct, mirror.rust_source
        )
        .unwrap();
        let field_count = move_fields.len().max(rust_fields.len());
        for index in 0..field_count {
            let move_field = move_fields.get(index);
            let rust_field = rust_fields.get(index);
            if move_field != rust_field {
                writeln!(
                    failures,
                    "  field #{index}: Move `{}` | Rust `{}`",
                    render_field(move_field),
                    render_field(rust_field)
                )
                .unwrap();
            }
        }
        writeln!(
            failures,
            "  minimum BCS bytes: Move {move_size} | Rust {rust_size}"
        )
        .unwrap();
    }

    assert!(
        failures.is_empty(),
        "{} Move event mirror(s) diverged from Rust:{}",
        failures.matches("\n../../move/").count(),
        failures
    );
}
