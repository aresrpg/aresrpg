// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Layout parity: every datatype the projection reads, compiled, against the committed
//! snapshot `tests/layout_snapshot.txt`. `UPDATE_LAYOUTS=1 cargo test` regenerates it after
//! the twins are resynced.

use std::fmt::Write as _;

use super::*;

/// Every datatype the projection reads, per build — THE dependency
/// manifest. Adding a projection arm means adding its row here.
const GAME: &[(&str, &str)] = &[
    // objects
    ("character", "Character"),
    ("item", "Item"),
    ("fight", "Fight"),
    ("party", "Party"),
    ("friends", "FriendList"),
    ("mastery", "Mastery"),
    ("mastery", "MasteryOffer"),
    ("kolizeum", "Kolizeum"),
    ("tournament", "Tournament"),
    ("tournament", "RulesKey"),
    ("tournament", "Rules"),
    ("tournament", "KaresPool"),
    ("tournament", "Team"),
    ("tournament", "Seat"),
    ("tournament", "Reward"),
    ("tournament", "TournamentUpdated"),
    ("tournament", "EntryFeePaid"),
    ("distribution", "Giftcard"),
    ("loot_box", "BoxClaim"),
    ("forgemagie", "CrushClaim"),
    ("trade", "Trade"),
    ("version", "Version"),
    ("zone", "Zone"),
    // embedded value types
    ("world", "Checkpoint"),
    ("equipment", "EquippedRecord"),
    ("dungeon", "DungeonRun"),
    ("gathering", "PendingAmbush"),
    ("progression", "Hp"),
    ("item", "RolledStats"),
    ("pet", "FeedState"),
    ("fight", "FighterAuthority"),
    ("fight", "DungeonTag"),
    ("fight", "FighterKey"),
    // dynamic-field keys the dispatch matches on
    ("progression", "HpKey"),
    ("progression", "SpellBookKey"),
    ("progression", "JobXpKey"),
    ("equipment", "EquipmentKey"),
    ("equipment", "FoldedKey"),
    ("world", "CurrentWorldKey"),
    ("world", "CheckpointKey"),
    ("dungeon", "DungeonRunKey"),
    ("gathering", "AmbushKey"),
    ("item", "StatsKey"),
    ("item", "DamagesKey"),
    ("pet", "FeedKey"),
    // events (the routed table's layouts)
    ("character", "CharacterCreated"),
    ("equipment", "ItemEquipped"),
    ("equipment", "ItemUnequipped"),
    ("world", "WorldJoined"),
    ("world", "CharacterTeleported"),
    ("dungeon", "DungeonEntered"),
    ("dungeon", "DungeonRoomCleared"),
    ("dungeon", "DungeonEnded"),
    ("fight", "FightCreated"),
    ("fight", "FighterJoined"),
    ("fight", "FighterForfeited"),
    ("fight", "FightStarted"),
    ("fight", "TurnSeedUsed"),
    ("fight", "FightEnded"),
    ("fight", "FightClosable"),
    ("fight", "FightClosed"),
    ("fight", "DropsRolled"),
    ("zone", "ZoneSearched"),
    ("gathering", "ResourceGathered"),
    ("gathering", "RareGathered"),
    ("kolizeum", "KolizeumCreated"),
    ("kolizeum", "KolizeumPaid"),
    ("item", "AmountChanged"),
    ("distribution", "GiftcardMinted"),
    ("distribution", "GiftcardRedeemed"),
    ("crafting", "Crafted"),
    ("forgemagie", "RuneScribed"),
    ("listing_rule", "SellerProved"),
    ("forgemagie", "GearCrushed"),
    ("pet", "PetFed"),
    ("loot_box", "LootTableSet"),
    ("loot_box", "LootBoxOpened"),
    ("loot_box", "LootBoxesOpened"),
    ("loot_box", "LootClaimed"),
    ("mastery", "MasteryUpdated"),
];

const COMBAT: &[(&str, &str)] = &[
    ("combat", "State"),
    ("combat", "Fighter"),
    ("combat", "FighterKind"),
    ("combat", "FighterStats"),
    ("combat", "Sheet"),
    ("combat", "MobSnapshot"),
    ("combat", "KitSpell"),
    ("combat", "TurnCast"),
    ("combat", "ActiveEffect"),
    ("combat", "Cooldown"),
    ("combat", "BoardZone"),
    ("combat", "RolledDrop"),
];

/// Math-package value types embedded in game objects.
/// Seed-package (living content) datatypes the projection reads — the SECOND origin.
const SEED: &[(&str, &str)] = &[
    // events
    ("mob_rows", "MobTemplateCreated"),
    ("spell_rows", "SpellCreated"),
    ("item_rows", "TemplateCreated"),
    ("recipe_rows", "RecipeCreated"),
    ("registry", "ContentWritten"),
];

const REWARDS: &[(&str, &str)] = &[("tournament_rewards", "Funds")];

const MATH: &[(&str, &str)] = &[
    ("item_stats", "ItemStatistics"),
    ("item_damages", "ItemDamages"),
    ("combat_grid", "GridSpec"),
    ("spell_effect", "Effect"),
    ("spell_effect", "SpellLevel"),
    ("mob_data", "LootEntry"),
    ("trade_state", "TradePhase"),
    ("trade_state", "TradeState"),
    ("tournament_bracket", "Match"),
];

/// One datatype's layout line: `module::Name = f1: t1, f2: t2` for a
/// struct, `module::Name = V1{…} | V2{…}` for an enum.
fn layout_line(
    modules: &BTreeMap<String, CompiledModule>,
    module_name: &str,
    datatype: &str,
) -> String {
    let module = modules.get(module_name).unwrap_or_else(|| {
        panic!("module `{module_name}` is not in the compiled package — renamed or deleted?")
    });
    // struct?
    for def in &module.struct_defs {
        let handle = module.datatype_handle_at(def.struct_handle);
        if module.identifier_at(handle.name).as_str() != datatype {
            continue;
        }
        let StructFieldInformation::Declared(fields) = &def.field_information else {
            panic!("{module_name}::{datatype} is native?");
        };
        let rendered = fields
            .iter()
            .map(|f| {
                format!(
                    "{}: {}",
                    module.identifier_at(f.name),
                    render(module, &f.signature.0)
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        return format!("{module_name}::{datatype} = {rendered}");
    }
    // enum?
    for def in &module.enum_defs {
        let handle = module.datatype_handle_at(def.enum_handle);
        if module.identifier_at(handle.name).as_str() != datatype {
            continue;
        }
        let variants = def
            .variants
            .iter()
            .map(|variant| {
                let fields = variant
                    .fields
                    .iter()
                    .map(|f| {
                        format!(
                            "{}: {}",
                            module.identifier_at(f.name),
                            render(module, &f.signature.0)
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("{}{{{fields}}}", module.identifier_at(variant.variant_name))
            })
            .collect::<Vec<_>>()
            .join(" | ");
        return format!("{module_name}::{datatype} = {variants}");
    }
    panic!(
        "`{module_name}::{datatype}` is not in the compiled package — the projection \
         depends on it (see the manifest in gates.rs); renamed or deleted on the Move side?"
    );
}

#[test]
fn move_layouts_match_the_committed_snapshot() {
    let root = repo_root();
    let game = load_modules(&root.join("packages/move/build/aresrpg/bytecode_modules"));
    let combat =
        load_modules(&root.join("packages/move-combat/build/aresrpg_combat/bytecode_modules"));
    let math = load_modules(&root.join("packages/move-math/build/aresrpg_math/bytecode_modules"));
    let seed = load_modules(&root.join("packages/seed/build/aresrpg_seed/bytecode_modules"));
    let rewards =
        load_modules(&root.join("packages/rewards/build/aresrpg_rewards/bytecode_modules"));

    let mut snapshot = String::from(
        "# Move layout snapshot — REGENERATE DELIBERATELY with `UPDATE_LAYOUTS=1 cargo test`\n\
         # after resyncing decode.rs (and graph/publish consumers) to the Move change.\n",
    );
    for (module, datatype) in GAME {
        writeln!(snapshot, "{}", layout_line(&game, module, datatype)).unwrap();
    }
    for (module, datatype) in COMBAT {
        writeln!(snapshot, "{}", layout_line(&combat, module, datatype)).unwrap();
    }
    for (module, datatype) in MATH {
        writeln!(snapshot, "{}", layout_line(&math, module, datatype)).unwrap();
    }
    for (module, datatype) in REWARDS {
        writeln!(snapshot, "{}", layout_line(&rewards, module, datatype)).unwrap();
    }
    for (module, datatype) in SEED {
        writeln!(snapshot, "{}", layout_line(&seed, module, datatype)).unwrap();
    }

    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/layout_snapshot.txt");
    if std::env::var("UPDATE_LAYOUTS").is_ok() {
        std::fs::write(&path, &snapshot).expect("writing snapshot");
        return;
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_else(|_| {
        panic!(
            "no committed snapshot at {} — generate it once with UPDATE_LAYOUTS=1 cargo test",
            path.display()
        )
    });
    if committed != snapshot {
        let diff: Vec<String> = committed
            .lines()
            .zip(snapshot.lines())
            .filter(|(a, b)| a != b)
            .map(|(a, b)| format!("  committed: {a}\n  compiled:  {b}"))
            .collect();
        panic!(
            "MOVE LAYOUT DRIFT — the compiled package no longer matches the snapshot the \
             twins were written against. Resync decode.rs (+ consumers), then ratify with \
             UPDATE_LAYOUTS=1 cargo test.\n{}\n(line-count change: {} committed vs {} compiled)",
            diff.join("\n"),
            committed.lines().count(),
            snapshot.lines().count(),
        );
    }
}

#[test]
fn every_routed_event_layout_is_pinned() {
    for (module, name) in crate::events::ROUTED {
        assert!(
            GAME.iter().any(|(m, n)| m == module && n == name)
                || SEED.iter().any(|(m, n)| m == module && n == name),
            "`{module}::{name}` is routed (events.rs) but absent from the GAME/SEED manifests — \
             its layout is unpinned, so a Move field change would red nothing. Add the row \
             and regenerate with `UPDATE_LAYOUTS=1 cargo test`"
        );
    }
}
