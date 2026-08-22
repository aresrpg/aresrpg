// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! The Move↔indexer parity gates — compiled test-only, zero runtime footprint.
//!
//! The 2026-08-12 lesson, mechanized: the Move layer changed (`Fight.rng`
//! removed, `DungeonRun.seed` added, a whole `loot_box` module born) and the
//! hand-written twins went silently stale until an audit caught them. Prose
//! never survives pressure — these gates do:
//!
//! * **Layout parity** — every datatype the projection depends on is extracted
//!   from the COMPILED Move bytecode (`sui move build` output — the machine
//!   truth of the source) and compared against the committed snapshot
//!   `tests/layout_snapshot.txt`. Any Move edit to a depended-on struct reds
//!   `cargo test` the minute it compiles. Updating the snapshot is the
//!   deliberate, reviewed act that says "the twins were resynced too"
//!   (`UPDATE_LAYOUTS=1 cargo test` regenerates it).
//! * **Existence** — a datatype missing from the bytecode (renamed module,
//!   deleted struct) is a hard error, so no projection arm can go orphan.
//! * **Event census** — every `event::emit` in the Move sources must be routed
//!   by `events.rs` or sit on the explicit deferred list; a new event that
//!   nobody routed is a red, not a discovery.
//!
//! A missing build directory is an ERROR with the command to run — never a
//! skip (SKIP ≠ PASS).

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fmt::Write as _;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    use move_binary_format::binary_config::BinaryConfig;
    use move_binary_format::file_format::{
        Bytecode, CompiledModule, SignatureToken, SignatureToken as Sig, StructFieldInformation,
    };

    /// Every datatype the projection reads, per build — THE dependency
    /// manifest. Adding a projection arm means adding its row here.
    const GAME: &[(&str, &str)] = &[
        // objects
        ("character", "Character"),
        ("item", "Item"),
        ("fight", "Fight"),
        ("party", "Party"),
        ("friends", "FriendList"),
        ("kolizeum", "Kolizeum"),
        ("shop", "Sale"),
        ("shop", "Airdrop"),
        ("shop", "Giftcard"),
        ("loot_box", "BoxClaim"),
        ("forgemagie", "CrushClaim"),
        ("trade", "Trade"),
        ("version", "Version"),
        ("world", "World"),
        // embedded value types
        ("world", "Checkpoint"),
        ("zone", "ZoneKey"),
        ("zone", "Zone"),
        ("equipment", "EquippedRecord"),
        ("dungeon", "DungeonRun"),
        ("gathering", "PendingAmbush"),
        ("progression", "Hp"),
        ("forgemagie", "ForgeState"),
        ("pet", "FeedState"),
        ("party", "Member"),
        ("fight", "Fighter"),
        ("fight", "FighterKind"),
        ("fight", "MobSnapshot"),
        ("fight", "KitSpell"),
        ("fight", "TurnCast"),
        ("fight", "ActiveEffect"),
        ("fight", "Cooldown"),
        ("fight", "BoardZone"),
        ("fight", "RolledDrop"),
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
        ("item", "SealedKey"),
        ("forgemagie", "ForgeKey"),
        ("pet", "FeedKey"),
        // events (the routed table's layouts)
        ("character", "CharacterCreated"),
        ("equipment", "ItemEquipped"),
        ("equipment", "ItemUnequipped"),
        ("world", "WorldJoined"),
        ("dungeon", "DungeonEntered"),
        ("dungeon", "DungeonRoomCleared"),
        ("dungeon", "DungeonEnded"),
        ("fight", "FightCreated"),
        ("fight", "FighterJoined"),
        ("fight", "FighterForfeited"),
        ("fight", "FightStarted"),
        ("fight", "TurnSeedUsed"),
        ("fight", "FightEnded"),
        ("fight", "DropsRolled"),
        ("zone", "ZoneSearched"),
        ("gathering", "ResourceGathered"),
        ("gathering", "RareGathered"),
        ("party", "PartyCreated"),
        ("party", "PartyInvited"),
        ("party", "PartyJoined"),
        ("party", "PartyLeft"),
        ("friends", "FriendListCreated"),
        ("friends", "FriendAdded"),
        ("friends", "FriendRemoved"),
        ("trade", "TradeCreated"),
        ("trade", "TradeChanged"),
        ("trade", "TradeAccepted"),
        ("trade", "TradeLocked"),
        ("trade", "TradeDestroyed"),
        ("kolizeum", "KolizeumCreated"),
        ("kolizeum", "KolizeumPaid"),
        ("shop", "SaleBought"),
        ("shop", "AirdropCreated"),
        ("shop", "AirdropClaimed"),
        ("shop", "GiftcardMinted"),
        ("shop", "GiftcardRedeemed"),
        ("crafting", "Crafted"),
        ("crafting", "RecipeCreated"),
        ("forgemagie", "RuneScribed"),
        ("forgemagie", "GearCrushed"),
        ("pet", "PetFed"),
        ("item", "TemplateCreated"),
        ("mob_template", "MobTemplateCreated"),
        ("spell_template", "SpellCreated"),
        ("loot_box", "LootTableSet"),
        ("loot_box", "LootBoxOpened"),
        ("loot_box", "LootClaimed"),
    ];

    /// Math-package value types embedded in game objects.
    const MATH: &[(&str, &str)] = &[
        ("item_stats", "ItemStatistics"),
        ("item_damages", "ItemDamages"),
        ("combat_grid", "GridSpec"),
        ("spell_effect", "Effect"),
        ("spell_effect", "SpellLevel"),
        ("world_map", "WorldContent"),
        ("world_map", "BiomeMap"),
        ("world_map", "MobRow"),
        ("world_map", "ResourceRow"),
        ("world_map", "DungeonRoom"),
        ("world_map", "RoomMob"),
        ("mob_data", "LootEntry"),
    ];

    /// Events the projection DELIBERATELY does not route — each entry needs a
    /// reason. `world::WorldCreated` fires once per world at seeding time, before
    /// any player can be watching, and the World object's own projection carries
    /// everything the event would have said.
    const DEFERRED_EVENTS: &[(&str, &str)] = &[("world", "WorldCreated")];

    fn repo_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .expect("packages/indexer sits two levels under the repo root")
            .to_path_buf()
    }

    fn load_modules(build_dir: &Path) -> BTreeMap<String, CompiledModule> {
        assert!(
            build_dir.is_dir(),
            "no compiled Move build at {} — run `sui move build --path <pkg>` first \
             (the gate never skips: SKIP ≠ PASS)",
            build_dir.display()
        );
        let mut modules = BTreeMap::new();
        for entry in std::fs::read_dir(build_dir).expect("listing bytecode_modules") {
            let path = entry.expect("dir entry").path();
            if path.extension().is_some_and(|e| e == "mv") {
                let bytes = std::fs::read(&path).expect("reading .mv");
                // local builds are UNPUBLISHABLE-flavored (their header differs
                // from published bytecode) — the config must allow them.
                let module = CompiledModule::deserialize_with_config(
                    &bytes,
                    &BinaryConfig::new_unpublishable(),
                )
                .unwrap_or_else(|e| panic!("deserializing {}: {e:?}", path.display()));
                let name = module.identifier_at(module.self_handle().name).to_string();
                modules.insert(name, module);
            }
        }
        assert!(
            !modules.is_empty(),
            "empty build at {}",
            build_dir.display()
        );
        modules
    }

    #[test]
    fn game_package_keeps_publish_headroom() {
        // The testnet dry run rejected 96,111 raw bytes as a 103,109-byte package object.
        // Keeping raw bytecode below 95 KB leaves room for Sui's linkage/type-origin metadata.
        const MAX_GAME_BYTECODE_BYTES: u64 = 95_000;

        let root = repo_root();
        let install_dir =
            std::env::temp_dir().join(format!("aresrpg-size-gate-{}", std::process::id()));
        if install_dir.exists() {
            std::fs::remove_dir_all(&install_dir).expect("removing stale package-size build");
        }
        let output = Command::new("sui")
            .args([
                "move",
                "build",
                "--path",
                "packages/move",
                "--build-env",
                "testnet",
                "--warnings-are-errors",
                "--install-dir",
            ])
            .arg(&install_dir)
            .current_dir(&root)
            .output()
            .expect("running the production package-size build");
        assert!(
            output.status.success(),
            "production package-size build failed:\n{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let build_dir = install_dir.join("build/aresrpg/bytecode_modules");
        let bytes = std::fs::read_dir(&build_dir)
            .expect("listing game bytecode modules")
            .map(|entry| entry.expect("game bytecode module entry").path())
            .filter(|path| path.extension().is_some_and(|extension| extension == "mv"))
            .map(|path| {
                std::fs::metadata(&path)
                    .expect("reading game bytecode module metadata")
                    .len()
            })
            .sum::<u64>();
        std::fs::remove_dir_all(&install_dir).expect("removing package-size build");

        assert!(
            bytes <= MAX_GAME_BYTECODE_BYTES,
            "game bytecode is {bytes} bytes; the {MAX_GAME_BYTECODE_BYTES}-byte budget leaves \
             room for Sui package metadata under the 102,400-byte object limit"
        );
    }

    /// Render a type compactly: primitives lowercase, datatypes as
    /// `module::Name` (address-free — publish-independent), generics recursive.
    fn render(module: &CompiledModule, token: &SignatureToken) -> String {
        match token {
            SignatureToken::Bool => "bool".into(),
            SignatureToken::U8 => "u8".into(),
            SignatureToken::U16 => "u16".into(),
            SignatureToken::U32 => "u32".into(),
            SignatureToken::U64 => "u64".into(),
            SignatureToken::U128 => "u128".into(),
            SignatureToken::U256 => "u256".into(),
            SignatureToken::Address => "address".into(),
            SignatureToken::Signer => "signer".into(),
            SignatureToken::Vector(inner) => format!("vector<{}>", render(module, inner)),
            SignatureToken::Datatype(handle) => datatype_name(module, *handle),
            SignatureToken::DatatypeInstantiation(instantiation) => {
                let (handle, params) = instantiation.as_ref();
                let inner = params
                    .iter()
                    .map(|p| render(module, p))
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("{}<{inner}>", datatype_name(module, *handle))
            }
            SignatureToken::Reference(inner) => format!("&{}", render(module, inner)),
            SignatureToken::MutableReference(inner) => format!("&mut {}", render(module, inner)),
            SignatureToken::TypeParameter(i) => format!("T{i}"),
        }
    }

    fn datatype_name(
        module: &CompiledModule,
        handle: move_binary_format::file_format::DatatypeHandleIndex,
    ) -> String {
        let handle = module.datatype_handle_at(handle);
        let owner = module.module_handle_at(handle.module);
        format!(
            "{}::{}",
            module.identifier_at(owner.name),
            module.identifier_at(handle.name)
        )
    }

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

    /// THE ZONE UNIT IS THE CHAIN'S (2026-08-21). `events.rs` routes a fight to
    /// `evt:zone:{world}:{x/ZONE_SIZE}:{z/ZONE_SIZE}` from a Rust const that Rust cannot
    /// import from Move — so it is pinned HERE, against the compiled accessor. A zone_math
    /// change reds this in the same commit instead of silently mis-routing every zone
    /// channel (the server would subscribe squares that no longer exist).
    #[test]
    fn the_indexer_zone_size_is_the_compiled_one() {
        let root = repo_root();
        let math =
            load_modules(&root.join("packages/move-math/build/aresrpg_math/bytecode_modules"));
        let module = math
            .get("zone_math")
            .expect("zone_math is part of the math build");

        let accessor = module
            .function_defs()
            .iter()
            .find(|def| {
                let handle = module.function_handle_at(def.function);
                module.identifier_at(handle.name).as_str() == "zone_size"
            })
            .expect("zone_math::zone_size is the constant's only public witness");
        let code = &accessor.code.as_ref().expect("zone_size has a body").code;

        // the accessor is `LdConst(ZONE_SIZE); Ret` — any other shape means the constant
        // moved and this gate can no longer speak for it
        let [Bytecode::LdConst(index), Bytecode::Ret] = code[..] else {
            panic!("zone_math::zone_size is no longer a plain constant load: {code:?}")
        };
        let constant = module.constant_at(index);
        assert_eq!(constant.type_, Sig::U32, "zone_size returns a u32");
        let bytes: [u8; 4] = constant
            .data
            .as_slice()
            .try_into()
            .expect("a u32 constant is four bytes");

        assert_eq!(
            u32::from_le_bytes(bytes),
            crate::events::ZONE_SIZE,
            "events.rs ZONE_SIZE drifted from zone_math::ZONE_SIZE — resync it, \
             every evt:zone channel is derived from it"
        );
    }

    #[test]
    fn move_layouts_match_the_committed_snapshot() {
        let root = repo_root();
        let game = load_modules(&root.join("packages/move/build/aresrpg/bytecode_modules"));
        let math =
            load_modules(&root.join("packages/move-math/build/aresrpg_math/bytecode_modules"));

        let mut snapshot = String::from(
            "# Move layout snapshot — REGENERATE DELIBERATELY with `UPDATE_LAYOUTS=1 cargo test`\n\
             # after resyncing decode.rs (and graph/publish consumers) to the Move change.\n",
        );
        for (module, datatype) in GAME {
            writeln!(snapshot, "{}", layout_line(&game, module, datatype)).unwrap();
        }
        for (module, datatype) in MATH {
            writeln!(snapshot, "{}", layout_line(&math, module, datatype)).unwrap();
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
    fn every_emitted_move_event_is_routed_or_deferred() {
        let sources = repo_root().join("packages/move/sources");
        let mut emitted: Vec<(String, String)> = vec![];
        for entry in std::fs::read_dir(&sources).expect("listing move sources") {
            let path = entry.expect("dir entry").path();
            if path.extension().is_none_or(|e| e != "move") {
                continue;
            }
            let text = std::fs::read_to_string(&path).expect("reading move source");
            let module = text
                .lines()
                .find_map(|line| {
                    line.trim()
                        .strip_prefix("module aresrpg::")
                        .map(|rest| rest.trim_end_matches(';').to_string())
                })
                .unwrap_or_else(|| panic!("no module decl in {}", path.display()));
            let mut rest = text.as_str();
            while let Some(at) = rest.find("event::emit(") {
                rest = &rest[at + "event::emit(".len()..];
                let name: String = rest
                    .trim_start()
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                    .collect();
                assert!(
                    !name.is_empty(),
                    "unparseable event::emit in {}",
                    path.display()
                );
                emitted.push((module.clone(), name));
            }
        }
        assert!(!emitted.is_empty(), "no events found — wrong sources path?");

        for (module, name) in &emitted {
            let routed = crate::events::ROUTED
                .iter()
                .any(|(m, n)| m == module && n == name);
            let deferred = DEFERRED_EVENTS
                .iter()
                .any(|(m, n)| m == module && n == name);
            assert!(
                routed || deferred,
                "`{module}::{name}` is emitted on-chain but neither routed (events.rs) nor on \
                 the deferred list (gates.rs) — a new event nobody wired is a silent gap"
            );
        }
        // the reverse direction: a routed event that no longer exists is dead code
        for (module, name) in crate::events::ROUTED {
            assert!(
                emitted.iter().any(|(m, n)| m == module && n == name),
                "`{module}::{name}` is routed but no Move source emits it — dead route?"
            );
        }
    }

    /// The census proves every event is ROUTED; this proves every route is
    /// PINNED. Without it a routed event's twin layout sits outside the parity
    /// manifest, so a Move field change reds nothing and the decode goes
    /// silently stale — the exact 2026-08-12 failure, one step removed.
    /// One mirror field's Rust type, spelled the way `layout_line` renders the Move one — the
    /// two vocabularies meet here, once, instead of in every reader's head.
    fn rust_as_move(ty: &str, module: &str) -> String {
        let ty = ty.replace(' ', "");
        match ty.as_str() {
            "Id" => "object::ID".to_string(),
            "Addr" => "address".to_string(),
            "String" => "string::String".to_string(),
            "bool" | "u8" | "u16" | "u32" | "u64" | "u128" => ty,
            _ => {
                if let Some(inner) = ty.strip_prefix("Vec<").and_then(|t| t.strip_suffix('>')) {
                    format!("vector<{}>", rust_as_move(inner, module))
                } else if let Some(inner) =
                    ty.strip_prefix("Option<").and_then(|t| t.strip_suffix('>'))
                {
                    format!("option::Option<{}>", rust_as_move(inner, module))
                } else {
                    // a value type of the event's own module (fight::RolledDrop, …)
                    format!("{module}::{ty}")
                }
            }
        }
    }

    /// The fields one struct declares in the compiled bytecode, IN ORDER: `name: type`.
    fn declared_fields(
        modules: &BTreeMap<String, CompiledModule>,
        module_name: &str,
        datatype: &str,
    ) -> Vec<String> {
        let module = modules
            .get(module_name)
            .unwrap_or_else(|| panic!("module `{module_name}` is not in the compiled package"));
        for def in &module.struct_defs {
            let handle = module.datatype_handle_at(def.struct_handle);
            if module.identifier_at(handle.name).as_str() != datatype {
                continue;
            }
            let StructFieldInformation::Declared(fields) = &def.field_information else {
                panic!("{module_name}::{datatype} is native?");
            };
            return fields
                .iter()
                .map(|f| {
                    format!(
                        "{}: {}",
                        module.identifier_at(f.name),
                        render(module, &f.signature.0)
                    )
                })
                .collect();
        }
        panic!("{module_name}::{datatype} is not a struct in the compiled package");
    }

    /// THE WEDGE GATE (2026-08-22). BCS is POSITIONAL and the event decoder is a hand-written
    /// mirror: a mirror missing a field reads the NEXT field's bytes, and one bad event stops
    /// the whole pipeline — no graph write, no publish, every client frozen on a stale world.
    /// `FightEnded`/`FightStarted` each dropped `world/x/z` and wedged the indexer the moment a
    /// fight ended; the snapshot gate could not see it, because it only compares Move to Move.
    /// This one compares the MIRROR to the bytecode, which is the drift that actually hurts.
    #[test]
    fn every_event_mirror_matches_the_compiled_field_order() {
        let game = load_modules(&repo_root().join("packages/move/build/aresrpg/bytecode_modules"));
        for (module, name, mirrored) in crate::events::ROUTED_FIELDS {
            let declared = declared_fields(&game, module, name);
            let mirror = mirrored
                .iter()
                .map(|(field, ty)| format!("{field}: {}", rust_as_move(ty, module)))
                .collect::<Vec<_>>();
            assert_eq!(
                declared, mirror,
                "EVENT MIRROR DRIFT — `events.rs` decodes `{module}::{name}` as {mirror:?} \
                 while the compiled event declares {declared:?}. BCS is positional AND \
                 width-sensitive: this mirror poisons every checkpoint carrying the event. \
                 Resync the mirror."
            );
        }
    }

    #[test]
    fn every_routed_event_layout_is_pinned() {
        for (module, name) in crate::events::ROUTED {
            assert!(
                GAME.iter().any(|(m, n)| m == module && n == name),
                "`{module}::{name}` is routed (events.rs) but absent from the GAME manifest — \
                 its layout is unpinned, so a Move field change would red nothing. Add the row \
                 and regenerate with `UPDATE_LAYOUTS=1 cargo test`"
            );
        }
    }
}
